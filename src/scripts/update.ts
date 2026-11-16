// An open tab keeps running the code it loaded, even after a new version is deployed. This checks now and then,
// and offers a reload when the site has moved on. It never reloads by itself: a chair may be mid-session.
let shown = false;
async function check() {
  if (shown || __BUILD__ === 'dev') return;
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return;
    const { build } = await r.json();
    if (build && build !== __BUILD__) offer();
  } catch { /* offline: try again later */ }
}
function offer() {
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update'; bar.setAttribute('role', 'status');
  const msg = document.createElement('span'); msg.textContent = 'A newer version is ready.';
  const go = document.createElement('button'); go.type = 'button'; go.className = 'btn btn--primary btn--sm'; go.textContent = 'Reload';
  go.onclick = () => location.reload();
  bar.append(msg, go); document.body.append(bar);
}
setTimeout(check, 5_000);
setInterval(check, 120_000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
