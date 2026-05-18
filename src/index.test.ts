import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// RENAME-03: All 40 tool registrations in src/index.ts use the legate_ prefix.
// Zero prefect_ tool names remain.
//
// Rationale: tool names are string literals — TypeScript compilation cannot
// catch 'prefect_create_session' as an error. This test reads the source
// directly and asserts the structural contract that no automated type check
// enforces.

const INDEX_SRC = resolve(process.cwd(), 'src/index.ts');

function loadToolNames(src: string): { legate: string[]; prefect: string[] } {
  const legate: string[] = [];
  const prefect: string[] = [];
  // Match registerTool( followed on the next line (or same line) by the tool name string.
  // The source uses: server.registerTool(\n  'legate_*',
  const pattern = /server\.registerTool\(\s*\n?\s*'([^']+)'/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(src)) !== null) {
    const name = m[1];
    if (name.startsWith('legate_')) {
      legate.push(name);
    } else if (name.startsWith('prefect_')) {
      prefect.push(name);
    }
  }
  return { legate, prefect };
}

test('RENAME-03: all registerTool calls in src/index.ts use legate_ prefix — count is 40', () => {
  const src = readFileSync(INDEX_SRC, 'utf8');
  const { legate } = loadToolNames(src);

  assert.equal(
    legate.length,
    40,
    `Expected exactly 40 legate_* tool registrations, found ${legate.length}.\nTools found: ${JSON.stringify(legate, null, 2)}`,
  );
});

test('RENAME-03: zero prefect_ tool names remain in src/index.ts registerTool calls', () => {
  const src = readFileSync(INDEX_SRC, 'utf8');
  const { prefect } = loadToolNames(src);

  assert.equal(
    prefect.length,
    0,
    `Expected 0 prefect_* tool registrations, found ${prefect.length}.\nStale prefect_ tools: ${JSON.stringify(prefect)}`,
  );
});

test('RENAME-03: total registerTool call count is exactly 40 (no unclassified tools)', () => {
  const src = readFileSync(INDEX_SRC, 'utf8');
  // Count raw registerTool call sites — catches any tool name that is neither legate_ nor prefect_
  const totalCalls = (src.match(/server\.registerTool\(/g) ?? []).length;

  assert.equal(
    totalCalls,
    40,
    `Expected exactly 40 server.registerTool( call sites, found ${totalCalls}. ` +
    `If count differs from 40, the requirement count in RENAME-03 is wrong or a tool was added/removed.`,
  );
});
