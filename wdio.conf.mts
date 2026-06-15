import type { Options } from '@wdio/types';
import path from 'path';

/**
 * WebdriverIO + wdio-obsidian-service config for the cybersader sync-safe fork.
 *
 * Drives REAL Obsidian against `test-vault/` with this plugin (id `folder-notes`)
 * loaded, so we can reproduce the sync race that blanked folder notes and prove
 * the debounce-and-recheck fix holds. Spec discovery: `tests/e2e/**\/*.spec.ts`.
 *
 * Flow:
 *   1. `onPrepare` builds the plugin (tsc typecheck + esbuild → main.js at root)
 *   2. wdio-obsidian-service downloads/reuses Obsidian into `.obsidian-cache/`
 *      and copies main.js + manifest.json + styles.css into an isolated COPY of
 *      test-vault (so the real test-vault stays clean)
 *   3. Each spec opens Obsidian against that copy and runs assertions
 *
 * Run: `npm run e2e`   (first run downloads Obsidian — can take a few minutes)
 *
 * Docs: https://github.com/jesse-r-s-hines/wdio-obsidian-service
 */
export const config: Options.Testrunner = {
  runner: 'local',
  framework: 'mocha',

  specs: ['./tests/e2e/**/*.spec.ts'],

  // One Obsidian instance keeps the vault and the create-event timing deterministic
  maxInstances: 1,

  capabilities: [{
    browserName: 'obsidian',
    browserVersion: 'latest',
    'wdio:obsidianOptions': {
      installerVersion: 'earliest', // matches manifest.json minAppVersion (1.4.10)
      vault: path.resolve('./test-vault'),
      plugins: ['.'], // copies + enables this project's plugin (folder-notes)
    },
  }],

  services: ['obsidian'],
  reporters: ['obsidian'],

  // Where wdio-obsidian-service caches downloaded Obsidian builds
  cacheDir: path.resolve('.obsidian-cache'),

  // The race test deliberately waits out the autoCreate delay (seconds), so the
  // mocha timeout must comfortably exceed delay + sync-arrival margins.
  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },

  logLevel: 'warn',

  onPrepare: async function () {
    const { execSync } = await import('node:child_process');
    console.log('[wdio.onPrepare] building plugin (npm run fn-build)…');
    execSync('npm run fn-build', { stdio: 'inherit' });
  },

  afterTest: async function (_test: unknown, _context: unknown, result: { error?: unknown }) {
    if (result.error) {
      const { mkdirSync } = await import('node:fs');
      mkdirSync(path.resolve('./test-results'), { recursive: true });
      await browser.saveScreenshot(path.resolve(`./test-results/failure-${process.hrtime.bigint()}.png`));
    }
  },
};
