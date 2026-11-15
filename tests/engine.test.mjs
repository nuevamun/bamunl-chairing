import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, statsFor, newCommittee, passes } from '../src/lib/engine.ts';

const mk = () => { const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }]; return c; };
let n = 0;
const E = (c, t, type, rest = {}) => c.events.push({ id: 'e' + n++, t, type, ...rest });

test('time left on the table = allotted - used, pauses excluded', () => {
  const c = mk();
  E(c, 0, 'add', { d: 'a' }); E(c, 0, 'add', { d: 'b' });
  E(c, 1000, 'start', { d: 'a' });
  E(c, 21000, 'pause'); E(c, 51000, 'resume'); E(c, 61000, 'stop', { how: 'chair' });   // 20s + 10s used
  const s = derive(c); const st = statsFor(c, s);
  assert.equal(s.speeches[0].used, 30);
  assert.equal(st[0].left, 30);
  assert.equal(st[0].yieldedToChair, 1);
  assert.equal(st[1].listedNotCalled, 1);
});

test('going over is tracked, not negative', () => {
  const c = mk(); E(c, 0, 'start', { d: 'a' }); E(c, 70000, 'stop', { how: 'done' });
  const sp = derive(c).speeches[0]; assert.equal(sp.left, 0); assert.equal(sp.over, 10);
});

test('undo cancels an event', () => {
  const c = mk(); E(c, 0, 'add', { d: 'a' }); const id = c.events[0].id; E(c, 1, 'undo', { target: id });
  assert.deepEqual(derive(c).lists.gsl, []);
});

test('mod caucus passes, uses its own list and per-speaker time; ends back to gsl', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 } }); E(c, 1, 'vote', { yes: 8, no: 2 });
  let s = derive(c); assert.equal(s.mode.kind, 'mod');
  E(c, 2, 'add', { d: 'a' }); E(c, 3, 'start', { d: 'a' }); E(c, 4000, 'stop', {});
  s = derive(c); assert.equal(s.speeches[0].allotted, 45); assert.equal(s.speeches[0].mode, 'mod');
  E(c, 5, 'end_caucus'); assert.equal(derive(c).mode.kind, 'gsl');
});

test('failed motion changes nothing; 2/3 majority', () => {
  const c = mk(); E(c, 0, 'floor', { key: 'close' }); E(c, 1, 'vote', { yes: 3, no: 5 });
  const s = derive(c); assert.equal(s.closed, false); assert.equal(s.motions[0].result, 'failed');
  assert.equal(passes('twothirds', 6, 3), true); assert.equal(passes('twothirds', 5, 3), false);
});

test('several motions can be open; the chair picks which passes or fails', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' });
  E(c, 1, 'floor', { key: 'unmod', params: { total: 5 } });
  const ids = c.events.map((e) => e.id);
  let s = derive(c);
  assert.equal(s.proposed.length, 2);
  assert.equal(s.proposed[0].key, 'unmod');           // precedence order, not order proposed
  E(c, 2, 'vote', { target: ids[0], result: 'failed' });   // no counts needed
  s = derive(c);
  assert.equal(s.proposed.length, 1); assert.equal(s.mode.kind, 'gsl');
  assert.equal(s.motions[0].result, 'failed'); assert.equal(s.motions[0].by, 'a');
  E(c, 3, 'clear_proposed'); s = derive(c);
  assert.equal(s.proposed.length, 0); assert.equal(s.motions.at(-1).result, 'withdrawn');
});
