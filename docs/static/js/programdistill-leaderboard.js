(() => {
  'use strict';

  const { element, button } = window.ProgramDistillUI;
  const { lineChart } = window.ProgramDistillCharts;
  // Matches the paper's analysis/render_frozen_performance.py, keyed by model identity.
  const modelColors = {
    'capi-gpt-6-astra': '#7651A8',
    'capi-claude-opus-5': '#C4552E',
    'capi-gpt-5.6-sol': '#4C7A78',
    'capi-grok-4.6': '#34373D',
    'capi-claude-sonnet-5': '#DD8A63',
    'capi-gpt-5.3-codex': '#98A3A8',
    'capi-gemini-3.7-flash': '#2F6BD6',
    'capi-gemini-3.6-flash': '#84A9E8',
    'capi-gemini-3.1-pro-preview': '#244A86'
  };
  const percent = (value) => `${(100 * value).toFixed(2)}%`;
  const rate = (value) => Number.isFinite(value) && value >= 0 && value <= 1;
  const count = (value) => Number.isSafeInteger(value) && value > 0;
  const nonnegative = (value) => Number.isFinite(value) && value >= 0;

  function validate(data) {
    const require = (condition, message) => {
      if (!condition) throw new Error(`Invalid leaderboard: ${message}.`);
    };
    require(data?.version === 1 && data.partial && data.full, 'both reconstruction tracks are required');
    for (const [track, metrics] of [['partial', ['complete', 'chain']], ['full', ['individual', 'workflow']]]) {
      const group = data[track];
      require(count(group.applications) && Array.isArray(group.models) && group.models.length > 0,
        `${track} population is missing`);
      const ids = new Set();
      group.models.forEach((model) => {
        require(['id', 'label', 'provider'].every((key) => typeof model[key] === 'string' && model[key].trim()) &&
          !ids.has(model.id), `${track} model identities must be unique`);
        ids.add(model.id);
        require(Object.hasOwn(modelColors, model.id), 'model is missing its paper color');
        require(metrics.every((key) => rate(model[key])) && nonnegative(model.steps), 'invalid model metrics');
        if (track === 'partial') {
          require(count(model.evaluated) && count(model.costed) && model.costed <= model.evaluated &&
            nonnegative(model.cost) && Array.isArray(model.depths) && model.depths.length === 8,
          'partial results need costs and eight restoration depths');
          require(model.depths.every((row, index) => row.depth === index + 1 &&
            count(row.evaluated) && count(row.costed) && row.costed <= row.evaluated &&
            rate(row.complete) && rate(row.chain) && nonnegative(row.steps) && nonnegative(row.cost)),
          'invalid restoration-depth metrics');
          const scopes = ['logic_only', 'logic_and_ui'].map((scope) => model.scopes?.[scope]);
          require(scopes.every((row) => rate(row?.complete) && count(row.evaluated) &&
            Number.isSafeInteger(row.passed) && row.passed >= 0 && row.passed <= row.evaluated &&
            Math.abs(row.complete - row.passed / row.evaluated) < 1e-10),
          'invalid mask-scope metrics');
          require(scopes[0].evaluated === 140 && scopes[1].evaluated === 160 &&
            scopes.reduce((sum, row) => sum + row.evaluated, 0) === model.evaluated &&
            scopes.reduce((sum, row) => sum + row.passed, 0) === model.passed,
          'mask-scope populations disagree');
          require(['logic_only', 'logic_and_ui', 'gap'].every((key) => {
            const value = model.paperScope?.[key];
            return typeof value === 'string' && /^-?\d+(?:\.\d+)?$/.test(value) &&
              Number(value) <= 100 && Number(value) >= (key === 'gap' ? -100 : 0);
          }), 'invalid paper-reported mask-scope scores');
        } else {
          require(model.applications === group.applications &&
            model.individualTotal === group.individualTotal && model.workflowTotal === group.workflowTotal &&
            count(model.individualTotal) && count(model.workflowTotal), 'full evaluation populations disagree');
          require(model.costed === group.applications && nonnegative(model.cost),
            'full costs must cover all selected apps');
        }
      });
    }
    require(count(data.partial.tasks), 'partial task count is missing');
    return data;
  }

  function renderDepthChart(group, availableWidth = 640) {
    const graph = lineChart('Binary score by restoration depth',
      group.models.map((model) => ({
        name: model.label, color: modelColors[model.id],
        points: model.depths.map((row) => ({ x: row.depth, y: row.complete }))
      })), {
        // Extend the coordinate space, keeping the original 400px-capped scale.
        width: Math.max(640, availableWidth * 300 / 400),
        minX: 1, maxY: 1, xTicks: [1, 2, 3, 4, 5, 6, 7, 8],
        formatX: String, formatY: (value) => `${Math.round(100 * value)}%`,
        formatPointY: percent,
        xLabel: 'Restoration depth', yLabel: 'Binary score'
      });
    graph.classList.add('pdd-depth-chart');
    return graph;
  }

  function createHarnessLink() {
    const link = element('a', '', 'R2E-Gym');
    link.href = 'https://github.com/R2E-Gym/R2E-Gym';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', 'R2E-Gym source on GitHub (opens in a new tab)');
    return link;
  }

  function render(data, availableWidth = 640) {
    const root = element('div', 'pdd-leaderboard');
    for (const track of ['full', 'partial']) {
      const partial = track === 'partial';
      const group = data[track];
      const primary = partial ? 'complete' : 'workflow';
      let sortKey = primary;
      let ascending = false;
      const section = element('section', `pdd-leaderboard-section pdd-leaderboard-${track}`);
      section.dataset.leaderboardTrack = track;
      const title = element('h2', 'pdd-track-title', partial ? 'Partial Reconstruction' : 'Full Reconstruction');
      title.id = `pdd-${track}-title`;
      section.setAttribute('aria-labelledby', title.id);
      const header = element('div', 'pdd-track-heading');
      const label = element('div');
      const population = partial
        ? `ProgramDistill-300 · ${group.tasks} tasks · ${group.applications} apps`
        : `${group.applications} apps · ${group.individualTotal} individual behaviors · ${group.workflowTotal} cumulative workflows`;
      const summary = element('p', 'pdd-track-population', `${population} (run with a modified `);
      summary.append(createHarnessLink(), ' harness by default; details in the paper)');
      label.append(title, summary);
      header.append(label);
      section.append(header);
      if (partial) section.append(renderDepthChart(group, availableWidth));
      const columns = [
        ['label', 'Model'], ['harness', 'Harness'],
        [primary, partial ? 'Binary score' : 'Cumulative workflow success', percent],
        ['cost', partial ? 'Avg. cost / task' : 'Avg. cost / app', (value) => `$${value.toFixed(2)}`],
        [partial ? 'chain' : 'individual', partial ? 'Chain score' : 'Atomic behavior success', percent],
        ['steps', partial ? 'Avg. steps / task' : 'Avg. steps / app', (value) => value.toFixed(1)]
      ];
      const wrap = element('div', 'pdd-table-scroll pdd-ranking-scroll');
      wrap.tabIndex = 0;
      wrap.setAttribute('role', 'region');
      wrap.setAttribute('aria-label', `${title.textContent} leaderboard. Scroll horizontally for all columns.`);
      const table = element('table', 'pdd-table pdd-ranking-table');
      const caption = element('caption', 'pd-sr-only', `${title.textContent} results. Select column headings to sort.`);
      const thead = element('thead');
      const tr = element('tr');
      const rank = element('th', '', 'Rank');
      rank.scope = 'col';
      tr.append(rank);
      const headers = new Map();
      const body = element('tbody');
      const feedback = element('p', 'pd-sr-only');
      feedback.setAttribute('role', 'status');

      function draw() {
        const population = group.models;
        const ranked = [...population].sort((a, b) => b[primary] - a[primary]);
        const ranks = new Map(ranked.map((model) => [model.id,
          ranked.findIndex((entry) => entry[primary] === model[primary]) + 1]));
        const selected = [...population];
        selected.sort((a, b) => {
          if (sortKey !== 'label') {
            const aMissing = !Number.isFinite(a[sortKey]);
            const bMissing = !Number.isFinite(b[sortKey]);
            if (aMissing || bMissing) return aMissing === bMissing ? ranks.get(a.id) - ranks.get(b.id) : aMissing ? 1 : -1;
          }
          const comparison = sortKey === 'label' ? a.label.localeCompare(b.label) : a[sortKey] - b[sortKey];
          return (ascending ? comparison : -comparison) || a.label.localeCompare(b.label);
        });
        headers.forEach(({ th, control, label }, key) => {
          th.setAttribute('aria-sort', key === sortKey ? ascending ? 'ascending' : 'descending' : 'none');
          control.replaceChildren(document.createTextNode(label));
          const arrow = element('span', 'pdd-sort-arrow', key === sortKey ? ascending ? '↑' : '↓' : '↕');
          arrow.setAttribute('aria-hidden', 'true');
          control.append(arrow);
        });
        body.replaceChildren();
        selected.forEach((model) => {
          const row = element('tr');
          row.dataset.model = model.id;
          const rankCell = element('td', 'pdd-rank');
          const position = ranks.get(model.id);
          const medal = element('span', `pdd-rank-number${position <= 3 ? ` pdd-medal pdd-medal-${position}` : ''}`, String(position));
          medal.setAttribute('aria-hidden', 'true');
          rankCell.append(medal, element('span', 'pd-sr-only', String(position)));
          row.append(rankCell);
          columns.forEach(([key, , format]) => {
            const cell = element(key === 'label' ? 'th' : 'td', key === primary ? 'pdd-primary-score' : '');
            if (key === 'label') {
              cell.scope = 'row';
              cell.append(element('strong', 'pdd-model-name', model.label),
                element('span', 'pdd-model-provider', model.provider));
            } else if (key === 'harness') {
              cell.textContent = 'R2E-Gym';
            } else {
              cell.textContent = format(model[key]);
              if (key === 'cost') cell.title =
                `Mean USD cost over ${model.costed} ${partial ? 'trajectories with recorded costs' : 'selected app reconstruction runs, including cached input'}.`;
              if (key === 'complete') cell.title = `${model.passed} / ${model.evaluated} complete repairs`;
              if (key === 'individual' || key === 'workflow') {
                cell.title = `${model[key + 'Passed']} / ${model[key + 'Total']} passed`;
              }
            }
            row.append(cell);
          });
          body.append(row);
        });
        feedback.textContent = `${selected.length} models. Rank is based on ${partial ? 'complete repair' : 'cumulative workflow recovery'}.`;
      }
      columns.forEach(([key, label]) => {
        const th = element('th');
        th.scope = 'col';
        if (key === 'harness') {
          th.classList.add('pdd-harness-header');
          th.textContent = label;
          tr.append(th);
          return;
        }
        const control = button('pdd-sort', label);
        control.addEventListener('click', () => {
          ascending = key === sortKey ? !ascending : ['label', 'cost', 'steps'].includes(key);
          sortKey = key;
          draw();
        });
        th.append(control);
        headers.set(key, { th, control, label });
        tr.append(th);
      });
      thead.append(tr);
      table.append(caption, thead, body);
      wrap.append(table);
      section.append(wrap, feedback);
      root.append(section);
      draw();
      if (partial) {
        const scopes = element('section', 'pdd-scope-breakdown');
        const heading = element('h3', 'pdd-chart-title', 'Binary score by mask scope');
        heading.id = 'pdd-scope-title';
        scopes.setAttribute('aria-labelledby', heading.id);
        const scroll = element('div', 'pdd-table-scroll');
        scroll.tabIndex = 0;
        scroll.setAttribute('role', 'region');
        scroll.setAttribute('aria-label', 'Mask-scope results. Scroll horizontally for all columns.');
        const scopeTable = element('table', 'pdd-table');
        const scopeHead = element('thead');
        const scopeHeaders = element('tr');
        for (const text of ['Model', 'Logic-only (140)', 'Logic + UI (160)', 'Gap (pp)']) {
          const cell = element('th', '', text);
          cell.scope = 'col';
          if (text === 'Gap (pp)') cell.title = 'Logic-only minus Logic + UI, in percentage points';
          scopeHeaders.append(cell);
        }
        scopeHead.append(scopeHeaders);
        const scopeBody = element('tbody');
        [...group.models].sort((a, b) => b.complete - a.complete || a.label.localeCompare(b.label))
          .forEach((model) => {
            const row = element('tr');
            row.dataset.model = model.id;
            const label = element('th', '', model.label);
            label.scope = 'row';
            row.append(label);
            for (const scope of ['logic_only', 'logic_and_ui']) {
              const cell = element('td', '', `${model.paperScope[scope]}%`);
              cell.title = 'Binary score as reported in the manuscript';
              row.append(cell);
            }
            row.append(element('td', '', model.paperScope.gap));
            scopeBody.append(row);
          });
        scopeTable.append(element('caption', 'pd-sr-only', heading.textContent), scopeHead, scopeBody);
        scroll.append(scopeTable);
        scopes.append(heading, scroll);
        root.append(scopes);
      }
    }
    return root;
  }

  window.ProgramDistillLeaderboard = { validate, render, renderDepthChart };
})();
