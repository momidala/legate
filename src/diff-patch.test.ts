import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPatch } from 'diff';
import { getDiff } from './handlers.js';
import { OpenCodeApiError } from './errors.js';

// legate-e1i: rework of the old SURF-01 tests. The previous version re-implemented
// getDiff's mapping inline and mostly exercised the third-party `diff` library. These
// tests drive the REAL getDiff (build/handlers.js) with a mock OpenCode client so the
// production mapping — API-patch preference, createPatch fallback, error propagation,
// empty-data handling — is what is actually under test.

type DiffData = Array<Record<string, unknown>>;

// Minimal client stub — getDiff only touches client.session.diff({ path, query }).
function mockClient(diffResult: { data?: DiffData; error?: unknown }): Parameters<typeof getDiff>[0] {
  return {
    session: {
      diff: async () => diffResult,
    },
  } as unknown as Parameters<typeof getDiff>[0];
}

test('legate-e1i: getDiff prefers the API-provided patch when present', async () => {
  const apiPatch = '--- a/foo.ts\n+++ b/foo.ts\n@@ real api patch @@\n';
  const client = mockClient({
    data: [{ file: 'foo.ts', before: 'x\n', after: 'y\n', additions: 1, deletions: 1, patch: apiPatch }],
  });
  const result = await getDiff(client, 'ses_1', undefined, undefined);
  assert.equal(result.length, 1);
  assert.equal(result[0].patch, apiPatch, 'API patch must be used verbatim, not regenerated');
  // Original fields are preserved.
  assert.equal(result[0].file, 'foo.ts');
  assert.equal(result[0].additions, 1);
  assert.equal(result[0].deletions, 1);
});

test('legate-e1i: getDiff falls back to createPatch when the API omits patch', async () => {
  const client = mockClient({
    data: [{ file: 'bar.ts', before: 'old\n', after: 'new\n', additions: 1, deletions: 1 }],
  });
  const result = await getDiff(client, 'ses_1', undefined, undefined);
  assert.equal(result.length, 1);
  // Must match exactly what createPatch(file, before, after) produces.
  assert.equal(result[0].patch, createPatch('bar.ts', 'old\n', 'new\n'));
  assert.ok(result[0].patch.includes('-old'));
  assert.ok(result[0].patch.includes('+new'));
});

test('legate-e1i: getDiff falls back to createPatch with empty strings when before/after are absent', async () => {
  const client = mockClient({ data: [{ file: 'gone.ts', additions: 0, deletions: 0 }] });
  const result = await getDiff(client, 'ses_1', undefined, undefined);
  assert.equal(result[0].patch, createPatch('gone.ts', '', ''));
});

test('legate-e1i: getDiff throws OpenCodeApiError when the SDK returns an error', async () => {
  const client = mockClient({ error: { name: 'NotFoundError', status: 404 } });
  await assert.rejects(
    () => getDiff(client, 'ses_1', undefined, undefined),
    (err: unknown) => {
      assert.ok(err instanceof OpenCodeApiError, 'error must be a typed OpenCodeApiError');
      assert.equal(err.isNotFound(), true, 'a 404 error must report isNotFound()');
      return true;
    },
  );
});

test('legate-e1i: getDiff returns [] when the API reports no changed files (empty data)', async () => {
  const client = mockClient({ data: [] });
  const result = await getDiff(client, 'ses_1', undefined, undefined);
  assert.deepEqual(result, []);
});

test('legate-e1i: getDiff returns [] when the API returns null data', async () => {
  const client = mockClient({ data: undefined });
  const result = await getDiff(client, 'ses_1', undefined, undefined);
  assert.deepEqual(result, []);
});

// Minimal createPatch sanity check retained — getDiff's fallback depends on this shape.
test('legate-e1i: createPatch sanity — produces a string carrying the filename and +/- markers', () => {
  const patch = createPatch('a.ts', 'old\n', 'new\n');
  assert.equal(typeof patch, 'string');
  assert.ok(patch.includes('a.ts'));
  assert.ok(patch.includes('-old'));
  assert.ok(patch.includes('+new'));
});
