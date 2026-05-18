#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { addServer, removeServer, listServers, readRegistry } from './registry.js';

// Resolve absolute path to build/index.js (the MCP server) from this CLI's
// own location. Both files live side-by-side in the build/ output dir.
const __dirname = dirname(fileURLToPath(import.meta.url));

// DIST-05: detect global install via npm_config_global env var (set by npm during
// lifecycle hooks only when invoked via 'npm install -g'). Falls back to false
// for direct CLI invocations, which is safe — commands will silently skip.
const isGlobal = process.env.npm_config_global === 'true';

// Template for the legate entry written into .mcp.json mcpServers.legate.
// Global: use the legate-mcp PATH bin (added as a second bin entry in package.json).
// Local: use node + absolute path so Claude Code can spawn from any cwd.
const LEGATE_ENTRY = isGlobal
  ? {
      type: 'stdio',
      command: 'legate-mcp',
      args: [],
    } as const
  : {
      type: 'stdio',
      command: 'node',
      args: [resolve(__dirname, 'index.js')],
    } as const;

// Template for ~/.claude/commands/legate-update.md (SELFUP-03, SELFUP-04, SELFUP-05).
// Format: Claude Code slash command markdown — invoked as /legate-update.
// The bash block updates the package (D-02), then displays the new version with restart prompt (D-03).
const LEGATE_UPDATE_COMMAND_CONTENT = `Update the legate package to the latest version, then confirm and prompt restart.

Run this bash command:

\`\`\`bash
npm install -g legate@latest && \\
  NEW_VERSION=$(node --input-type=commonjs -e "const p=require('path');const cp=require('child_process');const root=cp.execSync('npm root -g',{encoding:'utf8'}).trim();const pkg=require(p.join(root,'legate/package.json'));process.stdout.write(pkg.version);") && \\
  echo "legate updated to v$NEW_VERSION. Restart Claude Code to apply."
\`\`\`
`;

const LEGATE_SKILL_CARD_STATIC: string = `# Legate — Skill Card

**Install:** \`npm install -g legate\`  **Update:** \`/legate-update\`

## Canonical Loop
1. CREATE: \`legate_create_session({title, directory, server?})\` — returns sessionId
2. RUN: \`legate_run({sessionId, prompt})\` — blocks until agent finishes
3. DIFF: \`legate_get_diff({sessionId})\` — inspect FileDiff[]
4. REVIEW: read modified files yourself
5. TEST: run build/test commands via Bash tool — never delegate testing
6. DECIDE: commit if good; \`legate_run("correct: ...")\` if not; \`legate_fork\`/\`legate_revert\` if off-rails
7. DELETE: \`legate_session_delete({sessionId})\` — required hygiene every time
8. ABORT: \`legate_abort({sessionId})\` — emergency stop if legate_run hangs

## Tools (40 total — prefix all with legate_)
| Group | Tools |
|-------|-------|
| Core loop | create_session, run, prompt_async, abort, get_diff, fork, revert, session_delete, approve_permission |
| Session mgmt | session_list, session_status, session_get, session_rename, session_init, session_children, session_unrevert |
| Content | session_messages, session_message, session_command, session_summarize, session_todo, session_share, session_unshare |
| Delegation | delegate, dispatch, inspect, await |
| Discovery | list_agents, list_providers, list_tools, list_commands, list_mcp_servers, get_config |
| File/code | find_file, find_symbol, get_file_content, file_status, vcs_info |
| Shell/infra | session_shell, inject_mcp_server |

## Rules
- Always pass \`directory\` explicitly to create_session — never rely on server default
- Delete every session when done — sessions accumulate indefinitely if not cleaned
- Never commit from inside a legate_run call — you commit, OpenCode edits
- git is the safety net: \`git checkout -- .\` resets bad output
- Pass \`server: "<name>"\` to target a specific worker from the list below
`;

function buildWorkersSection(): string {
  const { servers } = readRegistry();
  const bullets = servers.map(
    (s) => `- **${s.name}** — ${s.providerID}/${s.modelID}, ${s.host}:${s.port}, capacity: ${s.maxSessions ?? 'unlimited'}`
  );
  const content = bullets.length > 0 ? bullets.join('\n') : '*(no servers registered — run: legate add-server)*';
  return `\n## Available Workers\n\n${content}\n`;
}

function updateClaudemdWorkers(cwd: string): void {
  const claudePath = resolve(cwd, 'CLAUDE.md');
  const existing = existsSync(claudePath) ? readFileSync(claudePath, 'utf8') : '';
  const { servers } = readRegistry();

  const bullets = servers.map(
    (s) => `- **${s.name}** — ${s.providerID}/${s.modelID}, ${s.host}:${s.port}, capacity: ${s.maxSessions ?? 'unlimited'}`
  );
  const sectionContent = bullets.length > 0 ? bullets.join('\n') : '*(no servers registered)*';
  const newSection = `## Available Workers\n\n${sectionContent}\n`;

  const fileLines = existing.split('\n');
  const startIdx = fileLines.findIndex((l) => l.trimEnd() === '## Available Workers');

  let updated: string;
  if (startIdx === -1) {
    // Section absent — append (with separator if file is non-empty)
    const sep = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
    updated = existing + sep + '\n' + newSection;
  } else {
    // Find end of section (next ## heading or EOF)
    const endIdx = fileLines.findIndex((l, i) => i > startIdx && /^## /.test(l));
    const tail = endIdx === -1 ? [] : fileLines.slice(endIdx);
    updated = [
      ...fileLines.slice(0, startIdx),
      ...newSection.split('\n'),
      ...(tail.length > 0 ? ['', ...tail] : []),
    ].join('\n');
  }

  // Normalize: exactly one trailing newline
  writeFileSync(claudePath, updated.trimEnd() + '\n');
}

function usageAndExit(): never {
  console.error(
    'Usage: legate <subcommand> [options]\n\n' +
    'Subcommands:\n' +
    '  init [--force]                          Write .mcp.json for this project\n' +
    '  add-server <name> <host> <port> <provider> <model> [--max-sessions <n>]  Register a named OpenCode server\n' +
    '  remove-server <name>                    Remove a named server from the registry\n' +
    '  list-servers                            List all registered servers\n' +
    '  install-command                         Install /legate and /legate-update Claude commands (global installs only)\n' +
    '  uninstall-command                       Remove /legate and /legate-update Claude commands (global installs only)\n' +
    '  version                                 Print the installed version',
  );
  process.exit(1);
}

function handleAddServer(handlerArgs: string[]): never {
  // Extract optional --max-sessions flag (may appear in any position after positional args)
  const maxSessionsIdx = handlerArgs.indexOf('--max-sessions');
  let maxSessions: number | undefined;
  let positionalArgs = handlerArgs;
  if (maxSessionsIdx !== -1) {
    const maxSessionsStr = handlerArgs[maxSessionsIdx + 1] ?? '';
    if (!/^\d+$/.test(maxSessionsStr) || parseInt(maxSessionsStr, 10) < 1) {
      console.error(`Error: invalid --max-sessions '${maxSessionsStr}' — must be a positive integer`);
      process.exit(1);
    }
    maxSessions = parseInt(maxSessionsStr, 10);
    // Remove the flag and its value from the positional args array
    positionalArgs = handlerArgs.filter((_, i) => i !== maxSessionsIdx && i !== maxSessionsIdx + 1);
  }
  const [name, host, portStr, providerID, modelID] = positionalArgs;
  if (!name || !host || !portStr || !providerID || !modelID) {
    console.error('Usage: legate add-server <name> <host> <port> <provider> <model> [--max-sessions <n>]');
    process.exit(1);
  }
  const port = parseInt(portStr, 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) {
    console.error(`Error: invalid port '${portStr}' — must be an integer 1-65535`);
    process.exit(1);
  }
  addServer({ name, host, port, providerID, modelID, ...(maxSessions !== undefined ? { maxSessions } : {}) });
  console.error(`Registered server '${name}' at ${host}:${port} (${providerID}/${modelID})${maxSessions !== undefined ? `, max sessions: ${maxSessions}` : ''}`);
  try { updateClaudemdWorkers(process.cwd()); } catch (e) { console.error(`Warning: could not update CLAUDE.md: ${(e as Error).message}`); }
  process.exit(0);
}

function handleRemoveServer(handlerArgs: string[]): never {
  const [name] = handlerArgs;
  if (!name) {
    console.error('Usage: legate remove-server <name>');
    process.exit(1);
  }
  try {
    removeServer(name);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }
  try { updateClaudemdWorkers(process.cwd()); } catch (e) { console.error(`Warning: could not update CLAUDE.md: ${(e as Error).message}`); }
  process.exit(0);
}

function handleListServers(): never {
  listServers();
  process.exit(0);
}

function installSkillCards(destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, 'legate.md'), LEGATE_SKILL_CARD_STATIC + buildWorkersSection());
  writeFileSync(join(destDir, 'legate-update.md'), LEGATE_UPDATE_COMMAND_CONTENT);
}

function handleInstallCommand(): never {
  // D-05: silent skip for non-global installs — do not pollute ~/.claude/commands/
  if (!isGlobal) process.exit(0);

  const destDir = join(homedir(), '.claude', 'commands');

  try {
    // D-06: create ~/.claude/commands/ if it does not exist; write both skill card files
    installSkillCards(destDir);
    if (!process.env.npm_lifecycle_event) {
      console.error(`Installed /legate and /legate-update commands to ${destDir}`);
    }
  } catch (err) {
    // D-07: warn to stderr, exit 0 — broken command install must NEVER block npm install
    console.error(`Warning: legate commands not installed — ${(err as Error).message}`);
    process.exit(0);
  }
  process.exit(0);
}

function handleUninstallCommand(): never {
  // D-05: silent skip for non-global installs
  if (!isGlobal) process.exit(0);

  const destDir = join(homedir(), '.claude', 'commands');
  try {
    // D-08: uninstall failures are non-fatal — exit 0 silently, no stderr
    rmSync(join(destDir, 'legate.md'), { force: true });
    rmSync(join(destDir, 'legate-update.md'), { force: true });
  } catch {
    // D-08: uninstall failures are non-fatal — exit 0 silently, no stderr
  }
  process.exit(0);
}

function printOnboardingIfNoServers(): void {
  const reg = readRegistry();
  if (reg.servers.length === 0) {
    console.error(
      '\nNo servers registered yet. Register your first OpenCode server:\n' +
      '  legate add-server <name> <host> <port> <provider> <model>\n' +
      'Example:\n' +
      '  legate add-server local localhost 4096 ollama qwen2.5-coder'
    );
  }
}

const args = process.argv.slice(2);
const subcommand = args[0];
const force = args.includes('--force');

if (subcommand === '--version' || subcommand === '-v') {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  console.log(version);
  process.exit(0);
}

switch (subcommand) {
  case 'init': {
    const mcpJsonPath = resolve(process.cwd(), '.mcp.json');

    type McpJson = {
      mcpServers?: Record<string, unknown>;
      [key: string]: unknown;
    };

    if (!existsSync(mcpJsonPath)) {
      // Case 1 (D-17): create fresh with only the legate entry
      const config: McpJson = { mcpServers: { legate: LEGATE_ENTRY } };
      writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
      console.error('Created .mcp.json with legate entry');
      try {
        installSkillCards(join(homedir(), '.claude', 'commands'));
        console.error('Installed /legate and /legate-update skill cards');
      } catch (err) {
        console.error(`Warning: skill cards not installed — ${(err as Error).message}`);
      }
      printOnboardingIfNoServers();
      process.exit(0);
    }

    // Existing .mcp.json — parse, merge, write
    let existing: McpJson;
    try {
      existing = JSON.parse(readFileSync(mcpJsonPath, 'utf8')) as McpJson;
    } catch (err) {
      console.error(`Error: failed to parse .mcp.json — ${(err as Error).message}`);
      process.exit(1);
    }

    const servers = (existing.mcpServers ?? {}) as Record<string, unknown>;

    if ('legate' in servers && !force) {
      // Case 3 (D-17): refuse without --force
      console.error('Error: .mcp.json already contains a legate entry. Use --force to overwrite.');
      process.exit(1);
    }

    // Case 2 (no legate key) or Case 4 (--force): set only the legate key,
    // preserving all other servers and root-level keys.
    servers.legate = LEGATE_ENTRY;
    existing.mcpServers = servers;
    writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n');
    console.error(force ? 'Updated legate entry in .mcp.json' : 'Added legate entry to .mcp.json');
    try {
      installSkillCards(join(homedir(), '.claude', 'commands'));
      console.error('Installed /legate and /legate-update skill cards');
    } catch (err) {
      console.error(`Warning: skill cards not installed — ${(err as Error).message}`);
    }
    printOnboardingIfNoServers();
    process.exit(0);
  }
  case 'add-server':
    handleAddServer(args.slice(1));
    break;
  case 'remove-server':
    handleRemoveServer(args.slice(1));
    break;
  case 'list-servers':
    handleListServers();
    break;
  case 'install-command':
    handleInstallCommand();
    break;
  case 'uninstall-command':
    handleUninstallCommand();
    break;
  case 'version': {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    console.log(version);
    process.exit(0);
  }
  default:
    usageAndExit();
}
