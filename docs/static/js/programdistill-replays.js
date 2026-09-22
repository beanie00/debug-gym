(() => {
  'use strict';

  const { element, button } = window.ProgramDistillUI;

  function validate(data, base, knownApps) {
    const require = (condition, message) => {
      if (!condition) throw new Error(`Invalid replay gallery: ${message}.`);
    };
    const isText = (value) => typeof value === 'string' && value.trim().length > 0;
    require(data?.version === 1 && Array.isArray(data.replays) && data.replays.length > 0,
      'a nonempty version 1 selection is required');
    const ids = new Set();
    const directory = new URL('.', base);
    data.replays.forEach((replay) => {
      require(replay && typeof replay === 'object' && !Array.isArray(replay), 'invalid recording entry');
      require(['id', 'taskId', 'appId', 'app', 'title', 'model'].every((key) => isText(replay[key])),
        'each recording needs an identity and caption');
      require(!ids.has(replay.id) && knownApps.has(replay.appId), 'duplicate recording or unknown application');
      ids.add(replay.id);
      require(replay.binarySuccess === true && replay.chainScore === 1,
        'the selected gallery contains only complete repairs');
      require(Number.isSafeInteger(replay.depth) && replay.depth > 0 &&
        Number.isSafeInteger(replay.frameCount) && replay.frameCount > 1 &&
        Number.isFinite(replay.durationMs) && replay.durationMs >= 0, 'invalid recording measurements');
      if (replay.layout !== undefined) {
        require(replay.layout === 'reference-current-code' &&
          Number.isSafeInteger(replay.sourceSteps) && replay.sourceSteps > 0, 'invalid trajectory layout');
      }
      const media = replay.media;
      require(media && ['gif', 'video'].includes(media.kind) &&
        Number.isFinite(media.bytes) && media.bytes > 0 &&
        Number.isSafeInteger(media.width) && media.width > 0 &&
        Number.isSafeInteger(media.height) && media.height > 0, 'missing playable media');
      ['src', 'poster'].forEach((key) => {
        require(isText(media[key]) && !media[key].includes('\\'), 'invalid media path');
        const url = new URL(media[key], base);
        require(url.origin === base.origin && !url.username && !url.password &&
          url.pathname.startsWith(directory.pathname), 'media must stay inside this site gallery');
      });
    });
    return data.replays;
  }

  function duration(milliseconds) {
    const seconds = Math.ceil(milliseconds / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  }

  function render(replays, base, onSelect) {
    const section = element('section', 'pdd-replays');
    const apps = new Set(replays.map((replay) => replay.appId));
    const models = new Set(replays.map((replay) => replay.model));
    const recent = replays.every((replay) => replay.layout === 'reference-current-code');
    section.append(element('h2', 'pd-stage-title', 'Agent trajectories'),
      element('p', 'pd-description',
        recent
          ? `${replays.length} recorded GPT-6 Astra repairs across ${apps.size} apps. Watch reference observation, code changes, and current-app verification in one view. Jira includes the failure, debugging, and retry sequence.`
          : `${replays.length} successful repairs across ${apps.size} apps and ${models.size} models. Select a thumbnail to watch the agent's app alongside its working reference.`));
    const gallery = element('div', 'pdd-replay-gallery');
    replays.forEach((replay) => {
      const card = button('pdd-replay-card', '');
      card.dataset.replayId = replay.id;
      card.setAttribute('aria-haspopup', 'dialog');
      card.setAttribute('aria-label', `Watch ${replay.app}: ${replay.title}`);
      const thumbnail = element('span', 'pdd-replay-thumbnail');
      if (recent) thumbnail.style.aspectRatio = `${replay.media.width} / ${replay.media.height}`;
      const placeholder = element('span', 'pdd-replay-placeholder', 'Loading preview...');
      const image = element('img', 'pdd-replay-image');
      image.alt = '';
      image.loading = 'lazy';
      image.decoding = 'async';
      image.onload = () => { placeholder.hidden = true; };
      image.onerror = () => {
        image.hidden = true;
        placeholder.hidden = false;
        placeholder.textContent = 'Preview unavailable. Select to play.';
      };
      image.src = new URL(replay.media.poster, base).href;
      const play = element('span', 'pdd-replay-play');
      play.setAttribute('aria-hidden', 'true');
      play.append(element('span', 'pd-play-icon'), element('span', '', 'Play'));
      thumbnail.append(placeholder, image, play);
      if (replay.durationMs > 0) {
        const time = element('span', 'pdd-replay-duration', duration(replay.durationMs));
        time.setAttribute('aria-label', `Recording duration ${duration(replay.durationMs)}`);
        thumbnail.append(time);
      }
      const caption = element('span', 'pdd-replay-caption');
      caption.append(element('span', 'pdd-replay-app', replay.app),
        element('strong', 'pdd-replay-title', replay.title),
        element('span', 'pdd-replay-meta',
          `${replay.modelLabel} \u00b7 ${replay.depth} feature${replay.depth === 1 ? '' : 's'} restored`));
      card.append(thumbnail, caption);
      card.addEventListener('click', () => onSelect(replay, card));
      gallery.append(card);
    });
    section.append(gallery);
    return section;
  }

  window.ProgramDistillReplayGallery = { validate, render };
})();
