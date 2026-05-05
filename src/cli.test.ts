import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const CLI = resolve(process.cwd(), 'build/cli.js');
if (!existsSync(CLI)) {
  throw new Error(`Build artifact missing: run 'npm run build' first`);
}

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), 'prefect-cli-'));
}

function runInit(cwd: string, ...args: string[]): { status: number; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8' });
  return { status: res.status ?? -1, stderr: res.stderr };
}

function runCli(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]):
  { status: number; stdout: string; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
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
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'bogus');
    assert.equal(status, 1);
    assert.match(stderr, /Usage: prefect <subcommand>/);
    assert.match(stderr, /add-server <name> <host> <port> <provider> <model>/);
    assert.match(stderr, /list-servers/);
    assert.equal(existsSync(join(dir, '.mcp.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-server creates ~/.config/prefect/servers.json under HOME=tempdir', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.config', 'prefect', 'servers.json')));
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'prefect', 'servers.json'), 'utf8'));
    assert.deepEqual(reg.servers[0], { name: 'local', host: 'localhost', port: 4096, providerID: 'vllm', modelID: 'qwen3' });
    assert.equal(typeof reg.servers[0].port, 'number');
    assert.match(stderr, /Registered server 'local'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-server with missing args prints usage and exits 1', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost');
    assert.equal(status, 1);
    assert.match(stderr, /Usage: prefect add-server/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-server with non-numeric port exits 1', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', 'abc', 'vllm', 'qwen3');
    assert.equal(status, 1);
    assert.match(stderr, /invalid port 'abc'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-server with out-of-range port exits 1', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '99999', 'vllm', 'qwen3');
    assert.equal(status, 1);
    assert.match(stderr, /invalid port '99999'/);
    assert.match(stderr, /1-65535/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remove-server removes existing entry and exits 0', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    mkdirSync(join(dir, '.config', 'prefect'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'prefect', 'servers.json'),
      JSON.stringify({ servers: [
        { name: 'local', host: 'h1', port: 4096, providerID: 'vllm', modelID: 'qwen3' },
        { name: 'dev', host: 'h2', port: 5000, providerID: 'ollama', modelID: 'llama3' },
      ] }, null, 2) + '\n',
    );
    const { status, stdout } = runCli(dir, env, 'remove-server', 'local');
    assert.equal(status, 0);
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'prefect', 'servers.json'), 'utf8'));
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].name, 'dev');
    assert.match(stdout, /Removed server 'local'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('remove-server on missing name exits 1 with clear stderr', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'remove-server', 'nope');
    assert.equal(status, 1);
    assert.match(stderr, /no server named 'nope'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list-servers prints empty-registry message on stdout', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stdout } = runCli(dir, env, 'list-servers');
    assert.equal(status, 0);
    assert.match(stdout, /No servers registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('list-servers prints tabular output to stdout when entries exist', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    mkdirSync(join(dir, '.config', 'prefect'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'prefect', 'servers.json'),
      JSON.stringify({ servers: [
        { name: 'local', host: 'h1', port: 4096, providerID: 'vllm', modelID: 'qwen3' },
        { name: 'dev', host: 'h2', port: 5000, providerID: 'ollama', modelID: 'llama3' },
      ] }, null, 2) + '\n',
    );
    const { status, stdout } = runCli(dir, env, 'list-servers');
    assert.equal(status, 0);
    assert.match(stdout, /NAME\s+HOST\s+PORT\s+PROVIDER\s+MODEL/);
    assert.ok(stdout.includes('local'));
    assert.ok(stdout.includes('dev'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// MULTI-08: updateClaudemdWorkers behavior tests
test('MULTI-08: add-server creates CLAUDE.md with Available Workers section', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'ollama', 'qwen2.5-coder');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, 'CLAUDE.md')));
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /## Available Workers/);
    assert.match(content, /\*\*local\*\* — ollama\/qwen2\.5-coder, localhost:4096/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-08: remove-server updates section to placeholder when registry empty', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // Add then remove
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'ollama', 'qwen2.5-coder');
    const { status } = runCli(dir, env, 'remove-server', 'local');
    assert.equal(status, 0);
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /## Available Workers/);
    assert.match(content, /\*\(no servers registered\)\*/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-08: add-server preserves existing CLAUDE.md content', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    writeFileSync(join(dir, 'CLAUDE.md'), '# My Project\n\nSome existing content.\n');
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'ollama', 'qwen3');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /# My Project/);
    assert.match(content, /Some existing content/);
    assert.match(content, /## Available Workers/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-08: repeated add-server does not duplicate section', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'a', 'localhost', '4096', 'ollama', 'qwen3');
    runCli(dir, env, 'add-server', 'b', 'localhost', '4097', 'vllm', 'llama3');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    const matches = content.match(/## Available Workers/g);
    assert.equal(matches?.length, 1, 'section heading must appear exactly once');
    assert.match(content, /\*\*a\*\*/);
    assert.match(content, /\*\*b\*\*/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-08: CLAUDE.md ends with exactly one newline', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'ollama', 'qwen3');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.ok(content.endsWith('\n'), 'must end with newline');
    assert.ok(!content.endsWith('\n\n'), 'must not end with double newline');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// MULTI-11: --max-sessions flag on add-server
test('MULTI-11: add-server --max-sessions stores integer in registry', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3', '--max-sessions', '5');
    assert.equal(status, 0);
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'prefect', 'servers.json'), 'utf8'));
    assert.equal(reg.servers[0].maxSessions, 5);
    assert.equal(typeof reg.servers[0].maxSessions, 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server without --max-sessions stores no maxSessions field', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'prefect', 'servers.json'), 'utf8'));
    assert.ok(!('maxSessions' in reg.servers[0]), 'maxSessions must not appear when not provided');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server --max-sessions with non-integer exits 1', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3', '--max-sessions', 'abc');
    assert.equal(status, 1);
    assert.match(stderr, /invalid --max-sessions/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server --max-sessions 0 exits 1', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3', '--max-sessions', '0');
    assert.equal(status, 1);
    assert.match(stderr, /invalid --max-sessions/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: list-servers shows CAPACITY column header', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    mkdirSync(join(dir, '.config', 'prefect'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'prefect', 'servers.json'),
      JSON.stringify({ servers: [{ name: 'local', host: 'h', port: 4096, providerID: 'vllm', modelID: 'qwen3' }] }, null, 2) + '\n',
    );
    const { status, stdout } = runCli(dir, env, 'list-servers');
    assert.equal(status, 0);
    assert.match(stdout, /CAPACITY/);
    assert.match(stdout, /unlimited/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: list-servers shows numeric capacity for capped server', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    mkdirSync(join(dir, '.config', 'prefect'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'prefect', 'servers.json'),
      JSON.stringify({ servers: [{ name: 'local', host: 'h', port: 4096, providerID: 'vllm', modelID: 'qwen3', maxSessions: 4 }] }, null, 2) + '\n',
    );
    const { status, stdout } = runCli(dir, env, 'list-servers');
    assert.equal(status, 0);
    assert.match(stdout, /4/);
    assert.doesNotMatch(stdout, /unlimited/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server --max-sessions updates CLAUDE.md bullet with capacity', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3', '--max-sessions', '5');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /capacity: 5/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server without --max-sessions shows capacity: unlimited in CLAUDE.md', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    const content = readFileSync(join(dir, 'CLAUDE.md'), 'utf8');
    assert.match(content, /capacity: unlimited/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// MULTI-09: init guidance tests
test('MULTI-09: init prints guidance when registry empty', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    assert.match(stderr, /No servers registered yet/);
    assert.match(stderr, /prefect add-server local localhost 4096 ollama qwen2\.5-coder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-09: init silent when servers already registered', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // Pre-populate registry
    mkdirSync(join(dir, '.config', 'prefect'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'prefect', 'servers.json'),
      JSON.stringify({ servers: [{ name: 'local', host: 'localhost', port: 4096, providerID: 'ollama', modelID: 'qwen2.5-coder' }] }, null, 2) + '\n',
    );
    const { status, stderr } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    assert.doesNotMatch(stderr, /No servers registered yet/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
