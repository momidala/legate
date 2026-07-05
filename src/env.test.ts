import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveEnv, resolveEnvInt, resolveEnvNum, _resetWarnFlags } from './env.js';

// legate-lcg: dedicated test names so these tests never collide with real
// LEGATE_*/PREFECT_*/OPENCODE_* vars a developer might have set in their shell.
const NEW = 'LCG_TEST_NEW';
const OLD1 = 'LCG_TEST_OLD1';
const OLD2 = 'LCG_TEST_OLD2';
const NAMES = [NEW, OLD1, OLD2];

function clearAll(): void {
  delete process.env[NEW];
  delete process.env[OLD1];
  delete process.env[OLD2];
}

function captureWarnings(fn: () => void): string[] {
  const warnings: string[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => { warnings.push(args.map(String).join(' ')); };
  try {
    fn();
  } finally {
    console.error = orig;
  }
  return warnings;
}

beforeEach(() => {
  _resetWarnFlags();
  clearAll();
});

// ── resolveEnv: selection ────────────────────────────────────────────────────

test('resolveEnv: first name wins, no warning emitted', () => {
  process.env[NEW] = 'new-value';
  process.env[OLD1] = 'old-value';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES);
    assert.equal(result, 'new-value');
  });
  assert.equal(warnings.length, 0, `expected no warnings, got: ${JSON.stringify(warnings)}`);
});

test('resolveEnv: falls back to second name and warns exactly once', () => {
  process.env[OLD1] = 'old-value';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES);
    assert.equal(result, 'old-value');
  });
  assert.equal(warnings.length, 1, `expected exactly 1 warning, got: ${JSON.stringify(warnings)}`);
});

test('resolveEnv: warning message format is "[Legate] <OLD> is deprecated, use <NEW>"', () => {
  process.env[OLD1] = 'old-value';
  const warnings = captureWarnings(() => {
    resolveEnv(NAMES);
  });
  assert.equal(warnings[0], `[Legate] ${OLD1} is deprecated, use ${NEW}`);
});

test('resolveEnv: warns once per name even across repeated calls', () => {
  process.env[OLD1] = 'old-value';
  const warnings = captureWarnings(() => {
    resolveEnv(NAMES);
    resolveEnv(NAMES);
    resolveEnv(NAMES);
  });
  assert.equal(warnings.length, 1, `expected exactly 1 warning across 3 calls, got: ${JSON.stringify(warnings)}`);
});

test('resolveEnv: a variable set but losing to an earlier name in the chain does not warn', () => {
  process.env[NEW] = 'new-value';
  process.env[OLD1] = 'old-value'; // set, but loses to NEW
  process.env[OLD2] = 'oldest-value'; // set, but loses to NEW too
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES);
    assert.equal(result, 'new-value');
  });
  assert.equal(warnings.length, 0, `expected no warnings — OLD1/OLD2 never win the chain, got: ${JSON.stringify(warnings)}`);
});

test('resolveEnv: returns undefined and warns nothing when no name is set', () => {
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES);
    assert.equal(result, undefined);
  });
  assert.equal(warnings.length, 0);
});

// ── resolveEnv: empty-string handling ───────────────────────────────────────

test('resolveEnv default options: empty string on a fallback name wins the chain AND warns (matches autostart.ts/sessions.ts `!== undefined` sites)', () => {
  process.env[OLD1] = '';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES);
    assert.equal(result, '', 'empty string should win — selection is `!== undefined`, not truthiness');
  });
  assert.equal(warnings.length, 1, 'unconditional warn-on-selection sites warn even for an empty winning value');
});

test('resolveEnv quietEmptyWarn: empty string on a fallback name wins the chain but does NOT warn (matches BASE_URL/auth.ts/config.ts `??` + truthy-gated-warn sites)', () => {
  process.env[OLD1] = '';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES, { quietEmptyWarn: true });
    assert.equal(result, '', 'empty string still wins the `??` chain');
  });
  assert.equal(warnings.length, 0, 'quietEmptyWarn suppresses the warning for a falsy winning value');
});

test('resolveEnv requireTruthy: empty string on the primary name is skipped, falls through to a truthy fallback (matches the old resolveTimeoutMs `if (legateVal)` gate)', () => {
  process.env[NEW] = '';
  process.env[OLD1] = 'old-value';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES, { requireTruthy: true });
    assert.equal(result, 'old-value');
  });
  assert.equal(warnings.length, 1, 'the truthy fallback that wins should still warn');
});

test('resolveEnv requireTruthy: empty string anywhere in the chain never wins — falls through to undefined if nothing else is truthy', () => {
  process.env[OLD1] = '';
  const warnings = captureWarnings(() => {
    const result = resolveEnv(NAMES, { requireTruthy: true });
    assert.equal(result, undefined);
  });
  assert.equal(warnings.length, 0);
});

// ── resolveEnvInt ────────────────────────────────────────────────────────────

test('resolveEnvInt: valid positive integer is parsed and returned', () => {
  process.env[NEW] = '5000';
  const result = resolveEnvInt(NAMES, 120_000);
  assert.equal(result, 5000);
});

test('resolveEnvInt: missing env var returns the default with no warning', () => {
  const warnings = captureWarnings(() => {
    const result = resolveEnvInt(NAMES, 120_000);
    assert.equal(result, 120_000);
  });
  assert.equal(warnings.length, 0);
});

test('resolveEnvInt: non-numeric value (NaN) warns and returns the default', () => {
  process.env[NEW] = 'not-a-number';
  const warnings = captureWarnings(() => {
    const result = resolveEnvInt(NAMES, 120_000);
    assert.equal(result, 120_000);
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], `[Legate] ${NEW}=not-a-number is invalid — must be a positive integer; using default 120000`);
});

test('resolveEnvInt: zero warns and returns the default (fixes the old `parseInt(v,10) || default` silent-zero bug)', () => {
  process.env[NEW] = '0';
  const warnings = captureWarnings(() => {
    const result = resolveEnvInt(NAMES, 120_000);
    assert.equal(result, 120_000);
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], `[Legate] ${NEW}=0 is invalid — must be a positive integer; using default 120000`);
});

test('resolveEnvInt: negative value warns and returns the default (fixes the old silent-negative-acceptance bug)', () => {
  process.env[NEW] = '-100';
  const warnings = captureWarnings(() => {
    const result = resolveEnvInt(NAMES, 120_000);
    assert.equal(result, 120_000);
  });
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0], `[Legate] ${NEW}=-100 is invalid — must be a positive integer; using default 120000`);
});

test('resolveEnvInt: invalid-value warning fires only once per name across repeated calls', () => {
  process.env[NEW] = '-1';
  const warnings = captureWarnings(() => {
    resolveEnvInt(NAMES, 120_000);
    resolveEnvInt(NAMES, 120_000);
  });
  assert.equal(warnings.length, 1, `expected exactly 1 invalid-value warning across 2 calls, got: ${JSON.stringify(warnings)}`);
});

test('resolveEnvInt: deprecation warning and invalid-value warning can both fire (fallback name AND invalid value)', () => {
  process.env[OLD1] = '0';
  const warnings = captureWarnings(() => {
    const result = resolveEnvInt(NAMES, 120_000);
    assert.equal(result, 120_000);
  });
  assert.equal(warnings.length, 2, `expected a deprecation warning and an invalid-value warning, got: ${JSON.stringify(warnings)}`);
  assert.ok(warnings.some((w) => w.includes('is deprecated')));
  assert.ok(warnings.some((w) => w.includes('is invalid')));
});

// ── resolveEnvNum (session TTL semantics: Number(), no positivity check) ────

test('resolveEnvNum: accepts 0 (documented TTL-of-zero semantics — prune everything)', () => {
  process.env[NEW] = '0';
  const result = resolveEnvNum(NAMES, 86_400_000);
  assert.equal(result, 0);
});

test('resolveEnvNum: accepts negative numbers as-is (unchanged legacy behavior)', () => {
  process.env[NEW] = '-500';
  const result = resolveEnvNum(NAMES, 86_400_000);
  assert.equal(result, -500);
});

test('resolveEnvNum: NaN falls back to the default', () => {
  process.env[NEW] = 'not-a-number';
  const result = resolveEnvNum(NAMES, 86_400_000);
  assert.equal(result, 86_400_000);
});

test('resolveEnvNum: missing env var returns the default', () => {
  const result = resolveEnvNum(NAMES, 86_400_000);
  assert.equal(result, 86_400_000);
});
