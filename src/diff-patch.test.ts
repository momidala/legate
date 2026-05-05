import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPatch } from 'diff';

// SURF-01 behavior tests for createPatch integration.
// These verify the exact behavior the prefect_get_diff handler depends on.

test('SURF-01: createPatch returns a string for a simple change', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  assert.equal(typeof patch, 'string');
});

test('SURF-01: patch contains the filename in the header', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  assert.ok(patch.includes('a.ts'), `Expected patch to include "a.ts", got:\n${patch}`);
});

test('SURF-01: patch contains removed line marker for before content', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  assert.ok(patch.includes('-old'), `Expected patch to include "-old", got:\n${patch}`);
});

test('SURF-01: patch contains added line marker for after content', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  assert.ok(patch.includes('+new'), `Expected patch to include "+new", got:\n${patch}`);
});

test('SURF-01: empty before and after produces a valid patch string (no error)', () => {
  const patch = createPatch('empty.ts', '', '');
  assert.equal(typeof patch, 'string');
});

test('SURF-01: map over FileDiff array produces patch field on each element', () => {
  // Simulate the handler logic: (data ?? []).map(d => ({ ...d, patch: createPatch(d.file, d.before, d.after) }))
  const data = [
    { file: 'a.ts', before: 'old\n', after: 'new\n', additions: 1, deletions: 1 },
  ];
  const withPatch = (data ?? []).map((d) => ({
    ...d,
    patch: createPatch(d.file, d.before, d.after),
  }));
  assert.equal(withPatch.length, 1);
  const item = withPatch[0];
  // All original fields preserved
  assert.equal(item.file, 'a.ts');
  assert.equal(item.before, 'old\n');
  assert.equal(item.after, 'new\n');
  assert.equal(item.additions, 1);
  assert.equal(item.deletions, 1);
  // patch field added as a string
  assert.equal(typeof item.patch, 'string');
  assert.ok(item.patch.includes('a.ts'));
  assert.ok(item.patch.includes('-old'));
  assert.ok(item.patch.includes('+new'));
});

test('SURF-01: empty array produces empty array (no patches to compute)', () => {
  const data: Array<{ file: string; before: string; after: string; additions: number; deletions: number }> = [];
  const withPatch = (data ?? []).map((d) => ({
    ...d,
    patch: createPatch(d.file, d.before, d.after),
  }));
  assert.equal(withPatch.length, 0);
});
