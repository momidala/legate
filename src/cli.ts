#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve absolute path to build/index.js (the MCP server) from this CLI's
// own location. Both files live side-by-side in the build/ output dir.
const __dirname = dirname(fileURLToPath(import.meta.url));

// DIST-05: detect global vs local install via path-segment check.
// Node resolves symlinks before computing import.meta.url, so __dirname is
// always the real file path inside node_modules/<pkg>/build/ for global installs.
// Normalize backslashes for Windows path support.
const isGlobal = __dirname.replace(/\\/g, '/').includes('/node_modules/@lbarchett/prefect-mcp/');

// Template for the prefect entry written into .mcp.json mcpServers.prefect.
// Global: use the prefect-mcp PATH bin (added as a second bin entry in package.json).
// Local: use node + absolute path so Claude Code can spawn from any cwd.
const PREFECT_ENTRY = isGlobal
  ? {
      type: 'stdio',
      command: 'prefect-mcp',
      args: [],
      env: {},
    } as const
  : {
      type: 'stdio',
      command: 'node',
      args: [resolve(__dirname, 'index.js')],
      env: {},
    } as const;

function usageAndExit(): never {
  console.error('Usage: prefect init [--force]');
  process.exit(1);
}

const args = process.argv.slice(2);
const subcommand = args[0];
const force = args.includes('--force');

if (subcommand !== 'init') {
  usageAndExit();
}

const mcpJsonPath = resolve(process.cwd(), '.mcp.json');

type McpJson = {
  mcpServers?: Record<string, unknown>;
  [key: string]: unknown;
};

if (!existsSync(mcpJsonPath)) {
  // Case 1 (D-17): create fresh with only the prefect entry
  const config: McpJson = { mcpServers: { prefect: PREFECT_ENTRY } };
  writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
  console.error('Created .mcp.json with prefect entry');
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

if ('prefect' in servers && !force) {
  // Case 3 (D-17): refuse without --force
  console.error('Error: .mcp.json already contains a prefect entry. Use --force to overwrite.');
  process.exit(1);
}

// Case 2 (no prefect key) or Case 4 (--force): set only the prefect key,
// preserving all other servers and root-level keys.
servers.prefect = PREFECT_ENTRY;
existing.mcpServers = servers;
writeFileSync(mcpJsonPath, JSON.stringify(existing, null, 2) + '\n');
console.error(force ? 'Updated prefect entry in .mcp.json' : 'Added prefect entry to .mcp.json');
process.exit(0);
