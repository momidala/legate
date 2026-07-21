import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

// RENAME-03: All tool registrations use the legate_ prefix. Zero prefect_ names remain.
//
// Rationale: tool names are string literals — TypeScript compilation cannot catch
// 'prefect_create_session' as an error. This test reads the source directly and asserts
// the structural contract that no automated type check enforces.
//
// legate-hry: after the index.ts split, the 40 tool registrations live across the four
// src/tools/*.ts modules (core, composites, session, discovery) rather than in
// index.ts. This test now scans every file in src/tools/ so the invariants track the
// tools wherever they are declared. The shared wrapper *definitions* live in
// server-context.ts (not scanned) and take the `name` identifier — not a string literal
// — so they would be excluded even if scanned.
//
// Invariants (deliberately no hard-coded tool count — the total grows as tools are
// added, so it is derived from the source rather than pinned):
//   1. Zero prefect_ tool names remain.
//   2. Every registration call site's name starts with legate_ — i.e.
//      legate.length + prefect.length === total call site count, with
//      prefect.length === 0. This catches any unclassified/misnamed tool.
//   3. No tool name is registered more than once.

const TOOLS_DIR = resolve(process.cwd(), 'src/tools');

// After the registration refactor, tools register through one of three call sites — the
// two shared wrappers registerSessionTool(...) / registerServerTool(...) and direct
// server.registerTool(...) for the handful of tools with bespoke control flow. All three
// take the tool-name string literal as their first argument, so the name-extraction regex
// accepts any of the three. The wrapper *definitions* (server-context.ts) call
// server.registerTool(name, ...) with the `name` identifier (not a string literal), so
// they are naturally excluded — the regex requires a quoted literal after the paren.
const TOOL_REGISTRATION = /(?:server\.registerTool|registerSessionTool|registerServerTool)\(\s*\n?\s*'([^']+)'/g;

// legate-hry: concatenate every src/tools/*.ts source so the invariants scan all four
// registration modules at once.
function readToolSources(): string {
  return readdirSync(TOOLS_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort()
    .map((f) => readFileSync(join(TOOLS_DIR, f), 'utf8'))
    .join('\n');
}

function loadToolNames(src: string): { legate: string[]; prefect: string[] } {
  const legate: string[] = [];
  const prefect: string[] = [];
  const pattern = new RegExp(TOOL_REGISTRATION.source, 'g');
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

test('RENAME-03: zero prefect_ tool names remain in src/tools registerTool calls', () => {
  const src = readToolSources();
  const { prefect } = loadToolNames(src);

  assert.equal(
    prefect.length,
    0,
    `Expected 0 prefect_* tool registrations, found ${prefect.length}.\nStale prefect_ tools: ${JSON.stringify(prefect)}`,
  );
});

test('RENAME-03: every registerTool call site uses the legate_ prefix (no unclassified tools)', () => {
  const src = readToolSources();
  const { legate, prefect } = loadToolNames(src);
  // Count every named registration call site (across all three registration forms) —
  // catches any tool name that is neither legate_ nor prefect_.
  const totalCalls = (src.match(new RegExp(TOOL_REGISTRATION.source, 'g')) ?? []).length;

  assert.equal(
    legate.length + prefect.length,
    totalCalls,
    `Expected every registration call site's name to start with legate_ or prefect_, ` +
      `but found ${totalCalls} call sites and only classified ${legate.length + prefect.length} ` +
      `(${legate.length} legate_ + ${prefect.length} prefect_). Some tool name does not match either prefix.`,
  );
  assert.equal(
    prefect.length,
    0,
    `Expected 0 prefect_* tool registrations among classified tools, found ${prefect.length}.`,
  );
});

test('RENAME-03: no duplicate legate_ tool registrations', () => {
  const src = readToolSources();
  const { legate } = loadToolNames(src);

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const name of legate) {
    if (seen.has(name)) {
      duplicates.push(name);
    }
    seen.add(name);
  }

  assert.equal(
    duplicates.length,
    0,
    `Expected no duplicate legate_* tool registrations, found duplicates: ${JSON.stringify(duplicates)}.\nAll tools found: ${JSON.stringify(legate, null, 2)}`,
  );
  assert.equal(
    seen.size,
    legate.length,
    `Expected all ${legate.length} legate_* tool names to be unique, found ${seen.size} unique names.`,
  );
});
