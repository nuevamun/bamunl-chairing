import { onStatus, startSync } from '../lib/sync';
import { h } from '../lib/ui';

const el = document.getElementById('sync');
onStatus((s) => {
  if (!el) return;
  el.className = 'sync' + (s.state === 'error' ? ' sync--err' : '');
  el.replaceChildren(
    s.state === 'off' ? 'Saved on this device only'
    : s.state === 'signed-out' ? h('a', { href: '/login' }, 'Sign in to sync')
    : s.state === 'syncing' ? 'Syncing…'
    : s.state === 'error' ? `Not synced${s.pending ? ` (${s.pending} waiting)` : ''}: ${s.message ?? ''}`
    : `${s.pending ? `${s.pending} waiting to send` : 'Synced'} · ${s.who ?? ''}`);
});
startSync();
