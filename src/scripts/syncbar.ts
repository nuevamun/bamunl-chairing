import { onStatus, startSync, signOut } from '../lib/sync';
import { h } from '../lib/ui';

const el = document.getElementById('sync');
if (location.pathname === '/login') el?.remove();
onStatus((s) => {
  if (!el) return;
  el.className = 'sync' + (s.state === 'error' ? ' sync--err' : '');
  el.replaceChildren(...[
    s.state === 'off' ? 'Saved on this device only'
    : s.state === 'signed-out' ? h('a', { href: '/login' }, 'Sign in')
    : s.state === 'syncing' ? 'Syncing…'
    : s.state === 'error' ? `Not synced${s.pending ? ` (${s.pending} waiting)` : ''}: ${s.message ?? ''}`
    : `${s.pending ? `${s.pending} waiting to send` : 'Synced'} · ${s.who ?? ''}`,
    s.who ? ' ' : null,
    s.who ? h('button', { type: 'button', class: 'linkish', onclick: async () => { await signOut(); location.href = '/login'; } }, 'Sign out') : null].filter((x) => x != null) as Array<Node | string>);
});
startSync();
