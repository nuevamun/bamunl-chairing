import { store } from '../lib/store';
import { newCommittee } from '../lib/engine';
import { h } from '../lib/ui';

const app = document.getElementById('app')!;

function render() {
  const list = store.all();
  const name = h('input', { type: 'text', name: 'name', required: true, autocomplete: 'off', id: 'cname' }) as HTMLInputElement;
  const conf = h('input', { type: 'text', name: 'conf', autocomplete: 'off', id: 'cconf' }) as HTMLInputElement;
  const form = h('form', { class: 'card form', onsubmit: (e: Event) => {
    e.preventDefault();
    const c = newCommittee(name.value.trim(), conf.value.trim());
    if (!c.name) return;
    store.put(c);
    location.href = `/c/${c.id}`;
  } },
    h('h2', null, 'new committee'),
    h('div', { class: 'fields' },
      h('label', { class: 'field' }, h('span', null, 'Committee'), name),
      h('label', { class: 'field' }, h('span', null, 'Conference'), conf)),
    h('div', { class: 'form-actions' }, h('button', { class: 'btn btn--primary' }, 'Create')));

  const rows = list.length
    ? list.map((c) => h('a', { class: 'row-link', href: `/c/${c.id}` },
        h('strong', null, c.name), h('span', { class: 'muted' }, [c.conference, `${c.delegates.length} delegates`].filter(Boolean).join(' · '))))
    : [h('p', { class: 'empty' }, 'No committees yet.')];

  app.replaceChildren(
    h('div', { class: 'lead' }, h('h1', { class: 'title' }, 'committees')),
    h('div', { class: 'card rows-card' }, ...rows),
    form);
}
render();
store.subscribe(render);
