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
  return mkdtempSync(join(tmpdir(), 'legate-cli-'));
}

function runInit(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]): { status: number; stderr: string } {
  const res = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env });
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
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runInit(dir, env, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers.legate);
    assert.equal(cfg.mcpServers.legate.command, 'node');
    assert.equal(cfg.mcpServers.legate.type, 'stdio');
    assert.ok(Array.isArray(cfg.mcpServers.legate.args));
    assert.ok(cfg.mcpServers.legate.args[0].endsWith('index.js'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 2: adds legate entry, preserves siblings', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { other: { command: 'sh', args: ['-c', 'echo hi'] } },
    }));
    const { status } = runInit(dir, env, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.ok(cfg.mcpServers.legate);
    assert.ok(cfg.mcpServers.other);
    assert.equal(cfg.mcpServers.other.command, 'sh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 3: exits 1 when legate already present without --force', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: { legate: { command: 'old', args: [] } },
    }));
    const { status, stderr } = runInit(dir, env, 'init');
    assert.equal(status, 1);
    assert.match(stderr, /--force/);
    // Verify .mcp.json untouched
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.legate.command, 'old');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Case 4: --force overwrites only the legate key', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      mcpServers: {
        legate: { command: 'old', args: [] },
        other: { command: 'sh' },
      },
    }));
    const { status } = runInit(dir, env, 'init', '--force');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.mcpServers.legate.command, 'node');
    assert.equal(cfg.mcpServers.other.command, 'sh');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Root-level non-mcpServers keys are preserved', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    writeFileSync(join(dir, '.mcp.json'), JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'sh' } },
    }));
    const { status } = runInit(dir, env, 'init');
    assert.equal(status, 0);
    const cfg = JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf8'));
    assert.equal(cfg.theme, 'dark');
    assert.ok(cfg.mcpServers.legate);
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
    assert.match(stderr, /Usage: legate <subcommand>/);
    assert.match(stderr, /add-server <name> <host> <port> <provider> <model>/);
    assert.match(stderr, /list-servers/);
    assert.equal(existsSync(join(dir, '.mcp.json')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('add-server creates ~/.config/legate/servers.json under HOME=tempdir', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.config', 'legate', 'servers.json')));
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'legate', 'servers.json'), 'utf8'));
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
    assert.match(stderr, /Usage: legate add-server/);
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
    mkdirSync(join(dir, '.config', 'legate'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'legate', 'servers.json'),
      JSON.stringify({ servers: [
        { name: 'local', host: 'h1', port: 4096, providerID: 'vllm', modelID: 'qwen3' },
        { name: 'dev', host: 'h2', port: 5000, providerID: 'ollama', modelID: 'llama3' },
      ] }, null, 2) + '\n',
    );
    const { status, stderr } = runCli(dir, env, 'remove-server', 'local');
    assert.equal(status, 0);
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'legate', 'servers.json'), 'utf8'));
    assert.equal(reg.servers.length, 1);
    assert.equal(reg.servers[0].name, 'dev');
    assert.match(stderr, /Removed server 'local'/);
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
    mkdirSync(join(dir, '.config', 'legate'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'legate', 'servers.json'),
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
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'legate', 'servers.json'), 'utf8'));
    assert.equal(reg.servers[0].maxSessions, 5);
    assert.equal(typeof reg.servers[0].maxSessions, 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-11: add-server without --max-sessions stores no maxSessions field', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    runCli(dir, env, 'add-server', 'local', 'localhost', '4096', 'vllm', 'qwen3');
    const reg = JSON.parse(readFileSync(join(dir, '.config', 'legate', 'servers.json'), 'utf8'));
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
    mkdirSync(join(dir, '.config', 'legate'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'legate', 'servers.json'),
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
    mkdirSync(join(dir, '.config', 'legate'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'legate', 'servers.json'),
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
    assert.match(stderr, /legate add-server local localhost 4096 ollama qwen2\.5-coder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('MULTI-09: init silent when servers already registered', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // Pre-populate registry
    mkdirSync(join(dir, '.config', 'legate'), { recursive: true });
    writeFileSync(
      join(dir, '.config', 'legate', 'servers.json'),
      JSON.stringify({ servers: [{ name: 'local', host: 'localhost', port: 4096, providerID: 'ollama', modelID: 'qwen2.5-coder' }] }, null, 2) + '\n',
    );
    const { status, stderr } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    assert.doesNotMatch(stderr, /No servers registered yet/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// SELFUP-01..SELFUP-05: install-command and uninstall-command lifecycle tests

// Helper: spawn cli.js from a fake global install path so isGlobal===true.
// Copies the entire build/ dir into <tmp>/node_modules/legate/build/
// and writes a stub package.json so module resolution works.
function runCliAsGlobal(homeDir: string, ...args: string[]):
  { status: number; stdout: string; stderr: string } {
  const fakeGlobalRoot = join(homeDir, 'node_modules', 'legate');
  const fakeBuildDir = join(fakeGlobalRoot, 'build');
  mkdirSync(fakeBuildDir, { recursive: true });
  // Copy all build artifacts so imports resolve
  const srcBuildDir = resolve(process.cwd(), 'build');
  const buildFiles = ['cli.js', 'registry.js', 'migration.js'];
  for (const f of buildFiles) {
    const srcPath = join(srcBuildDir, f);
    if (!existsSync(srcPath)) {
      throw new Error(`Build artifact missing: ${srcPath} — run 'npm run build' first`);
    }
    writeFileSync(join(fakeBuildDir, f), readFileSync(srcPath, 'utf8'));
  }
  // Stub package.json at the fake root (cli.js reads ../package.json for version)
  writeFileSync(join(fakeGlobalRoot, 'package.json'), JSON.stringify({ name: 'legate', version: '0.0.0-test' }));
  const fakeCli = join(fakeBuildDir, 'cli.js');
  const env = { ...process.env, HOME: homeDir, USERPROFILE: homeDir, npm_config_global: 'true' };
  const res = spawnSync('node', [fakeCli, ...args], { cwd: homeDir, encoding: 'utf8', env });
  return { status: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

test('SELFUP: install-command silent-skips when not global (exit 0, no file, no stderr)', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stdout, stderr } = runCli(dir, env, 'install-command');
    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    assert.equal(existsSync(join(dir, '.claude', 'commands', 'legate-update.md')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP: uninstall-command silent-skips when not global (exit 0, no stderr)', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stdout, stderr } = runCli(dir, env, 'uninstall-command');
    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP-01: install-command writes ~/.claude/commands/legate-update.md when global', () => {
  const dir = freshTmp();
  try {
    const { status, stderr } = runCliAsGlobal(dir, 'install-command');
    assert.equal(status, 0, `expected exit 0, got ${status}, stderr: ${stderr}`);
    const dest = join(dir, '.claude', 'commands', 'legate-update.md');
    assert.ok(existsSync(dest), 'legate-update.md must be written');
    const content = readFileSync(dest, 'utf8');
    // SELFUP-03: update command embedded
    assert.match(content, /npm install -g @momidala\/legate@latest/);
    // SELFUP-04: new version display embedded
    assert.match(content, /legate updated to v/);
    // SELFUP-05: restart reminder embedded
    assert.match(content, /Restart Claude Code to apply\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP-01: install-command creates ~/.claude/commands/ if missing (mkdir -p)', () => {
  const dir = freshTmp();
  try {
    // Confirm ~/.claude/commands/ does NOT exist before
    assert.equal(existsSync(join(dir, '.claude')), false);
    const { status } = runCliAsGlobal(dir, 'install-command');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.claude', 'commands')), 'directory must be created');
    assert.ok(existsSync(join(dir, '.claude', 'commands', 'legate-update.md')), 'file must be written');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP-02: uninstall-command removes ~/.claude/commands/legate-update.md when present', () => {
  const dir = freshTmp();
  try {
    // First install
    runCliAsGlobal(dir, 'install-command');
    const dest = join(dir, '.claude', 'commands', 'legate-update.md');
    assert.ok(existsSync(dest), 'precondition: file must exist after install');
    // Then uninstall
    const { status, stderr } = runCliAsGlobal(dir, 'uninstall-command');
    assert.equal(status, 0);
    assert.equal(stderr, '');
    assert.equal(existsSync(dest), false, 'file must be removed');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP-02: uninstall-command exits 0 silently when file is absent', () => {
  const dir = freshTmp();
  try {
    // File never installed
    const { status, stdout, stderr } = runCliAsGlobal(dir, 'uninstall-command');
    assert.equal(status, 0);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP: install-command warns to stderr and exits 0 when mkdir/write fails', () => {
  const dir = freshTmp();
  try {
    // Block ~/.claude/commands/ creation by placing a regular file at ~/.claude
    // mkdirSync(...,{recursive:true}) will throw ENOTDIR/EEXIST when a non-dir
    // exists at the path.
    writeFileSync(join(dir, '.claude'), 'i am a file not a directory');
    const { status, stderr } = runCliAsGlobal(dir, 'install-command');
    assert.equal(status, 0, 'D-07: must exit 0 even on failure');
    assert.match(stderr, /Warning: legate commands not installed —/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SELFUP: legate bogus usage lists install-command and uninstall-command', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status, stderr } = runCli(dir, env, 'bogus');
    assert.equal(status, 1);
    assert.match(stderr, /install-command\s+Install \/legate and \/legate-update Claude commands/);
    assert.match(stderr, /uninstall-command\s+Remove \/legate and \/legate-update Claude commands/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// SKILL-01..SKILL-05: skill card installation tests

test('SKILL-01: legate init writes ~/.claude/commands/legate.md', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.claude', 'commands', 'legate.md')), 'legate.md must be written by init');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-04: legate init writes ~/.claude/commands/legate-update.md', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    assert.ok(existsSync(join(dir, '.claude', 'commands', 'legate-update.md')), 'legate-update.md must be written by init');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-05: second legate init overwrites both skill card files', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // First init
    const { status: status1 } = runCli(dir, env, 'init');
    assert.equal(status1, 0);
    // Mutate legate.md to contain a stale marker
    const legateMd = join(dir, '.claude', 'commands', 'legate.md');
    assert.ok(existsSync(legateMd), 'legate.md must exist after first init');
    writeFileSync(legateMd, 'STALE_MARKER');
    // Second init
    const { status: status2 } = runCli(dir, env, 'init', '--force');
    assert.equal(status2, 0);
    // Content must be overwritten — STALE_MARKER must NOT appear
    const content = readFileSync(legateMd, 'utf8');
    assert.ok(!content.includes('STALE_MARKER'), 'second init must overwrite legate.md — STALE_MARKER must be gone');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-03: legate.md contains canonical loop and tool table', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    const { status } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    const legateMd = join(dir, '.claude', 'commands', 'legate.md');
    assert.ok(existsSync(legateMd), 'legate.md must exist after init');
    const content = readFileSync(legateMd, 'utf8');
    assert.match(content, /# Legate — Skill Card/);
    assert.match(content, /## Canonical Loop/);
    assert.match(content, /legate_create_session/);
    assert.match(content, /legate_run/);
    assert.match(content, /legate_session_delete/);
    assert.match(content, /## Tools/);
    assert.ok((content.match(/legate_[a-z_]+/g) ?? []).length >= 6, 'expected at least 6 legate_ tool refs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-03: legate.md workers section reflects registered servers', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // Pre-populate registry
    runCli(dir, env, 'add-server', 'thor', 'localhost', '4096', 'vllm', 'qwen3-coder');
    // Run init
    const { status } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    const content = readFileSync(join(dir, '.claude', 'commands', 'legate.md'), 'utf8');
    assert.match(content, /## Available Workers/);
    assert.match(content, /\*\*thor\*\* — vllm\/qwen3-coder, localhost:4096/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-03: legate.md workers section shows placeholder when registry empty', () => {
  const dir = freshTmp();
  try {
    const env = { ...process.env, HOME: dir, USERPROFILE: dir };
    // No add-server calls — registry is empty
    const { status } = runCli(dir, env, 'init');
    assert.equal(status, 0);
    const content = readFileSync(join(dir, '.claude', 'commands', 'legate.md'), 'utf8');
    assert.match(content, /## Available Workers/);
    assert.match(content, /no servers registered/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('SKILL-05: uninstall-command removes both legate.md and legate-update.md', () => {
  const dir = freshTmp();
  try {
    // Install both files
    const { status: installStatus } = runCliAsGlobal(dir, 'install-command');
    assert.equal(installStatus, 0, 'install-command must exit 0');
    const legateMd = join(dir, '.claude', 'commands', 'legate.md');
    const legateUpdateMd = join(dir, '.claude', 'commands', 'legate-update.md');
    assert.ok(existsSync(legateMd), 'precondition: legate.md must exist after install-command');
    assert.ok(existsSync(legateUpdateMd), 'precondition: legate-update.md must exist after install-command');
    // Uninstall
    const { status: uninstallStatus, stderr: uninstallStderr } = runCliAsGlobal(dir, 'uninstall-command');
    assert.equal(uninstallStatus, 0, 'uninstall-command must exit 0');
    assert.equal(uninstallStderr, '');
    assert.equal(existsSync(legateMd), false, 'legate.md must be removed by uninstall-command');
    assert.equal(existsSync(legateUpdateMd), false, 'legate-update.md must be removed by uninstall-command');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
