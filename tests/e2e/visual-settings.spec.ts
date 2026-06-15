/**
 * visual-settings.spec.ts — proves the "Sync safety" settings UI actually renders
 * in real Obsidian (not just that it compiles), and captures a screenshot.
 *
 * Run: `npm run e2e`  → screenshot at test-results/settings-sync-safety.png
 */

import { browser } from '@wdio/globals';
import { expect } from 'expect';

describe('Sync safety settings UI', function () {
  it('renders the heading, all four toggles, and both sliders', async function () {
    // Enable auto-create + the guard so the whole section is visible, then open the tab.
    await browser.executeObsidian(async ({ app }: any) => {
      const plugin = app.plugins.plugins['folder-notes'];
      plugin.settings.autoCreate = true;
      plugin.settings.syncSafeAutoCreate = true;
      if (typeof plugin.saveSettings === 'function') await plugin.saveSettings();
      app.setting.open();
      app.setting.openTabById('folder-notes');
    });

    await browser.pause(600); // let the tab render

    const found = await browser.executeObsidian(() => {
      const names = Array.from(document.querySelectorAll('.setting-item-name')).map((e) => (e.textContent || '').trim());
      const heading = Array.from(document.querySelectorAll('.setting-item-heading .setting-item-name, .setting-item-heading')).some((e) => (e.textContent || '').includes('Sync safety'));
      // Scroll the section into view for the screenshot.
      const target = Array.from(document.querySelectorAll('.setting-item-name')).find((e) => (e.textContent || '').trim() === 'Protect against sync races');
      (target as HTMLElement | undefined)?.scrollIntoView({ block: 'start' });
      return {
        heading,
        names,
        sliders: document.querySelectorAll('.setting-item input[type="range"]').length,
      };
    });

    await browser.pause(300);
    const { mkdirSync } = await import('node:fs');
    mkdirSync('./test-results', { recursive: true });
    await browser.saveScreenshot('./test-results/settings-sync-safety.png');

    expect(found.heading).toBe(true);
    expect(found.names).toContain('Protect against sync races');
    expect(found.names).toContain('Cancel on incoming note');
    expect(found.names).toContain('Wait for Obsidian Sync to settle');
    expect(found.names).toContain('Double-check on disk');
    expect(found.names).toContain('Minimum wait before auto-create');
    expect(found.names).toContain('Maximum wait');
    expect(found.sliders).toBeGreaterThanOrEqual(2);

    // Close the settings modal so it doesn't bleed into other specs.
    await browser.executeObsidian(({ app }: any) => app.setting.close());
  });
});
