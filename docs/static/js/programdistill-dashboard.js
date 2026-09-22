(() => {
  'use strict';

  const root = document.querySelector('[data-pd-dashboard]');
  if (!root) return;
  const { element, button, status, stats, createDialog, createPlayer, behaviorLabel, splitDiffFiles, codeBrowser,
    loadApplicationSources, createApplicationSource, assetURL: publishedAssetURL } = window.ProgramDistillUI;
  const { lineChart } = window.ProgramDistillCharts;
  const views = ['patching', 'runs', 'mining', 'crafting'];
  const find = (selector) => root.querySelector(selector);
  const panel = find('[data-pdd-panel]');
  const content = find('[data-pdd-content]');
  const notice = find('[data-pdd-notice]');
  const message = find('[data-pdd-message]');
  const retry = find('[data-pdd-retry]');
  const appSelect = find('[data-pdd-app]');
  const tabs = Array.from(root.querySelectorAll('[data-pdd-tab]'));
  const dialog = createDialog(root, 'pd-full-dashboard');
  const manifestURL = new URL(root.dataset.src, document.baseURI);
  const appCache = new Map();
  const referenceMedia = new Map();
  const patchCache = new Map();
  const selectedPatchFiles = new Map();
  let manifest;
  let leaderboard;
  let leaderboardWidth = 0;
  let applicationSources;
  let appData;
  let appDataURL;
  let activeView = 'patching';
  let taskMode = 'atomic';
  let taskScope = 'logic_only';
  let selectedTaskId = '';
  let agentReplays = [];
  let agentReplaysURL;
  let agentReplaysError = null;
  let detailSerial = 0;
  let curatedError = false;
  let miningMediaError = false;
  let miningMediaLoaded = false;
  let requestNumber = 0;
  let activeChain = null;
  const appNames = {};
  const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
  const isText = (value) => typeof value === 'string' && value.trim().length > 0;
  const displayCount = (value) => Number.isFinite(value) ? value.toLocaleString('en-US') : 'Not recorded';
  const failureReasons = {
    target_still_passes: ['Target still passes', 'The target behavior still passed after its implementation was masked.'],
    parent_chain_failed: ['Parent chain failed', 'A prerequisite behavior failed replay validation.'],
    mask_generation_failed: ['Mask generation failed', 'The generator failed to produce an acceptable code-removal patch.'],
    mask_depth_rejected: ['Mask depth rejected', 'The mask failed the depth critic’s requirement for substantive implementation removal.'],
    masked_app_boot_failed: ['Masked app boot failed', 'The application did not start successfully after masking.'],
    masked_replay_reset_failed: ['Replay reset failed', 'The masked app could not be reset to a clean state for replay.']
  };
  const failureName = (kind) => failureReasons[kind]?.[0] || kind.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
  const failureDescription = (kind) => failureReasons[kind]?.[1] || 'The generation record reports this failure category.';

  function requireData(condition, description) {
    if (!condition) throw new Error(`Invalid dashboard data: ${description}.`);
  }

  function assetURL(path, base = manifestURL) {
    requireData(isText(path) && !/^(?:[a-z][a-z\d+.-]*:|[\\/])/i.test(path) && !path.includes('\\'),
      'asset paths must be relative');
    const result = new URL(path, base);
    requireData(result.origin === location.origin, 'data must be served by this site');
    return result;
  }

  async function getJSON(url) {
    const response = await fetch(url, { credentials: 'same-origin', mode: 'same-origin', cache: 'no-cache' });
    if (!response.ok) throw new Error(`Could not load ${url.pathname} (HTTP ${response.status}).`);
    return response.json();
  }

  function normalizeIndex(data) {
    if (data.schemaVersion !== 1) return data;
    requireData(Array.isArray(data.applications) && isObject(data.totals) &&
      isObject(data.patching) && isText(data.patching.href), 'the snapshot index is incomplete');
    return {
      version: 1,
      summary: data.totals,
      mediaBase: data.media?.baseUrl || null,
      apps: data.applications.map((app) => ({
        id: app.id, name: appNames[app.id] || app.label,
        data: app.href, counts: app.counts, description: app.description
      }))
    };
  }

  function normalizeReplay(replay) {
    if (!replay) return null;
    return {
      available: replay.available, status: replay.status, kind: 'gif',
      src: replay.url, poster: replay.poster || null, bytes: replay.bytes
    };
  }

  function normalizeApplication(data) {
    if (data.schemaVersion !== 1) return data;
    requireData(isObject(data.app) && isObject(data.mining) &&
      Array.isArray(data.mining.nodes) && Array.isArray(data.tasks) &&
      Array.isArray(data.trajectories), 'the application snapshot is incomplete');
    requireData(Array.isArray(data.mining.progressTimeline) && Array.isArray(data.mining.timeline),
      'the mining time-series export is outdated; reload the page to fetch the current snapshot');
    const label = (id) => behaviorLabel({ id, label: id.replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase()) });
    const nodes = data.mining.nodes.map((node) => ({
      ...node, label: label(node.id),
      media: normalizeReplay(node.replays.cleaned?.available ? node.replays.cleaned :
        node.replays.discovered?.available ? node.replays.discovered : node.replays.cleaned || node.replays.discovered)
    }));
    return {
      id: data.app.id,
      name: appNames[data.app.id] || data.app.label,
      description: data.app.description,
      capabilities: data.app.capabilities,
      mining: { ...data.mining, nodes },
      attempts: data.taskAttempts,
      generation: data.taskGeneration,
      tasks: data.tasks.map((task) => ({
        ...task, title: label(task.target), valid: task.verified,
        lineage: task.validationTraceNames.map((id) => ({
          id, label: label(id), repair: task.restorationTraceNames.includes(id)
        })),
        diff: task.patch.available ? task.patch.url : null,
        diffEncoding: task.patch.encoding,
        patchStatus: task.patch.status
      })),
      trajectories: data.trajectories.map((run) => ({
        ...run, score: run.chainScore, frames: run.frameCount, media: normalizeReplay(run.replay)
      }))
    };
  }

  function showError(error, again) {
    const box = element('div', 'pd-notice pd-notice-error');
    box.setAttribute('role', 'alert');
    const retryAction = button('pd-button-secondary', 'Try again');
    retryAction.addEventListener('click', again);
    box.append(element('p', 'pd-notice-message', error instanceof Error ? error.message : 'The data could not be loaded.'), retryAction);
    panel.replaceChildren(box);
  }

  function updateLocation() {
    const url = new URL(location.href);
    url.searchParams.set('view', activeView);
    if (activeView === 'mining' || activeView === 'crafting') url.searchParams.set('app', appSelect.value);
    else url.searchParams.delete('app');
    ['mode', 'scope', 'task'].forEach((key) => url.searchParams.delete(key));
    if (activeView === 'crafting') {
      url.searchParams.set('mode', taskMode);
      url.searchParams.set('scope', taskScope);
      if (selectedTaskId) url.searchParams.set('task', selectedTaskId);
    }
    history.replaceState(null, '', url);
  }

  function modelName(name) {
    const clean = name.replace(/^capi-/, '');
    return (clean.startsWith('gpt-') ? `GPT-${clean.slice(4).replaceAll('-', ' ')}` : clean.replaceAll('-', ' '))
      .replace(/\b(?:claude|opus|sonnet|gemini|flash|sol|astra|codex|grok|pro|preview)\b/g,
        (part) => part[0].toUpperCase() + part.slice(1));
  }

  function scopeName(scope) {
    if (scope === 'logic_only' || scope === 'Logic only') return 'Logic-only';
    if (scope === 'logic_and_ui' || scope === 'Logic + UI') return 'Logic + UI';
    return typeof scope === 'string' ? scope : 'Not recorded';
  }

  function scrollTable(headers, rows) {
    const wrap = element('div', 'pdd-table-scroll');
    wrap.tabIndex = 0;
    wrap.setAttribute('role', 'region');
    wrap.setAttribute('aria-label', 'Results table. Scroll horizontally on small screens.');
    const table = element('table', 'pdd-table');
    const head = element('thead');
    const heading = element('tr');
    headers.forEach((label) => {
      const th = element('th', '', label);
      th.scope = 'col';
      heading.append(th);
    });
    head.append(heading);
    const body = element('tbody');
    rows.forEach((cells) => {
      const row = element('tr');
      cells.forEach((value) => {
        const cell = element('td');
        cell.append(value instanceof Node ? value : document.createTextNode(String(value)));
        row.append(cell);
      });
      body.append(row);
    });
    table.append(head, body);
    wrap.append(table);
    return wrap;
  }

  function detailButton(label, callback) {
    const control = button('pdd-open', label);
    control.setAttribute('aria-haspopup', 'dialog');
    control.addEventListener('click', () => callback(control));
    return control;
  }

  function addMedia(body, media, title, label, base = appDataURL, publicMediaBase = manifest.mediaBase) {
    if (!media || media.available === false) {
      body.append(element('p', 'pdd-media-note',
        media?.status === 'source_missing'
          ? 'The source recording is unavailable for this feature.'
          : media?.status === 'catalog_unavailable'
          ? 'The recording catalog could not be loaded. Reload the dashboard to retry.'
          : !media || media.status === 'missing'
          ? 'No replay artifact is recorded for this entry.'
          : 'This replay has not been selected for publication. The original media collection is kept separately.'));
      return null;
    }
    requireData(isText(media.src) && Number.isFinite(media.bytes), 'published media needs a replay URL and size');
    const replay = createPlayer(media, base, title, label, publicMediaBase);
    body.append(replay.element);
    return replay;
  }

  function referenceReplay(node) {
    const reference = referenceMedia.get(`${appData.id}:${node.id}`);
    if (reference) return reference;
    return {
      media: miningMediaError ? { available: false, status: 'catalog_unavailable' } : node.media,
      base: appDataURL
    };
  }

  function unavailableRecordingLabel(node) {
    const media = referenceReplay(node).media;
    return media?.status === 'catalog_unavailable' ? 'Recording index unavailable' : 'Recording unavailable';
  }

  function openBehavior(node, trigger) {
    const body = element('div');
    body.append(element('p', 'pd-dialog-lead', node.description),
      stats([['browser actions', displayCount(node.actions)], ['prerequisite layer', displayCount(node.depth)]]));
    const reference = referenceReplay(node);
    const replay = addMedia(body, reference.media, 'Working app', behaviorLabel(node), reference.base,
      reference.publicMediaBase);
    dialog.open({
      title: behaviorLabel(node), category: appData.name, body, trigger,
      cleanup: () => { if (replay) replay.destroy(); }
    });
    if (replay) replay.start();
  }

  function patchDetails(task, base) {
    const diffBody = element('div', 'pdd-patch-body');
    diffBody.append(element('p', 'pd-note', task.kind === 'cumulative'
      ? 'The recorded combined mask, not a newly merged patch. This removes implementation; it is not an agent repair.'
      : 'The recorded implementation-removal mask, not an agent repair.'));
    if (!task.diff) {
      diffBody.append(element('p', 'pdd-empty', task.patchStatus && task.patchStatus.includes('withheld')
        ? 'This patch was withheld from the public export because it may contain sensitive content.'
        : 'No mask patch is published for this task record.'),
      element('p', 'pd-note', `Recorded patch status: ${task.patchStatus || 'not recorded'}.`));
    } else {
      let loaded = false;
      let loading = false;
      const result = element('div');
      diffBody.append(result);
      async function loadDiff() {
        if (loaded || loading) return;
        loading = true;
        result.replaceChildren(element('p', 'pd-note', 'Loading patch...'));
        try {
          let diffURL = assetURL(task.diff, base);
          const publicPatchBase = root.dataset.patchBase;
          if (publicPatchBase) {
            const localPatchBase = new URL('patches/', manifestURL);
            const filename = diffURL.pathname.slice(localPatchBase.pathname.length);
            requireData(diffURL.pathname.startsWith(localPatchBase.pathname) &&
              /^[a-f0-9]{64}\.diff\.gz$/.test(filename) && !diffURL.search && !diffURL.hash,
            'patch must identify a published content-addressed diff');
            diffURL = new URL(publishedAssetURL(new URL(filename, publicPatchBase).href, base, publicPatchBase));
          }
          let text = patchCache.get(diffURL.href);
          if (text === undefined) {
            const local = diffURL.origin === location.origin;
            const response = await fetch(diffURL, {
              credentials: local ? 'same-origin' : 'omit',
              mode: local ? 'same-origin' : 'cors',
              redirect: 'error'
            });
            if (!response.ok) throw new Error(`Patch request returned HTTP ${response.status}.`);
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
              requireData(typeof DecompressionStream === 'function', 'this browser cannot decompress the stored patch');
              text = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
            } else {
              text = new TextDecoder().decode(bytes);
            }
          }
          const files = splitDiffFiles(text);
          patchCache.set(diffURL.href, text);
          result.replaceChildren(codeBrowser(files, selectedPatchFiles.get(diffURL.href),
            (path) => selectedPatchFiles.set(diffURL.href, path)));
          requestAnimationFrame(() => {
            const selected = result.querySelector('.pd-code-file[aria-selected="true"]');
            if (selected?.getClientRects().length) selected.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          });
          loaded = true;
        } catch (error) {
          const retryDiff = button('pd-button-secondary', 'Retry loading patch');
          retryDiff.addEventListener('click', loadDiff);
          result.replaceChildren(element('p', 'pd-feedback-error', error.message), retryDiff);
        } finally {
          loading = false;
        }
      }
      loadDiff();
    }
    return diffBody;
  }

  function taskDetails(task) {
    const base = appDataURL;
    const details = element('article', 'pdd-task-detail');
    details.dataset.taskId = task.id;
    details.append(stats([['repair targets', task.depth],
      ['preserved setup', task.lineage.filter((step) => !step.repair).length]]));
    const history = generationHistory(task.target, task.scope, task.kind, task.runId);
    if (history) details.append(history);
    const tablist = element('div', 'pdd-detail-tabs');
    tablist.setAttribute('role', 'tablist');
    tablist.setAttribute('aria-label', 'Selected task details');
    const body = element('div', 'pdd-detail-content');
    const prefix = `pdd-task-${++detailSerial}`;
    const panels = new Map();
    const loadedPanels = new Set();
    const labels = ['Patch', 'Problem statement'];

    function instanceContent() {
      const instance = element('div');
      instance.append(element('h4', 'pd-dialog-section-title', 'Problem statement'),
        element('p', 'pdd-brief', task.brief));
      const workflow = element('details', 'pd-evidence');
      workflow.append(element('summary', '', 'Validation workflow and repair targets'));
      const lineage = element('ol', 'pdd-lineage');
      task.lineage.forEach((entry) => {
        const step = element('li', entry.repair ? 'pdd-lineage-repair' : 'pdd-lineage-setup');
        step.append(element('span', '', entry.label), element('small', '', entry.repair ? 'Repair target' : 'Preserved setup'));
        lineage.append(step);
      });
      workflow.append(lineage, element('p', 'pd-note', 'Setup checkpoints stay working; only repair targets are masked.'));
      const files = element('details', 'pd-evidence');
      files.append(element('summary', '', `${task.maskedFiles?.length || 0} masked files`));
      const list = element('ul', 'pdd-file-list');
      (task.maskedFiles || []).forEach((file) => list.append(element('li', '', file)));
      files.append(list);
      instance.append(workflow, files);
      agentReplays.filter((replay) => replay.taskId === task.id).forEach((replay) =>
        instance.append(detailButton(`Watch ${replay.modelLabel} repair this task`,
          (control) => openAgentReplay(replay, control))));
      return instance;
    }

    function activate(index) {
      controls.forEach((control, position) => {
        control.setAttribute('aria-selected', String(position === index));
        control.tabIndex = position === index ? 0 : -1;
      });
      if (!loadedPanels.has(index)) {
        const section = panels.get(index);
        section.append(index === 0 ? patchDetails(task, base) : instanceContent());
        loadedPanels.add(index);
      }
      panels.forEach((section, position) => { section.hidden = position !== index; });
    }
    const controls = labels.map((label, index) => {
      const control = button('pdd-detail-tab', label);
      control.id = `${prefix}-tab-${index}`;
      control.setAttribute('role', 'tab');
      control.setAttribute('aria-controls', `${prefix}-panel-${index}`);
      const section = element('section');
      section.id = `${prefix}-panel-${index}`;
      section.setAttribute('role', 'tabpanel');
      section.setAttribute('aria-labelledby', control.id);
      section.tabIndex = 0;
      panels.set(index, section);
      body.append(section);
      control.addEventListener('click', () => activate(index));
      control.addEventListener('keydown', (event) => {
        const next = event.key === 'ArrowRight' ? (index + 1) % labels.length
          : event.key === 'ArrowLeft' ? (index + labels.length - 1) % labels.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? labels.length - 1 : null;
        if (next === null) return;
        event.preventDefault();
        activate(next);
        controls[next].focus();
      });
      tablist.append(control);
      return control;
    });
    details.append(tablist, body);
    activate(0);
    return details;
  }

  function openTask(task, trigger) {
    dialog.open({ title: task.title, category: `${appData.name} / ${task.kind} / ${scopeName(task.scope)}`, body: taskDetails(task), trigger });
  }

  function openLinkedTask(task) {
    taskMode = task.kind;
    taskScope = task.scope;
    selectedTaskId = task.id;
    renderStage();
    const target = [...panel.querySelectorAll('.pdd-chain-node')]
      .find((control) => control.dataset.nodeId === task.target);
    openTask(task, target || appSelect);
  }

  function generationRecords(target, scope, runId) {
    return appData.attempts.filter((record) => record.target === target && record.scope === scope &&
      (!runId || record.runId === runId))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }

  function generationHistory(target, scope, mode, runId) {
    const records = generationRecords(target, scope, runId);
    if (!records.length) return null;
    const section = element('div', 'pdd-generation-histories');
    records.forEach((record) => {
      const history = element('details', 'pd-evidence pdd-generation-history');
      history.dataset.recordId = record.id;
      history.append(element('summary', '', 'Atomic mask generation history'));
      const outcome = record.valid
        ? record.repaired ? 'Accepted after retries' : 'Accepted'
        : record.status === 'cumulative_only' ? 'Preserved as a setup checkpoint'
        : record.status === 'error' ? 'Generation error' : 'Not accepted';
      history.append(element('p', 'pd-note', `Recorded outcome: ${outcome}.`));
      if (mode === 'cumulative') history.append(element('p', 'pd-note',
        'These attempts concern this feature’s atomic mask, not the combined cumulative patch.'));
      if (record.attempts.length) history.append(attemptTable(record));
      else history.append(element('p', 'pd-note', record.failureKind
        ? failureDescription(record.failureKind) : 'Individual attempt details are not included in this record.'));
      section.append(history);
    });
    return section;
  }

  function setupTasks(node) {
    return appData.tasks.filter((task) => task.kind === 'cumulative' && task.scope === taskScope &&
      task.setupTraceNames.includes(node.id));
  }

  function missingTaskEvidence(node) {
    const records = generationRecords(node.id, taskScope);
    const record = records[0];
    if (taskMode === 'cumulative') {
      if (record?.cumulativeTaskId) return {
        label: 'Task not included',
        description: 'A cumulative task was generated for this behavior, but it is not included in this release.'
      };
      if (record?.cumulativeErrorRecorded) return {
        label: 'Cumulative generation failed',
        description: 'An error occurred while generating the combined task.'
      };
      if (!node.parent && appData.tasks.some((task) => task.kind === 'atomic' && task.scope === taskScope && task.target === node.id)) return {
        label: 'Atomic task only',
        description: 'This feature has no earlier repair targets to combine. Open its atomic task below.'
      };
    } else if (record) {
      if (record.valid) return {
        label: 'Task not included',
        description: 'This feature passed atomic mask validation, but its task is not included in this release.'
      };
      const lastFailure = [...record.attempts].reverse().find((attempt) => attempt.failureKind);
      const kind = record.failureKind || lastFailure?.failureKind;
      if (kind) return {
        label: failureName(kind), description: failureDescription(kind), kind, record,
        historical: !record.failureKind
      };
      if (record.status === 'error') return {
        label: 'Generation error',
        description: 'An error occurred while generating this task.', record
      };
    }
    if (setupTasks(node).length) return {
      label: 'Preserved setup', record,
      description: 'This behavior is preserved as setup in the cumulative tasks below.'
    };
    return {
      label: 'Task unavailable', unknown: true, record,
      description: taskMode === 'atomic'
        ? 'Before masking, the target behavior must work. After masking, the app must still run and all prerequisite behaviors must pass, while the target behavior must fail.'
        : 'A cumulative task combines individually validated atomic masks. The combined mask must keep the app running while making the target replay fail.'
    };
  }

  function attemptTable(record) {
    return scrollTable(['Attempt', 'Stage', 'Result', 'Reason'],
      record.attempts.map((entry) => [
        Number.isFinite(entry.attempt) ? entry.attempt + 1 : 'Not recorded',
        entry.phase ? failureName(entry.phase) : 'Not recorded',
        entry.valid === true ? 'Passed' : entry.valid === false || entry.failureKind ? 'Failed' : 'Not recorded',
        entry.failureKind ? failureName(entry.failureKind) : entry.valid === true ? 'None' : 'Not recorded'
      ]));
  }

  function openMissingTask(node, trigger) {
    const body = element('div', 'pdd-missing-task');
    const evidence = missingTaskEvidence(node);
    const label = evidence.kind ? 'Generation criteria not met'
      : evidence.unknown ? 'Generation criteria not verified' : evidence.label;
    const explanation = element('p', 'pd-dialog-lead');
    explanation.append(element('strong', 'pdd-failure-title', `${label}${evidence.unknown ? '.' : ': '}`));
    if (evidence.unknown) explanation.append(element('br'));
    explanation.append(document.createTextNode(`${evidence.unknown ? 'Generation criteria: ' : ''}${evidence.description}`));
    body.append(explanation);
    if (evidence.historical) body.append(element('p', 'pd-note',
      'Last unsuccessful attempt; see the generation history below.'));
    const history = generationHistory(node.id, taskScope, taskMode);
    if (history) body.append(history);
    const atomic = taskMode === 'cumulative' && appData.tasks.find((task) =>
      task.kind === 'atomic' && task.scope === taskScope && task.target === node.id);
    if (atomic) body.append(detailButton('Open atomic task', () => openLinkedTask(atomic)));
    const related = setupTasks(node);
    if (related.length) {
      const tasks = element('details', 'pd-evidence pdd-setup-tasks');
      tasks.append(element('summary', '', `Used as setup in ${related.length} cumulative task${related.length === 1 ? '' : 's'}`));
      const list = element('ul', 'pdd-file-list');
      related.forEach((task) => {
        const item = element('li');
        item.append(detailButton(`${task.title} · ${task.depth} repair target${task.depth === 1 ? '' : 's'}`,
          () => openLinkedTask(task)));
        list.append(item);
      });
      tasks.append(list);
      body.append(tasks);
    }
    dialog.open({ title: behaviorLabel(node),
      category: `${appData.name} / ${taskMode} / ${scopeName(taskScope)}`, body, trigger });
  }

  function openAgentReplay(replay, trigger) {
    const player = createPlayer(replay.media, agentReplaysURL, 'Agent trajectory',
      `${replay.app}: ${replay.title}`, null, { controls: true });
    const body = element('div', 'pdd-replay-body');
    body.append(createApplicationSource(applicationSources.get(replay.appId)),
      element('p', 'pd-note', replay.layout === 'reference-current-code'
        ? `Reference app on the left; current app on the right; code below. ${replay.sourceSteps} recorded source steps. Time-compressed playback, not live execution.`
        : 'Agent workspace on the left; working reference on the right.'), player.element);
    dialog.open({
      title: replay.title,
      category: `${replay.app} / ${replay.modelLabel} / ${replay.depth} feature${replay.depth === 1 ? '' : 's'} restored`,
      body, trigger, cleanup: () => player.destroy()
    });
    player.start();
  }

  async function loadAgentReplays() {
    agentReplays = [];
    agentReplaysError = null;
    try {
      requireData(isText(root.dataset.agentReplaysSrc), 'the selected replay index is missing');
      const url = new URL(root.dataset.agentReplaysSrc, document.baseURI);
      requireData(url.origin === location.origin, 'the replay index must be served by this site');
      const data = await getJSON(url);
      const entries = window.ProgramDistillReplayGallery.validate(data, url,
        new Set(manifest.apps.map((app) => app.id)));
      agentReplaysURL = url;
      agentReplays = entries.map((replay) => ({
        ...replay, app: replay.layout === 'reference-current-code' ? replay.app : applicationSources.get(replay.appId).label,
        modelLabel: modelName(replay.model)
      }));
    } catch (error) {
      agentReplaysError = error;
    }
  }

  function renderReplayGallery() {
    if (agentReplaysError) {
      showError(agentReplaysError, async () => {
        panel.replaceChildren(element('p', 'pd-description', 'Loading selected replays...'));
        await loadAgentReplays();
        if (activeView === 'runs') renderReplayGallery();
      });
      return;
    }
    panel.replaceChildren(window.ProgramDistillReplayGallery.render(agentReplays, agentReplaysURL, openAgentReplay));
  }

  function miningProgress() {
    const section = element('section', 'pdd-section');
    const charts = element('div', 'pdd-chart-grid');
    const timeline = appData.mining.timeline || [];
    const progress = appData.mining.progressTimeline || [];
    const series = (rows, fields) => fields.map(([key, name]) => ({
      name, points: rows.map((row) => ({ x: Number.isFinite(row.elapsed_s) ? row.elapsed_s / 60 : null, y: row[key] }))
    }));
    charts.append(lineChart('Mining progress',
      series(progress, [['goals_proposed', 'Proposed'], ['goals_collected', 'Collected'], ['replay_passed', 'Replay passed']]),
      { xLabel: 'Elapsed minutes', yLabel: 'Count', showLast: true, integerY: true }),
    lineChart('Discovery tree growth',
      series(timeline, [['trace_count', 'Traces'], ['max_depth', 'Depth'], ['max_width', 'Width']]),
      { xLabel: 'Elapsed minutes', yLabel: 'Count', showLast: true, integerY: true }));
    section.append(charts);
    return section;
  }

  function applicationOverview() {
    const overview = element('div', 'pdd-app-overview');
    const details = element('details', 'pd-evidence pdd-app-about');
    details.append(element('summary', '', 'About this application'));
    details.append(element('p', 'pd-description', appData.description));
    const capabilities = appData.capabilities;
    if (capabilities) {
      const list = element('ul');
      [...(capabilities.core_capabilities || []), ...(capabilities.secondary_capabilities || [])]
        .forEach((description) => list.append(element('li', '', description)));
      details.append(list);
    }
    overview.append(details, createApplicationSource(applicationSources.get(appData.id)));
    return overview;
  }

  function hasRecording(node) {
    return referenceReplay(node).media?.available === true;
  }

  function chainMap(nodes, options = {}) {
    const wrap = element('section', 'pdd-chain');
    wrap.setAttribute('aria-label', options.crafting ? 'Taskgen (Crafting) chain map' : 'Feature Discovery (mining) chain map');
    const toolbar = element('div', 'pdd-chain-toolbar');
    const heading = element('h2', 'pdd-chain-title', 'Select a card: ');
    heading.append(element('span', 'pdd-chain-description', options.crafting
        ? 'Open its task details or generation record.'
        : 'See behavior details and available recordings.'));
    const tools = element('div', 'pdd-graph-tools');
    const minus = button('pd-button-secondary', '−');
    minus.setAttribute('aria-label', 'Zoom out chain map');
    const zoomText = element('output', 'pdd-zoom', '100%');
    zoomText.setAttribute('aria-label', 'Chain map zoom');
    const plus = button('pd-button-secondary', '+');
    plus.setAttribute('aria-label', 'Zoom in chain map');
    const reset = button('pd-button-secondary', 'Fit width');
    reset.setAttribute('aria-label', 'Fit chain map to width');
    tools.append(minus, zoomText, plus, reset);
    toolbar.append(heading, tools);
    const viewport = element('div', 'pdd-chain-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Chain map. Zoom in for detail; arrow keys pan when zoomed. Tab reaches feature buttons.');
    const surface = element('div', 'pdd-chain-surface');
    const plane = element('div', 'pdd-chain-plane');
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const byDepth = new Map();
    nodes.forEach((node) => {
      const depth = Number(node.depth) || 1;
      if (!byDepth.has(depth)) byDepth.set(depth, []);
      byDepth.get(depth).push(node);
    });
    const initialLineage = new Set(options.task?.lineage.map((step) => step.id) || []);
    const positions = new Map();
    const nodeWidth = 218;
    const nodeHeight = 112;
    const columnWidth = 286;
    const rowHeight = 140;
    let rows = 1;
    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    depths.forEach((depth, column) => {
      const entries = byDepth.get(depth);
      entries.sort((a, b) => {
        const rank = (node) => initialLineage.has(node.id) ? 0 : hasRecording(node) ? 1 : 2;
        return rank(a) - rank(b) ||
          (positions.get(a.parent)?.y || 0) - (positions.get(b.parent)?.y || 0) ||
          a.label.localeCompare(b.label);
      });
      rows = Math.max(rows, entries.length);
      const label = element('span', 'pdd-depth-label', `Layer ${depth}`);
      label.style.left = `${20 + column * columnWidth}px`;
      plane.append(label);
      entries.forEach((node, row) => positions.set(node.id, { x: 20 + column * columnWidth, y: 46 + row * rowHeight }));
    });
    const width = Math.max(580, 40 + depths.length * columnWidth - 68);
    const height = Math.max(350, rows * rowHeight + 40);
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'pdd-chain-edges');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('aria-hidden', 'true');
    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    const arrowId = `pdd-arrow-${++detailSerial}`;
    marker.id = arrowId;
    marker.setAttribute('viewBox', '0 0 10 10');
    marker.setAttribute('refX', '9');
    marker.setAttribute('refY', '5');
    marker.setAttribute('markerWidth', '5');
    marker.setAttribute('markerHeight', '5');
    marker.setAttribute('orient', 'auto');
    const arrow = document.createElementNS(svgNS, 'path');
    arrow.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z');
    arrow.setAttribute('fill', 'var(--pd-indigo)');
    marker.append(arrow);
    defs.append(marker);
    svg.append(defs);
    const edgeRecords = new Map();
    [...(appData.mining.edges || []), ...nodes.filter((node) => node.parent).map((node) =>
      ({ source: node.parent, target: node.id }))].forEach((edge) => {
      if (byId.has(edge.source) && byId.has(edge.target)) edgeRecords.set(`${edge.source}:${edge.target}`, edge);
    });
    const edges = [];
    edgeRecords.forEach((edge) => {
      const from = positions.get(edge.source);
      const to = positions.get(edge.target);
      const x = from.x + nodeWidth;
      const y = from.y + nodeHeight / 2;
      const targetY = to.y + nodeHeight / 2;
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', `M ${x} ${y} C ${x + 34} ${y}, ${to.x - 34} ${targetY}, ${to.x} ${targetY}`);
      path.setAttribute('class', 'pdd-chain-edge');
      path.setAttribute('marker-end', `url(#${arrowId})`);
      const title = document.createElementNS(svgNS, 'title');
      title.textContent = `${byId.get(edge.source).label} → ${byId.get(edge.target).label}`;
      path.append(title);
      svg.append(path);
      edges.push({ ...edge, path });
    });
    plane.prepend(svg);
    const controls = new Map();
    [...nodes].sort((a, b) => positions.get(a.id).x - positions.get(b.id).x ||
      positions.get(a.id).y - positions.get(b.id).y).forEach((node) => {
      const position = positions.get(node.id);
      const control = button('pdd-chain-node', '');
      control.dataset.nodeId = node.id;
      control.style.left = `${position.x}px`;
      control.style.top = `${position.y}px`;
      const candidate = options.tasks?.find((task) => task.target === node.id);
      const contextOnly = Boolean(options.crafting && !candidate);
      const failure = contextOnly ? missingTaskEvidence(node) : null;
      control.classList.toggle('pdd-node-recording', hasRecording(node));
      control.classList.toggle('pdd-node-no-task', contextOnly);
      control.append(element('strong', 'pdd-node-name', behaviorLabel(node)),
        element('span', 'pdd-node-meta', options.crafting
          ? candidate ? `${candidate.kind === 'atomic' ? 'Atomic' : 'Cumulative'} · ${candidate.depth} repair target${candidate.depth === 1 ? '' : 's'}` : failure.label
          : `${node.verified ? 'Verified' : 'Not verified'} · ${displayCount(node.actions)} actions`),
        element('span', 'pdd-node-role', options.crafting ? '' : hasRecording(node) ? '▶ View recording' : unavailableRecordingLabel(node)));
      const parent = byId.get(node.parent);
      control.title = `${node.description || node.label}${failure ? ` ${failure.label}: ${failure.description}` : ''}`;
      control.setAttribute('aria-haspopup', 'dialog');
      control.setAttribute('aria-label', `${node.label}. ${contextOnly ? `${failure.label}; open generation details.` : options.crafting && candidate ? `Open ${candidate.kind} task.` :
        hasRecording(node) ? 'Open reference recording.' : `Open feature details. ${unavailableRecordingLabel(node)}.`}${parent ? ` Requires ${parent.label}.` : ''}`);
      control.addEventListener('click', () => options.onSelect ? options.onSelect(node, control) : openBehavior(node, control));
      controls.set(node.id, control);
      plane.append(control);
    });
    plane.style.width = `${width}px`;
    plane.style.height = `${height}px`;
    surface.append(plane);
    viewport.append(surface);
    wrap.append(toolbar, viewport);
    let zoom = 1;
    let selected = options.task;
    let fitted = true;
    function setZoom(value) {
      const oldZoom = zoom;
      zoom = Math.max(0.02, Math.min(1.8, value));
      surface.style.width = `${width * zoom}px`;
      surface.style.height = `${height * zoom}px`;
      plane.style.transform = `scale(${zoom})`;
      viewport.scrollLeft *= zoom / oldZoom;
      viewport.scrollTop *= zoom / oldZoom;
      zoomText.textContent = `${Math.round(zoom * 100)}%`;
      minus.disabled = zoom <= 0.02;
      plus.disabled = zoom >= 1.8;
    }
    function fit() {
      if (!wrap.isConnected || !viewport.clientWidth || !viewport.clientHeight) return;
      setZoom(Math.min(1, (viewport.clientWidth - 24) / width));
      viewport.scrollTo(0, 0);
    }
    minus.addEventListener('click', () => { fitted = false; setZoom(zoom / 1.4); });
    plus.addEventListener('click', () => { fitted = false; setZoom(zoom * 1.4); });
    reset.addEventListener('click', () => { fitted = true; fit(); });
    if (options.crafting) {
      const legend = element('div', 'pdd-chain-legend');
      legend.append(element('span', 'pdd-legend-repair', 'Repair target'),
        element('span', 'pdd-legend-setup', 'Preserved setup'),
        element('span', '', 'Other mined branches'));
      wrap.append(legend);
    }
    function select(task) {
      selected = task;
      const lineage = new Map(task?.lineage.map((step) => [step.id, step]) || []);
      controls.forEach((control, id) => {
        const step = lineage.get(id);
        control.classList.toggle('pdd-node-repair', Boolean(step?.repair));
        control.classList.toggle('pdd-node-setup', Boolean(step && !step.repair));
        control.classList.toggle('pdd-node-selected', task?.target === id);
        if (options.crafting) {
          control.setAttribute('aria-pressed', String(task?.target === id));
          control.querySelector('.pdd-node-role').textContent = step ? `${task.target === id ? '◆ Ending node · ' : ''}${step.repair ? 'Repair target' : 'Preserved setup'}` : '';
        }
      });
      edges.forEach((edge) => {
        const onPath = lineage.has(edge.source) && lineage.has(edge.target);
        edge.path.classList.toggle('pdd-edge-selected', onPath);
        edge.path.classList.toggle('pdd-edge-setup', onPath && !lineage.get(edge.target).repair);
        if (onPath) svg.append(edge.path);
      });
    }
    select(selected);
    const observer = new ResizeObserver(() => { if (fitted) fit(); });
    observer.observe(viewport);
    const firstFit = requestAnimationFrame(fit);
    return {
      element: wrap, select,
      destroy() { cancelAnimationFrame(firstFit); observer.disconnect(); }
    };
  }

  function renderMining() {
    const all = appData.mining.nodes;
    panel.replaceChildren(stats([['mined features', all.length], ['replay verified', all.filter((node) => node.verified).length],
        ['dependency layers', Math.max(0, ...all.map((node) => node.depth))], ['reference recordings', all.filter(hasRecording).length]]));
    if (miningMediaError) panel.append(element('p', 'pdd-media-note', 'The mining recording catalog could not be loaded. Only available fallback recordings are shown; the complete graph is still available. Reload to retry the catalog.'));
    else if (curatedError && !miningMediaLoaded) panel.append(element('p', 'pdd-media-note', 'The selected-recording index could not be loaded. The complete graph is still available; reload to retry recordings.'));
    if (all.length) {
      activeChain = chainMap(all);
      panel.append(activeChain.element);
    } else panel.append(element('p', 'pdd-empty', 'No mined features are recorded for this application.'));
    panel.append(miningProgress());
  }

  function renderCraft() {
    const all = appData.tasks;
    panel.replaceChildren();
    const controls = element('div', 'pdd-craft-controls');
    const modes = element('fieldset', 'pdd-mode-field');
    modes.append(element('legend', 'pd-label', 'Task mode'));
    const modeButtons = element('div', 'pdd-mode-options');
    ['atomic', 'cumulative'].forEach((mode) => {
      const label = element('label', 'pdd-mode-option');
      const radio = element('input');
      radio.type = 'radio';
      radio.name = 'pdd-task-mode';
      radio.value = mode;
      radio.checked = taskMode === mode;
      radio.addEventListener('change', () => {
        taskMode = mode;
        renderStage();
        panel.querySelector(`input[value="${mode}"]`).focus({ preventScroll: true });
      });
      label.append(radio, element('span', '', mode === 'atomic' ? 'Atomic' : 'Cumulative'));
      modeButtons.append(label);
    });
    modes.append(modeButtons);
    const scopeLabel = element('label', 'pdd-field');
    scopeLabel.append(element('span', 'pd-label', 'Mask scope'));
    const scope = element('select', 'pd-select');
    scope.dataset.pddScope = '';
    ['logic_only', 'logic_and_ui'].forEach((value) => {
      const option = element('option', '', scopeName(value));
      option.value = value;
      scope.append(option);
    });
    scope.value = taskScope;
    scope.addEventListener('change', () => {
      taskScope = scope.value;
      renderStage();
      panel.querySelector('[data-pdd-scope]').focus({ preventScroll: true });
    });
    scopeLabel.append(scope);
    controls.append(modes, scopeLabel);
    panel.append(controls);
    const scopeTasks = all.filter((task) => task.kind === taskMode && task.scope === taskScope);
    const previous = all.find((task) => task.id === selectedTaskId);
    let selected = scopeTasks.find((task) => task.id === selectedTaskId) ||
      scopeTasks.find((task) => task.target === previous?.target);
    selectedTaskId = selected?.id || '';
    updateLocation();
    function showTask(task, trigger) {
      selected = task;
      selectedTaskId = task.id;
      graph.select(task);
      updateLocation();
      find('[data-pdd-live]').textContent = `${task.kind} task selected: ${task.title}. ${task.depth} repair targets, ${task.lineage.filter((step) => !step.repair).length} preserved setup checkpoints.`;
      openTask(task, trigger);
    }
    const graph = chainMap(appData.mining.nodes, {
      crafting: true, task: selected, tasks: scopeTasks,
      onSelect(node, trigger) {
        const task = scopeTasks.find((entry) => entry.target === node.id);
        if (!task) {
          selected = null;
          selectedTaskId = '';
          graph.select(null);
          updateLocation();
          openMissingTask(node, trigger);
          return;
        }
        showTask(task, trigger);
      }
    });
    activeChain = graph;
    if (!scopeTasks.length) panel.append(element('p', 'pdd-empty', 'No tasks are available for this mode and scope.'));
    panel.append(graph.element);
  }

  function renderPatching() {
    leaderboardWidth = panel.clientWidth;
    panel.replaceChildren(window.ProgramDistillLeaderboard.render(leaderboard, leaderboardWidth));
  }

  const leaderboardResize = new ResizeObserver(() => {
    const width = panel.clientWidth;
    const graph = panel.querySelector('.pdd-depth-chart');
    if (activeView === 'patching' && leaderboard && graph && width > 0 && width !== leaderboardWidth) {
      leaderboardWidth = width;
      graph.replaceWith(window.ProgramDistillLeaderboard.renderDepthChart(leaderboard.partial, width));
    }
  });
  leaderboardResize.observe(panel);

  function renderStage() {
    if (activeChain) { activeChain.destroy(); activeChain = null; }
    if (activeView === 'patching') { renderPatching(); return; }
    if (activeView === 'runs') { renderReplayGallery(); return; }
    if (!appData) return;
    if (activeView === 'mining') renderMining();
    else if (activeView === 'crafting') renderCraft();
    panel.prepend(applicationOverview());
  }

  async function loadApplication() {
    if (activeChain) { activeChain.destroy(); activeChain = null; }
    const serial = ++requestNumber;
    const app = manifest.apps.find((entry) => entry.id === appSelect.value);
    appData = null;
    panel.replaceChildren(element('p', 'pd-description', `Loading ${app.name}...`));
    panel.setAttribute('aria-busy', 'true');
    try {
      const url = assetURL(app.data);
      let data = appCache.get(app.id);
      if (!data) {
        data = normalizeApplication(await getJSON(url));
        requireData(data.id === app.id && isText(data.name) && isObject(data.mining) &&
          Array.isArray(data.mining.nodes) && Array.isArray(data.tasks) && Array.isArray(data.attempts) && Array.isArray(data.trajectories),
        'application records are incomplete');
        requireData(data.tasks.every((task) => isText(task.id) && isText(task.title) &&
          Array.isArray(task.lineage) && isObject(task.verification)), 'task records are incomplete');
        data.name = appNames[data.id];
        appCache.set(app.id, data);
      }
      if (serial !== requestNumber || activeView === 'patching' || activeView === 'runs') return;
      appData = data;
      appDataURL = url;
      renderStage();
    } catch (error) {
      if (serial === requestNumber) showError(error, loadApplication);
    } finally {
      if (serial === requestNumber) panel.removeAttribute('aria-busy');
    }
  }

  function changeView(view) {
    dialog.close(false);
    activeView = view;
    tabs.forEach((tab) => {
      const selected = tab.dataset.pddTab === view;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panel.setAttribute('aria-labelledby', `pdd-tab-${view}`);
    const intro = find('[data-pdd-intro]');
    const explanation = view === 'mining'
      ? 'This panel shows behaviors discovered in the reference app. Each card is a mined behavior, and the links show which behaviors depend on earlier ones.'
      : view === 'crafting'
        ? 'This panel shows repair tasks created by removing the code for discovered behaviors. Atomic tasks remove one behavior; cumulative tasks combine multiple dependent behaviors.'
        : '';
    intro.textContent = explanation;
    intro.hidden = !explanation;
    if (explanation) panel.setAttribute('aria-describedby', intro.id);
    else panel.removeAttribute('aria-describedby');
    find('[data-pdd-controls]').hidden = view === 'patching' || view === 'runs';
    find('[data-pdd-overview]').hidden = view === 'patching' || view === 'runs';
    updateLocation();
    if (view === 'patching' || view === 'runs') {
      requestNumber += 1;
      panel.removeAttribute('aria-busy');
      renderStage();
    } else loadApplication();
  }

  tabs.forEach((tab, index) => {
    tab.id = `pdd-tab-${tab.dataset.pddTab}`;
    tab.setAttribute('aria-controls', 'pdd-main-panel');
    tab.addEventListener('click', () => { if (manifest) changeView(tab.dataset.pddTab); });
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      tabs[next].focus();
      tabs[next].click();
    });
  });
  panel.id = 'pdd-main-panel';
  appSelect.addEventListener('change', () => {
    updateLocation();
    loadApplication();
  });

  async function loadManifest() {
    notice.hidden = false;
    notice.classList.remove('pd-notice-error');
    retry.hidden = true;
    content.hidden = true;
    message.textContent = 'Loading the collection...';
    try {
      applicationSources = await loadApplicationSources(root.dataset.applicationSourcesSrc);
      applicationSources.forEach((app, id) => { appNames[id] = app.label; });
      manifest = await normalizeIndex(await getJSON(manifestURL));
      const leaderboardURL = new URL(root.dataset.leaderboardSrc, document.baseURI);
      requireData(leaderboardURL.origin === location.origin, 'leaderboard must be served by this site');
      leaderboard = window.ProgramDistillLeaderboard.validate(await getJSON(leaderboardURL));
      requireData(manifest.version === 1 && isObject(manifest.summary) && Array.isArray(manifest.apps) &&
        manifest.apps.length > 0, 'a complete version 1 index is required');
      requireData(manifest.apps.every((app) => isText(app.id) && isText(app.name) && isText(app.data) && isObject(app.counts)),
        'application index entries are incomplete');
      requireData(manifest.apps.every((app) => applicationSources.has(app.id)), 'application provenance is incomplete');
      manifest.apps.forEach((app) => { app.name = appNames[app.id]; });
      appSelect.replaceChildren(...manifest.apps.map((app) => {
        const option = element('option', '', app.name);
        option.value = app.id;
        return option;
      }));
      const params = new URLSearchParams(location.search);
      if (manifest.apps.some((app) => app.id === 'vdevired_trello_clone')) appSelect.value = 'vdevired_trello_clone';
      if (manifest.apps.some((app) => app.id === params.get('app'))) appSelect.value = params.get('app');
      taskMode = params.get('mode') === 'cumulative' ? 'cumulative' : 'atomic';
      taskScope = params.get('scope') === 'logic_and_ui' ? 'logic_and_ui' : 'logic_only';
      selectedTaskId = params.get('task') || '';
      referenceMedia.clear();
      curatedError = false;
      miningMediaError = false;
      miningMediaLoaded = false;
      if (root.dataset.curatedSrc) {
        try {
          const curatedURL = new URL(root.dataset.curatedSrc, document.baseURI);
          requireData(curatedURL.origin === location.origin, 'selected media index must be served by this site');
          const data = await getJSON(curatedURL);
          requireData(Array.isArray(data.cases), 'selected recordings are incomplete');
          data.cases.forEach((item) => {
            (item.graph?.nodes || []).forEach((node) => {
              if (node.media?.src) referenceMedia.set(`${item.appId}:${node.id}`, { media: { ...node.media, available: true }, base: curatedURL });
            });
          });
        } catch (_) {
          curatedError = true;
        }
      }
      if (root.dataset.miningMediaSrc) {
        try {
          const catalogURL = new URL(root.dataset.miningMediaSrc, document.baseURI);
          requireData(catalogURL.origin === location.origin, 'mining media catalog must be served by this site');
          const data = await getJSON(catalogURL);
          requireData(data.version === 1 && Array.isArray(data.apps), 'mining media catalog is incomplete');
          const publicMediaBase = root.dataset.miningMediaBase || null;
          const resolveMedia = (path) => publishedAssetURL(
            publicMediaBase ? new URL(path, publicMediaBase).href : path, catalogURL, publicMediaBase);
          const recordings = new Map();
          data.apps.forEach((app) => {
            requireData(isText(app.id) && Array.isArray(app.replays), 'mining media application records are incomplete');
            app.replays.forEach((replay) => {
              requireData(isText(replay.id) && (replay.media === null || isObject(replay.media)), 'mining replay records are incomplete');
              const media = replay.media;
              let publishedMedia = null;
              if (media) {
                requireData(media.kind === 'video' && Number.isFinite(media.bytes) && media.bytes > 0,
                  'published mining recordings need a video type and byte size');
                requireData(isText(media.src) && isText(media.poster), 'mining media paths are required');
                publishedMedia = {
                  ...media, src: resolveMedia(media.src), poster: resolveMedia(media.poster), available: true
                };
              }
              recordings.set(`${app.id}:${replay.id}`, {
                media: publishedMedia || { available: false, status: 'source_missing' },
                base: catalogURL, publicMediaBase
              });
            });
          });
          recordings.forEach((recording, key) => referenceMedia.set(key, recording));
          miningMediaLoaded = true;
        } catch (_) {
          miningMediaError = true;
        }
      }
      await loadAgentReplays();
      find('[data-pdd-overview]').replaceChildren(stats([
        ['web apps', manifest.apps.length],
        ['mined behaviors', displayCount(manifest.summary.behaviors)],
        ['repair tasks', displayCount(manifest.summary.tasks)]
      ]));
      notice.hidden = true;
      content.hidden = false;
      const legacyViews = { overview: 'patching', leaderboard: 'patching', trajectories: 'runs',
        behaviors: 'mining', tasks: 'crafting', attempts: 'crafting' };
      changeView(views.includes(params.get('view')) ? params.get('view') : legacyViews[params.get('view')] || 'patching');
      find('[data-pdd-live]').textContent = `${manifest.apps.length} applications loaded.`;
    } catch (error) {
      manifest = null;
      message.textContent = error instanceof Error ? error.message : 'The collection could not be loaded.';
      notice.classList.add('pd-notice-error');
      retry.hidden = false;
    }
  }

  retry.addEventListener('click', loadManifest);
  loadManifest();
})();
