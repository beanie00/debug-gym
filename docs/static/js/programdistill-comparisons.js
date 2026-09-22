(() => {
  'use strict';

  const root = document.querySelector('[data-pd-comparisons], [data-pd-comparison-hero]');
  if (!root) return;
  const videos = [...root.querySelectorAll('video')];
  document.addEventListener('play', (event) => {
    if (event.target instanceof HTMLVideoElement) {
      videos.forEach((other) => { if (other !== event.target) other.pause(); });
    }
  }, true);
  videos.forEach((video) => {
    const source = video.querySelector('source');
    const reportError = () => {
      if (video.parentNode.querySelector('[role="alert"]')) return;
      const message = document.createElement('p');
      message.className = 'pd-note';
      message.setAttribute('role', 'alert');
      message.textContent = 'This video could not be loaded. ';
      const link = document.createElement('a');
      link.href = source.src;
      link.download = '';
      link.textContent = 'Download MP4';
      message.append(link);
      video.after(message);
    };
    video.addEventListener('error', reportError);
    source.addEventListener('error', reportError);
    if (video.error || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) reportError();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) videos.forEach((video) => video.pause());
  });
})();
