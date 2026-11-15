// The main page: conferences. Open one to manage its committees. Deleting goes to "recently deleted" first.
import { store } from '../lib/store';
import { derive, clock, TRASH_DAYS } from '../lib/engine';
import { askConfirm } from '../lib/confirm';
import { askDelete } from '../lib/guard';
import { trashNote } from '../lib/trash';
import { h, mount } from '../lib/ui';
import { session, schools, schoolName } from '../lib/sync';

const app = document.getElementById('app')!;
store.migrate();
const mine = session();
if (mine.role === 'conference' && mine.conferenceId) location.replace(`/conf/${mine.conferenceId}`);   // their conference is all they have

function render() {
  const confs = store.confs();
  const name = h('input', { type: 'text', name: 'name', required: true, autocomplete: 'off', id: 'fname' }) as HTMLInputElement;
  // The master can see every club's conferences and picks whose a new one is. A subadmin's own are always theirs.
  const master = session().role === 'admin';
  const owner = h('select', { name: 'school', 'aria-label': 'Club' }, h('option', { value: '' }, 'No club (this device only)'), ...schools().map((x) => h('option', { value: x.id }, x.name))) as HTMLSelectElement;
  const form = h('form', { class: 'card form', onsubmit: async (e: Event) => {
    e.preventDefault();
    const n = name.value.trim();
    if (!n) return;
    if (!(await askConfirm('Add this conference?', n, 'Add'))) return;
    const f = store.newConf(n, master && owner.value ? owner.value : undefined);
    location.href = `/conf/${f.id}`;
  } },
    h('h2', null, 'add a conference'),
    h('label', { class: 'field' }, h('span', null, 'Conference name'), name),
    master ? h('label', { class: 'field' }, h('span', null, 'Club'), owner) : null,
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary' }, 'Add')));

  const cards = confs.length ? confs.map((f) => {
    const cs = store.all(f.id);
    const delegates = cs.reduce((a, c) => a + c.delegates.length, 0);
    const speeches = cs.reduce((a, c) => a + derive(c).speeches.length, 0);
    const last = Math.max(0, ...cs.map((c) => c.events.at(-1)?.t ?? 0));
    return h('article', { class: 'committee' },
      h('a', { class: 'committee-main', href: `/conf/${f.id}` }, h('strong', null, f.name), master && schoolName(f.schoolId) ? h('span', { class: 'chip' }, schoolName(f.schoolId)) : null,
        h('span', { class: 'committee-stats' }, ...[`${cs.length} committee${cs.length === 1 ? '' : 's'}`, `${delegates} delegates`, `${speeches} speeches`, last ? `last used ${new Date(last).toLocaleDateString([], { month: 'short', day: 'numeric' })}` : 'not used yet'].map((t) => h('span', null, t)))),
      h('button', { type: 'button', class: 'btn btn--danger btn--sm', 'aria-label': `Delete ${f.name}`, onclick: async () => {
        if (await askDelete(`Delete ${f.name}?`, `Its committees go with it. It's kept in Recently deleted for ${TRASH_DAYS} days, then removed for good.`)) { store.softDeleteConf(f.id); render(); }
      } }, 'Delete'));
  }) : [h('p', { class: 'empty' }, 'No conferences yet.')];

  const trash = store.confTrash();
  mount(app, 
    h('div', { class: 'lead' }, h('h1', { class: 'title' }, 'conferences')),
    h('div', { class: 'committees' }, ...cards),
    form,
    trash.length ? h('details', { class: 'card trash' }, h('summary', null, `Recently deleted (${trash.length})`),
      h('ul', { class: 'pasts' }, ...trash.map((f) => h('li', { class: 'past' },
        h('span', { class: 'past-name' }, f.name, h('span', { class: 'muted' }, ' · ' + trashNote(f.deletedAt!))),
        h('button', { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => { store.restoreConf(f.id); render(); } }, 'Restore'))))) : null);
}
render();
store.subscribe(render);
