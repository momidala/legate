// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // build/ is generated output; the rest are non-source or non-project directories
    // that don't benefit from linting (planning docs, issue tracker db, helper scripts).
    ignores: ['build/**', 'node_modules/**', '.planning/**', '.beads/**', 'scripts/**'],
  },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    rules: {
      // The OpenCode SDK's response shapes and Node error handling are cast-heavy
      // by design (see src/errors.ts, src/cli.ts). Turning this on would force
      // churn across dozens of intentional `unknown`/API-shape casts for no
      // safety benefit without switching to the (slower) type-checked ruleset.
      '@typescript-eslint/no-explicit-any': 'off',

      // Codebase leans on `_prefixed` params/vars to mark intentionally-unused
      // bindings (e.g. destructured but unused callback args); allow that
      // convention instead of flagging every one.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  eslintConfigPrettier,
);
