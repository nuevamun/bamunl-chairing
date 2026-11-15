import test from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../src/lib/redirect.ts';

test('sign-in only ever returns to a page on this site', () => {
  const O = 'https://chairing.bamunl.org';
  for (const ok of ['/', '/c/abc', '/c/abc/display', '/conf/1?x=2', '/%2f%2fevil.com']) assert.equal(safeNext(ok, O), ok);
  for (const bad of ['//evil.com', '/\\evil.com', '/\t/evil.com', '/\n/evil.com', '/\r/evil.com', '/ /evil.com', '/\u2028/evil.com', 'https://evil.com', 'http://x', 'javascript:alert(1)', 'data:text/html,x', '', null, undefined, 'c/abc', '/\u0000//evil.com'])
    assert.equal(safeNext(bad, O), '/', JSON.stringify(bad));
});
