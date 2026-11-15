// One conference: its committees. Add, open, delete (to Recently deleted) and restore.
import { store } from '../lib/store';
import { derive, clock, newCommittee, TRASH_DAYS } from '../lib/engine';
import { askConfirm } from '../lib/confirm';
import { askDelete } from '../lib/guard';
import { trashNote } from '../lib/trash';
import { h } from '../lib/ui';
import { session } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { usernameOf, MIN_PASSWORD } from '../lib/logins';

const id = location.pathname.split('/')[2];
const app = document.getElementById('app')!;
type Login = { user_id: string; username: string; created_at: string };
let logins: Login[] | null = null;       // null until loaded (or not available)
let loginMsg = '';
async function loadLogins() {
  if (!supabase || session().role === 'conference') return;
  const { data } = await supabase.from('ch_conference_logins').select('user_id, username, created_at').eq('conference_id', id).order('created_at');
  logins = (data as Login[]) ?? []; render();
}
async function call(method: string, payload: object): Promise<string> {
  try {
    const r = await fetch('/api/conference-logins', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? '' : (j.error ?? 'Something went wrong.');
  } catch { return 'You’re offline.'; }
}
const gen = () => { const a = crypto.getRandomValues(new Uint8Array(12)); return Array.from(a, (x) => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join(''); };

/** Logins that open only this conference. Shown to the club that owns it, never to the logins themselves. */
function loginsCard(confId: string) {
  if (!supabase || logins === null) return null;
  const user = h('input', { type: 'text', required: true, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-label': 'Username' }) as HTMLInputElement;
  const pw = h('input', { type: 'text', required: true, minlength: MIN_PASSWORD, autocomplete: 'off', 'aria-label': 'Password' }) as HTMLInputElement;
  const form = h('form', { class: 'form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const m = await call('POST', { conferenceId: confId, username: user.value, password: pw.value });
    loginMsg = m || `Made ${user.value.trim().toLowerCase()}. Give them the username and this password: ${pw.value}`;
    if (!m) await loadLogins(); else render();
  } },
    h('div', { class: 'fields' },
      h('label', { class: 'field' }, h('span', null, 'Username'), user),
      h('label', { class: 'field' }, h('span', null, 'Password'), h('div', { class: 'pw' }, pw, h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { pw.value = gen(); } }, 'Make one')))),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary btn--sm' }, 'Add sign-in')));
  const rows = logins.map((l) => {
    const np = h('input', { type: 'text', placeholder: 'New password', minlength: MIN_PASSWORD, autocomplete: 'off', 'aria-label': `New password for ${l.username}` }) as HTMLInputElement;
    return h('li', { class: 'past' },
      h('span', { class: 'past-name mono' }, usernameOf(l.username)),
      h('span', { class: 'login-actions' }, np,
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: async () => {
          if (!np.value) { np.focus(); return; }
          const m = await call('PATCH', { userId: l.user_id, password: np.value });
          loginMsg = m || `Password changed for ${l.username}, and they were signed out. New password: ${np.value}`; render();
        } }, 'Set password'),
        h('button', { type: 'button', class: 'btn btn--danger btn--sm', onclick: async () => {
          if (!(await askConfirm(`Remove ${l.username}?`, 'They can no longer sign in to this conference.', 'Remove', true))) return;
          const m = await call('DELETE', { userId: l.user_id });
          loginMsg = m || ''; await loadLogins();
        } }, 'Remove')));
  });
  return h('section', { class: 'card' }, h('h2', null, 'conference sign-ins'),
    h('p', { class: 'muted' }, 'These open this conference and nothing else. They are separate from the BAMUNL admin logins.'),
    loginMsg ? h('p', { class: 'flash', role: 'status' }, loginMsg) : null,
    form,
    logins.length ? h('ul', { class: 'pasts' }, ...rows) : h('p', { class: 'empty' }, 'None yet.'));
}
store.migrate();

function render() {
  const f = store.conf(id);
  if (!f || f.deletedAt) {
    app.replaceChildren(h('div', { class: 'lead' }, h('h1', { class: 'title' }, 'not found'), h('a', { class: 'btn btn--primary', href: '/' }, 'All conferences')));
    return;
  }
  document.title = `${f.name} · BAMUNL Chairing`;
  const name = h('input', { type: 'text', name: 'name', required: true, autocomplete: 'off', id: 'cname' }) as HTMLInputElement;
  const form = h('form', { class: 'card form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return;
    if (!(await askConfirm('Add this committee?', `${n} · ${f.name}`, 'Add'))) return;
    const c = newCommittee(n, f.name, f.id);
    store.put(c);
    location.href = `/c/${c.id}`;
  } },
    h('h2', null, 'add a committee'),
    h('label', { class: 'field' }, h('span', null, 'Committee'), name),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary' }, 'Add')));

  const list = store.all(f.id);
  const cards = list.length ? list.map((c) => {
    const s = derive(c);
    const spoke = s.speeches.reduce((a, x) => a + x.used, 0);
    const last = c.events.at(-1)?.t;
    return h('article', { class: 'committee' },
      h('a', { class: 'committee-main', href: `/c/${c.id}` }, h('strong', null, c.name),
        h('span', { class: 'committee-stats' }, ...[`${c.delegates.length} delegates`, `${s.speeches.length} speeches${spoke ? ` · ${clock(spoke)}` : ''}`, `${s.motions.length} motions`, last ? `last used ${new Date(last).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'not used yet'].map((t) => h('span', null, t)))),
      h('button', { type: 'button', class: 'btn btn--danger btn--sm', 'aria-label': `Delete ${c.name}`, onclick: async () => {
        if (await askDelete(`Delete ${c.name}?`, `Kept in Recently deleted for ${TRASH_DAYS} days, then removed for good with its feedback and scores.`)) { store.softDelete(c.id); render(); }
      } }, 'Delete'));
  }) : [h('p', { class: 'empty' }, 'No committees yet.')];

  const trash = store.trash(f.id);
  app.replaceChildren(
    h('div', { class: 'lead' }, session().role === 'conference' ? null : h('a', { class: 'crumb', href: '/' }, '← All conferences'), h('h1', { class: 'title' }, f.name.toLowerCase())),
    h('div', { class: 'committees' }, ...cards),
    form,
    session().role === 'conference' ? null : loginsCard(f.id),
    trash.length ? h('details', { class: 'card trash' }, h('summary', null, `Recently deleted (${trash.length})`),
      h('ul', { class: 'pasts' }, ...trash.map((c) => h('li', { class: 'past' },
        h('span', { class: 'past-name' }, c.name, h('span', { class: 'muted' }, ' · ' + trashNote(c.deletedAt!))),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { store.restore(c.id); render(); } }, 'Restore'))))) : null);
}
render();
loadLogins();
store.subscribe(render);
