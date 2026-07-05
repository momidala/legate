// legate-s4b: npm lifecycle guard for postinstall/preuninstall.
//
// build/ is gitignored, so a fresh SOURCE checkout has no build/cli.js when npm
// runs postinstall — a bare `node ./build/cli.js install-command` fails npm ci
// with MODULE_NOT_FOUND (verified). Published tarballs always ship build/ (see
// the files array), so skipping when the CLI is absent only affects source
// checkouts, where there is nothing to install yet anyway.
//
// Usage: node scripts/lifecycle.cjs <install-command|uninstall-command>
const { existsSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
const { join } = require('node:path');

const cli = join(__dirname, '..', 'build', 'cli.js');
const command = process.argv[2];

if (!command) {
  console.error('Usage: node scripts/lifecycle.cjs <install-command|uninstall-command>');
  process.exit(1);
}

if (existsSync(cli)) {
  const result = spawnSync(process.execPath, [cli, command], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}
// build/cli.js absent — source checkout before first build; nothing to do.
