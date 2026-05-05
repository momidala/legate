import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const CLI = resolve(process.cwd(), 'build/cli.js');

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'prefect-cli-'));
}

function runInit(cwd: string, ...args: string[]): { status: number; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stderr: res.stderr };
}

test('Case 1: creates .mcp.json when none exists', () => {
  const dir = freshTmp();
  try {
    const { status } = runInit(dir, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers.prefect);
    assert.equal(cfg.mcpServers.prefect.command, 'node');
    assert.equal(cfg.mcpServers.prefect.type, 'stdio');
    assert.ok(Array.isArray(cfg.mcpServers.prefect.args));
    assert.ok(cfg.mcpServers.prefect.args[0].endsWith('index.js'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 2: adds prefect entry, preserves siblings', () => {
  const dir = freshTmp();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { other: { command: 'sh', args: ['-c', 'echo hi'] } },
    }));
    const { status } = runInit(dir, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers.prefect);
    assert.ok(cfg.mcpServers.other);
    assert.equal(cfg.mcpServers.other.command, 'sh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 3: exits 1 when prefect already present without --force', () => {
  const dir = freshTmp();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { prefect: { command: 'old', args: [] } },
    }));
    const { status, stderr } = runInit(dir, 'init');
    assert.equal(status, 1);
    assert.match(stderr, /--force/);
    // Verify .mcp.json untouched
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.prefect.command, 'old');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 4: --force overwrites only the prefect key', () => {
  const dir = freshTmp();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        prefect: { command: 'old', args: [] },
        other: { command: 'sh' },
      },
    }));
    const { status } = runInit(dir, 'init', '--force');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.prefect.command, 'node');
    assert.equal(cfg.mcpServers.other.command, 'sh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Root-level non-mcpServers keys are preserved', () => {
  const dir = freshTmp();
  try {
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'sh' } },
    }));
    const { status } = runInit(dir, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.theme, 'dark');
    assert.ok(cfg.mcpServers.prefect);
    assert.ok(cfg.mcpServers.other);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Bogus subcommand exits 1 with usage', () => {
  const dir = freshTmp();
  try {
    const { status, stderr } = runInit(dir, 'bogus');
    assert.equal(status, 1);
    assert.match(stderr, /Usage: prefect init/);
    assert.equal(existsSync(join(dir, '.mcp.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
