// Registers the service worker (public/sw.js) so the app keeps working when the wifi drops.

if ('serviceWorker' in navigator) {
  addEventListener('load', async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js');
      // Once per version, while the network is good, ask it to keep every kind of page and its files. Not on the
      // sign-in page: the other pages would just redirect there.
      const ready = await navigator.serviceWorker.ready;
      let warmed = '';
      try { warmed = localStorage.getItem('chairing:warmed') ?? ''; } catch { /* ignore */ }
      if (navigator.onLine && location.pathname !== '/login' && warmed !== __BUILD__) {
        (ready.active ?? reg.active)?.postMessage({ type: 'warm' });
        try { localStorage.setItem('chairing:warmed', __BUILD__); } catch { /* ignore */ }
      }
    } catch { /* no service worker here (private window, old browser): the app still works while online */ }
  });
}
