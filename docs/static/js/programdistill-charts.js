(() => {
  'use strict';

  const { element } = window.ProgramDistillUI;
  const colors = ['#75549d', '#257a80', '#bd7335', '#4e73b4', '#ae5877', '#69823a', '#6c67b0', '#6b7480'];
  const numeric = (value) => Number.isFinite(value);
  const count = (value) => value.toLocaleString('en-US', { maximumFractionDigits: 1 });

  function svgElement(tag, attributes, text) {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function figure(title, kind, description) {
    const node = element('figure', 'pdd-chart');
    node.dataset.chartKind = kind;
    node.append(element('figcaption', 'pdd-chart-title', title));
    if (description) node.append(element('p', 'pd-note', description));
    return node;
  }

  function barChart(title, rows, options = {}) {
    const chart = figure(title, 'bar', options.description);
    const format = options.format || count;
    const values = rows.map((row) => row.value).filter(numeric);
    const maximum = options.max ?? Math.max(1, ...values);
    if (!values.length) {
      chart.append(element('p', 'pd-note', 'No recorded values.'));
      return chart;
    }
    const plot = element('div', 'pdd-bars');
    rows.forEach((row) => {
      const entry = element('div', 'pdd-bar-row');
      const label = element('span', 'pdd-bar-label', row.label);
      const value = element('span', 'pdd-bar-value', numeric(row.value) ? format(row.value) : 'Not recorded');
      const track = element('div', 'pdd-bar-track');
      const fill = element('span', 'pdd-bar-fill');
      entry.dataset.value = numeric(row.value) ? row.value : '';
      if (numeric(row.value)) fill.style.width = `${row.value / maximum * 100}%`;
      track.append(fill);
      track.setAttribute('aria-hidden', 'true');
      entry.append(label, value, track);
      if (row.note) entry.append(element('span', 'pdd-bar-note', row.note));
      if (row.description) entry.title = row.description;
      plot.append(entry);
    });
    const scale = element('div', 'pdd-bar-scale');
    scale.append(element('span', '', format(0)), element('span', '', format(maximum)));
    chart.append(plot, scale);
    return chart;
  }

  function lineChart(title, series, options = {}) {
    const chart = figure(title, 'line', options.description);
    const formatY = options.formatY || count;
    const formatPointY = options.formatPointY || formatY;
    const formatX = options.formatX || count;
    const points = series.flatMap((line) => line.points).filter((point) => numeric(point.x) && numeric(point.y));
    if (!points.length) {
      chart.append(element('p', 'pd-note', 'No recorded values.'));
      return chart;
    }
    const width = options.width ?? 640;
    const height = 300;
    const left = 80;
    const right = width - 24;
    const top = 20;
    const bottom = height - 58;
    const minX = options.minX ?? 0;
    const maxX = Math.max(minX + 1, ...points.map((point) => point.x));
    const peak = Math.max(1, ...points.map((point) => point.y));
    const maxY = options.maxY ?? (options.integerY ? Math.ceil(peak / 4) * 4 : peak);
    const x = (value) => left + (value - minX) / (maxX - minX) * (right - left);
    const y = (value) => bottom - value / maxY * (bottom - top);
    const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, class: 'pdd-line-chart', role: 'img', 'aria-label': title });
    svg.append(svgElement('title', {}, title));
    svg.append(svgElement('desc', {}, `${options.xLabel || 'X'}; ${options.yLabel || 'Y'}. Missing values are not plotted.`));
    for (let index = 0; index <= 4; index += 1) {
      const value = maxY * index / 4;
      svg.append(svgElement('line', { x1: left, x2: right, y1: y(value), y2: y(value), class: 'pdd-chart-gridline' }),
        svgElement('text', { x: left - 10, y: y(value) + 5, 'text-anchor': 'end' }, formatY(value)));
    }
    const ticks = options.xTicks || Array.from({ length: 5 }, (_, index) => minX + (maxX - minX) * index / 4);
    ticks.forEach((value, index) => svg.append(svgElement('text', {
      x: x(value), y: bottom + 27, 'text-anchor': index === 0 ? 'start' : index === ticks.length - 1 ? 'end' : 'middle'
    }, formatX(value))));
    svg.append(svgElement('text', { x: (left + right) / 2, y: height - 4, 'text-anchor': 'middle' }, options.xLabel || ''));
    const legend = element('div', 'pdd-chart-legend');
    series.forEach((line, index) => {
      const color = line.color || colors[index % colors.length];
      const group = svgElement('g', { 'data-series': line.name });
      const sorted = [...line.points].filter((point) => numeric(point.x)).sort((a, b) => a.x - b.x);
      let drawing = false;
      let path = '';
      const valid = sorted.filter((point) => numeric(point.y));
      sorted.forEach((point) => {
        if (!numeric(point.y)) { drawing = false; return; }
        path += `${drawing ? 'L' : 'M'}${x(point.x)},${y(point.y)} `;
        drawing = true;
      });
      group.append(svgElement('path', {
        d: path, fill: 'none', stroke: color, 'stroke-width': 2.5,
        'stroke-linejoin': 'round', 'stroke-dasharray': index >= 4 ? '7 3' : 'none'
      }));
      valid.forEach((point, pointIndex) => {
        const mark = svgElement('circle', {
          cx: x(point.x), cy: y(point.y), r: valid.length > 30 ? 2 : 3.5, fill: color,
          'data-x': point.x, 'data-y': point.y
        });
        const label = `${line.name}: ${formatX(point.x)} ${options.xLabel || ''}, ${formatPointY(point.y)} ${options.yLabel || ''}`;
        mark.append(svgElement('title', {}, label));
        if (valid.length <= 20 || pointIndex === valid.length - 1) {
          mark.setAttribute('tabindex', '0');
          mark.setAttribute('aria-label', label);
        }
        group.append(mark);
      });
      svg.append(group);
      const item = element('span', 'pdd-chart-legend-item');
      const swatch = element('i', 'pdd-chart-swatch');
      swatch.style.borderColor = color;
      if (index >= 4) swatch.style.borderTopStyle = 'dashed';
      swatch.setAttribute('aria-hidden', 'true');
      const last = valid.at(-1);
      item.append(swatch, element('span', '', `${line.name}${options.showLast && last ? ` · ${formatY(last.y)}` : ''}`));
      legend.append(item);
    });
    chart.append(svg, legend);
    return chart;
  }

  window.ProgramDistillCharts = { barChart, lineChart };
})();
