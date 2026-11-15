import { signIn, signOut, onStatus } from '../lib/sync';
// Only ever back to a page on this site: a path starting with one slash, never //host or a full address.
const wanted = new URLSearchParams(location.search).get('next') ?? '';
const dest = /^\/(?![\/\\])/.test(wanted) ? wanted : '/';
const f = document.getElementById('f') as HTMLFormElement;
const err = document.getElementById('err')!;
const out = document.getElementById('out') as HTMLButtonElement;
onStatus((s) => { out.hidden = !s.who; });
out.onclick = async () => { await signOut(); };
f.onsubmit = async (e) => {
  e.preventDefault();
  const d = new FormData(f);
  const m = await signIn(String(d.get('email')), String(d.get('password')));
  if (m) { err.textContent = m; err.hidden = false; } else location.href = dest;
};
