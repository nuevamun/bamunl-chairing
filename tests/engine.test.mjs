import test from 'node:test';
import assert from 'node:assert/strict';
import { derive, statsFor, newCommittee, passes, motionTypes, parseNames, checkMod, DEFAULT_CONFIG, modCapacity, modFull, unmodLeft, elapsed, evaluate, recommend, WEIGHT_PRESETS } from '../src/lib/engine.ts';

const mk = () => { const c = newCommittee('UNSC'); c.needsOpen = false;   // these tests start with a list already open, like committees made before lists had to be opened
  c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }]; return c; };
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
  const s = derive(c); assert.equal(s.gslOpen, true); assert.equal(s.motions[0].result, 'failed');
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

test('amending changes the details and the owner, and is kept in the record', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' });
  const id = c.events[0].id;
  E(c, 1, 'amend', { target: id, params: { total: 5, per: 30 }, by: 'b' });
  let s = derive(c);
  assert.deepEqual(s.proposed[0].params, { total: 5, per: 30 });
  assert.equal(s.proposed[0].by, 'b'); assert.equal(s.proposed[0].amended, true);
  E(c, 2, 'vote', { target: id, result: 'passed' });
  s = derive(c);
  assert.equal(s.mode.total, 300); assert.equal(s.mode.per, 30);       // the amended numbers are what took effect
  assert.equal(s.motions[0].by, 'b'); assert.equal(s.motions[0].amended, true);
  E(c, 3, 'undo', { target: c.events[1].id });                         // undo of the amend restores the original
  assert.equal(derive(c).mode.total, 600);
});

test('a moderated caucus opens the list without starting the clock; the proposer picks first or last', () => {
  const c = mk();
  c.delegates.push({ id: 'z', name: 'Chad' });
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a' }); E(c, 1, 'vote', { result: 'passed' });
  let s = derive(c);
  assert.equal(s.mode.kind, 'mod'); assert.equal(s.mode.startedAt, null); assert.equal(s.mode.slot, '');
  E(c, 2, 'add', { d: 'b' });
  E(c, 3, 'proposer_slot', { slot: 'last' });
  E(c, 4, 'add', { d: 'z' });                                  // someone added later still goes before the proposer
  s = derive(c);
  assert.deepEqual(s.lists.mod, ['b', 'z', 'a']);
  assert.equal(s.mode.startedAt, null);                         // still not started
  E(c, 5, 'start', { d: 'b' });
  assert.equal(derive(c).mode.startedAt, 5);                    // the clock starts with the first speaker
});
test('proposer can speak first, or skip', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 5, per: 30 }, by: 'a' }); E(c, 1, 'vote', { result: 'passed' });
  E(c, 2, 'add', { d: 'b' }); E(c, 3, 'proposer_slot', { slot: 'first' });
  assert.deepEqual(derive(c).lists.mod, ['a', 'b']);
  const d = mk();
  E(d, 0, 'floor', { key: 'mod', params: { total: 5, per: 30 }, by: 'a' }); E(d, 1, 'vote', { result: 'passed' }); E(d, 2, 'proposer_slot', { slot: 'none' });
  assert.deepEqual(derive(d).lists.mod, []);
});

test('motion types run most to least disruptive, "other" last; retired ones stay out of the buttons but still read', () => {
  const old = { speakTime: 60, majority: 'simple', motions: [{ key: 'close', label: 'Close the speakers list', effect: 'close', fields: [] }, { key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [] }, { key: 'custom', label: 'Our own', effect: 'none', fields: [] }] };
  assert.deepEqual(motionTypes(old).map((m) => m.key), ['votingbloc', 'unmod', 'mod', 'roundrobin', 'openlist', 'speaktime', 'custom', 'other']);
  assert.equal(motionTypes(old).find((m) => m.key === 'mod').label, 'Moderated caucus');
});

test('pasted lists become delegate names whatever the line breaks', () => {
  assert.deepEqual(parseNames('France\nPeru\nGhana'), ['France', 'Peru', 'Ghana']);
  assert.deepEqual(parseNames('France\r\nPeru\r\nGhana\r\n'), ['France', 'Peru', 'Ghana']);   // Windows
  assert.deepEqual(parseNames('France\rPeru\rGhana'), ['France', 'Peru', 'Ghana']);             // old Mac
  assert.deepEqual(parseNames('France\u2028Peru\u000bGhana'), ['France', 'Peru', 'Ghana']);       // Docs / Word soft breaks
  assert.deepEqual(parseNames('France\tPeru\tGhana'), ['France', 'Peru', 'Ghana']);               // a spreadsheet row
  assert.deepEqual(parseNames('1. France\n2) Peru\n- Ghana\n• Chad'), ['France', 'Peru', 'Ghana', 'Chad']);
  assert.deepEqual(parseNames('Korea, Republic of\nkorea, republic of\n  Cote   d\'Ivoire '), ['Korea, Republic of', "Cote d'Ivoire"]);
  assert.deepEqual(parseNames('  \n\n '), []);
});

test('a moderated caucus carries its topic from proposal through amendment into the running caucus', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 45 }, by: 'a', topic: '  Water access  ' });
  const id = c.events[0].id;
  assert.equal(derive(c).proposed[0].topic, 'Water access');
  E(c, 1, 'amend', { target: id, topic: 'Clean water financing' });
  E(c, 2, 'vote', { target: id, result: 'passed' });
  const s = derive(c);
  assert.equal(s.mode.topic, 'Clean water financing'); assert.equal(s.motions[0].topic, 'Clean water financing');
});

test('when a motion passes, the rest of the floor is reset and logged as not voted', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'unmod', params: { total: 5 } }); E(c, 1, 'floor', { key: 'mod', params: { total: 10, per: 45 } });
  const first = c.events[0].id;
  E(c, 2, 'vote', { target: first, result: 'passed' });
  const s = derive(c);
  assert.equal(s.proposed.length, 0); assert.equal(s.mode.kind, 'unmod');
  assert.deepEqual(s.motions.map((m) => m.result), ['passed', 'withdrawn']);
});
test('a failed motion leaves the rest of the floor alone', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'unmod', params: { total: 5 } }); E(c, 1, 'floor', { key: 'mod', params: { total: 10, per: 45 } });
  E(c, 2, 'vote', { target: c.events[0].id, result: 'failed' });
  assert.equal(derive(c).proposed.length, 1);
});
test('round robin lists everyone present once, with no caucus clock', () => {
  const c = mk(); c.delegates.push({ id: 'z', name: 'Chad' });
  E(c, 0, 'attend', { d: 'a', s: 'present' }); E(c, 1, 'attend', { d: 'z', s: 'pv' });      // Peru absent
  E(c, 2, 'floor', { key: 'roundrobin', params: { per: 30 } }); E(c, 3, 'vote', { result: 'passed' });
  const s = derive(c);
  assert.deepEqual(s.lists.mod, ['a', 'z']); assert.equal(s.mode.rr, true); assert.equal(s.mode.per, 30);
});
test('opening the speakers list ends a caucus and reopens a closed list', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'close' }); E(c, 1, 'vote', { result: 'passed' });
  assert.equal(derive(c).gslOpen, false);
  E(c, 2, 'floor', { key: 'openlist' }); E(c, 3, 'vote', { result: 'passed' });
  const s = derive(c); assert.equal(s.gslOpen, true); assert.equal(s.mode.kind, 'gsl');
});
test('moving into voting bloc takes two-thirds when decided by counts', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'votingbloc' }); E(c, 1, 'vote', { yes: 5, no: 3 });          // simple majority would pass; two-thirds does not
  assert.equal(derive(c).mode.kind, 'gsl'); assert.equal(derive(c).motions[0].result, 'failed');
  E(c, 2, 'floor', { key: 'votingbloc' }); E(c, 3, 'vote', { yes: 6, no: 3 });
  assert.equal(derive(c).mode.kind, 'voting'); assert.equal(derive(c).mode.label, 'Voting bloc');   // says where we are, not what was moved
});

test('a moderated caucus must be a whole number of speeches', () => {
  assert.equal(checkMod(10, 60), ''); assert.equal(checkMod(10, 30), ''); assert.equal(checkMod(9, 45), ''); assert.equal(checkMod(5, 20), '');
  const bad = checkMod(10, 45);
  assert.match(bad, /10 min doesn’t divide into 45 s speeches/);
  assert.match(bad, /9 or 12 min/);                                  // totals that work with 45 s
  assert.match(bad, /40, 50, 60 s per speaker|30, 40, 50 s|40, 50/);   // speech lengths that work with 10 min
  assert.notEqual(checkMod(2, 90), ''); assert.notEqual(checkMod(1, 120), '');   // longer than the caucus
  assert.notEqual(checkMod(0, 45), '');
});
test('the default moderated caucus is itself valid', () => {
  const mod = DEFAULT_CONFIG.motions.find((m) => m.key === 'mod');
  assert.equal(checkMod(mod.fields[0].def, mod.fields[1].def), '');
  const old = { speakTime: 60, majority: 'simple', motions: [{ key: 'mod', label: 'Moderated caucus', effect: 'mod', fields: [{ key: 'per', def: 45 }] }] };
  const fixed = motionTypes(old).find((m) => m.key === 'mod');
  assert.equal(checkMod(fixed.fields[0].def, fixed.fields[1].def), '');   // an older saved 10|45 default is replaced
});

test('a new committee has no speakers list until a motion opens it; a moderated caucus has its own order of speaking', () => {
  const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }, { id: 'b', name: 'Peru' }];
  E(c, 0, 'add', { d: 'a' });
  assert.equal(derive(c).gslOpen, false); assert.deepEqual(derive(c).lists.gsl, []);      // nothing to add to yet
  E(c, 1, 'floor', { key: 'openlist' }); E(c, 2, 'vote', { result: 'passed' });
  E(c, 3, 'add', { d: 'a' });
  assert.equal(derive(c).gslOpen, true); assert.deepEqual(derive(c).lists.gsl, ['a']);
  E(c, 4, 'floor', { key: 'mod', params: { total: 10, per: 60 }, by: '' }); E(c, 5, 'vote', { result: 'passed' });
  E(c, 6, 'add', { d: 'b' });
  const s = derive(c);
  assert.deepEqual(s.lists.mod, ['b']); assert.deepEqual(s.lists.gsl, ['a']);               // separate lists
});
test('a caucus works before any speakers list is open', () => {
  const c = newCommittee('UNSC'); c.delegates = [{ id: 'a', name: 'France' }];
  E(c, 0, 'floor', { key: 'mod', params: { total: 10, per: 60 } }); E(c, 1, 'vote', { result: 'passed' }); E(c, 2, 'add', { d: 'a' });
  assert.deepEqual(derive(c).lists.mod, ['a']);
  E(c, 3, 'end_caucus'); assert.equal(derive(c).gslOpen, false);
});

test('a moderated caucus holds only as many speakers as its time allows', () => {
  const c = mk(); c.delegates = Array.from({ length: 6 }, (_, i) => ({ id: 'd' + i, name: 'D' + i }));
  E(c, 0, 'floor', { key: 'mod', params: { total: 3, per: 60 } }); E(c, 1, 'vote', { result: 'passed' });   // 3 minutes at 60 s = 3 speakers
  assert.equal(modCapacity(derive(c).mode), 3);
  for (let i = 0; i < 6; i++) E(c, 2 + i, 'add', { d: 'd' + i });
  let s = derive(c);
  assert.deepEqual(s.lists.mod, ['d0', 'd1', 'd2']);              // d3 to d5 were refused
  assert.equal(modFull(s), true);
  E(c, 10, 'start', { d: 'd0' }); E(c, 11, 'stop', { how: 'done' });   // one has spoken: still full, they used a place
  s = derive(c); assert.equal(s.mode.spoke, 1);
  E(c, 12, 'add', { d: 'd3' }); assert.deepEqual(derive(c).lists.mod, ['d1', 'd2']);
  E(c, 13, 'drop', { d: 'd2' }); E(c, 14, 'add', { d: 'd3' });       // removing someone frees the place
  assert.deepEqual(derive(c).lists.mod, ['d1', 'd3']);
});
test('a round robin and the general list have no such limit', () => {
  const c = mk(); c.delegates = Array.from({ length: 5 }, (_, i) => ({ id: 'd' + i, name: 'D' + i }));
  E(c, 0, 'floor', { key: 'roundrobin', params: { per: 30 } }); E(c, 1, 'vote', { result: 'passed' });
  assert.equal(modCapacity(derive(c).mode), Infinity); assert.equal(derive(c).lists.mod.length, 5);
});

function room() {
  const c = mk(); c.delegates.push({ id: 'z', name: 'Chad' });
  // France: strong on substance. Peru: strong on procedure. Chad: nothing scored.
  E(c, 0, 'score', { d: 'a', cat: 'Substance', v: 5 }); E(c, 1, 'score', { d: 'a', cat: 'Procedure', v: 2 });
  E(c, 2, 'score', { d: 'b', cat: 'Substance', v: 2 }); E(c, 3, 'score', { d: 'b', cat: 'Procedure', v: 5 });
  return c;
}
test('weights decide who is recommended', () => {
  const c = room();
  const sub = evaluate(c, derive(c), { substance: 90, procedure: 10 });
  assert.equal(recommend(sub, derive(c)).winner.d, 'a');
  const proc = evaluate(c, derive(c), { substance: 10, procedure: 90 });
  assert.equal(recommend(proc, derive(c)).winner.d, 'b');
});
test('totals are out of 100, ignore how big the weights are, and unscored counts as zero', () => {
  const c = room(); const s = derive(c);
  const a = evaluate(c, s, { substance: 1 }).find((r) => r.d === 'a'), b = evaluate(c, s, { substance: 500 }).find((r) => r.d === 'a');
  assert.equal(a.total, 100); assert.equal(b.total, 100);                         // 5/5 on the only weighted criterion
  assert.equal(evaluate(c, s, { substance: 1 }).find((r) => r.d === 'z').total, 0);  // Chad: nothing scored
});
test('no recommendation until there is something to judge on', () => {
  const c = mk(); c.delegates.push({ id: 'z', name: 'Chad' });
  assert.equal(recommend(evaluate(c, derive(c), WEIGHT_PRESETS.balanced.weights), derive(c)).enough, false);
});
test('session numbers count: speeches, time used, motions passed', () => {
  const c = mk();
  E(c, 0, 'start', { d: 'a' }); E(c, 60000, 'stop', { how: 'done' });            // France uses all 60 s
  E(c, 61000, 'floor', { key: 'unmod', params: { total: 5 }, by: 'a' }); E(c, 62000, 'vote', { result: 'passed' });
  const rows = evaluate(c, derive(c), { participation: 1, timeuse: 1, motions: 1 });
  const a = rows.find((r) => r.d === 'a'), b = rows.find((r) => r.d === 'b');
  assert.equal(a.total, 100); assert.equal(b.total, 0);
  assert.equal(recommend(rows, derive(c)).winner.d, 'a');
});
test('a near tie is flagged as a close call', () => {
  const c = mk();
  E(c, 0, 'score', { d: 'a', cat: 'Substance', v: 5 }); E(c, 1, 'score', { d: 'b', cat: 'Substance', v: 5 });
  const r = recommend(evaluate(c, derive(c), { substance: 1 }), derive(c));
  assert.equal(r.close, true); assert.equal(r.tied.length, 2);
});

test('a caucus ends when its last speech is given, not when time runs out', () => {
  const c = mk(); c.delegates = Array.from({ length: 4 }, (_, i) => ({ id: 'd' + i, name: 'D' + i }));
  E(c, 0, 'floor', { key: 'mod', params: { total: 2, per: 60 } }); E(c, 1, 'vote', { result: 'passed' });   // 2 speeches
  E(c, 2, 'add', { d: 'd0' }); E(c, 3, 'add', { d: 'd1' });
  E(c, 4, 'start', { d: 'd0' }); E(c, 4 + 90_000, 'stop', { how: 'done' });                    // ran 90 s over, caucus's 2 minutes now spent
  let s = derive(c);
  assert.equal(s.mode.kind, 'mod'); assert.equal(s.mode.spoke, 1);                             // still going: one speech to go
  E(c, 5, 'start', { d: 'd1' }); E(c, 5 + 20 * 60_000, 'stop', { how: 'done' });                // twenty minutes later, the last speech ends it
  s = derive(c);
  assert.equal(s.mode.kind, 'gsl'); assert.equal(s.speeches.length, 2);
});
test('a round robin ends once everyone on it has spoken', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'roundrobin', params: { per: 30 } }); E(c, 1, 'vote', { result: 'passed' });
  E(c, 2, 'start', { d: 'a' }); E(c, 3, 'stop', {});
  assert.equal(derive(c).mode.kind, 'mod');
  E(c, 4, 'start', { d: 'b' }); E(c, 5, 'stop', {});
  assert.equal(derive(c).mode.kind, 'gsl');
});

test('a full caucus stays full as speakers finish, including when they yield to the chair', () => {
  const c = mk(); c.delegates = Array.from({ length: 26 }, (_, i) => ({ id: 'd' + i, name: 'D' + i }));
  E(c, 0, 'floor', { key: 'mod', params: { total: 12, per: 60 } }); E(c, 1, 'vote', { result: 'passed' });   // 12 speakers
  let t = 2;
  for (let i = 0; i < 26; i++) E(c, t++, 'add', { d: 'd' + i });
  assert.equal(derive(c).lists.mod.length, 12);
  for (let i = 0; i < 6; i++) {
    E(c, t++, 'start', { d: 'd' + i });
    E(c, t++, 'stop', { how: i % 2 ? 'chair' : 'done' });                // some yield to the chair, some run out
  }
  let s = derive(c);
  assert.equal(s.mode.spoke, 6); assert.equal(s.lists.mod.length, 6);
  for (let i = 12; i < 26; i++) E(c, t++, 'add', { d: 'd' + i });          // the room is still full: 6 spoke + 6 waiting
  assert.equal(derive(c).lists.mod.length, 6);
  assert.equal(modFull(derive(c)), true);
  E(c, t++, 'drop', { d: 'd6' });                                           // taking one off frees exactly one place
  E(c, t++, 'add', { d: 'd12' }); E(c, t++, 'add', { d: 'd13' });
  assert.equal(derive(c).lists.mod.length, 6);
});

test('an unmoderated caucus clock can be paused and resumed, and never ends by itself', () => {
  const c = mk();
  E(c, 0, 'floor', { key: 'unmod', params: { total: 10 } }); E(c, 1000, 'vote', { result: 'passed' });   // starts at t=1000
  assert.equal(unmodLeft(derive(c).mode, 61_000), 540);                      // a minute in
  E(c, 61_000, 'caucus_pause');
  assert.equal(unmodLeft(derive(c).mode, 3_661_000), 540);                   // an hour later, still frozen
  E(c, 3_661_000, 'caucus_resume');
  assert.equal(unmodLeft(derive(c).mode, 3_721_000), 480);                   // another minute runs
  assert.equal(derive(c).mode.kind, 'unmod');
  assert.ok(unmodLeft(derive(c).mode, 99_999_999) < 0);                      // way over time: still the chair's call to end it
  E(c, 100_000_000, 'caucus_pause'); E(c, 100_000_001, 'caucus_pause');        // a double pause changes nothing
  assert.equal(derive(c).mode.since, null);
});

test('undoing a Stop puts the speaker back paused where they stopped', () => {
  const c = mk();
  E(c, 0, 'start', { d: 'a' }); E(c, 20_000, 'stop', { how: 'done' });
  const stopId = c.events[1].id;
  E(c, 20_500, 'undo', { target: stopId });                                     // the chair realises it was a misclick
  const s = derive(c);
  assert.equal(s.speaking.d, 'a'); assert.equal(s.speaking.since, null);        // paused, not running
  assert.equal(elapsed(s.speaking, 600_000), 20);                                // ten minutes later they have still used only 20 s
  E(c, 700_000, 'resume'); assert.equal(Math.round(elapsed(derive(c).speaking, 710_000)), 30);
});
test('a double click on Start does not give someone an instant empty speech', () => {
  const c = mk();
  E(c, 0, 'start', { d: 'a' }); E(c, 50, 'start', { d: 'a' });
  const s = derive(c);
  assert.equal(s.speeches.length, 0); assert.equal(s.speaking.d, 'a'); assert.equal(s.speaking.start, 0);
});
