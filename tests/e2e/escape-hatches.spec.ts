/**
 * escape-hatches.spec.ts — E2E proof, in REAL Obsidian, that a loose file is
 * auto-wrapped into a folder note when `autoCreateForFiles` is on, and that each
 * escape hatch blocks that wrapping.
 *
 * Reproduces the b&g incident: with auto-create-for-files on, a plain file in a
 * folder gets turned into `<folder>/Untitled/Untitled.md` (name lost). The hatches:
 *   - fn-ignore frontmatter
 *   - always-ignore folder path
 *   - autoCreateForFiles off
 * must each leave the file untouched.
 *
 * Run: `npm run e2e`
 */

import { browser } from '@wdio/globals';
import { expect } from 'expect';

interface WrapParams {
  folderPath: string;
  fileName: string;
  content: string;
  autoCreateForFiles: boolean;
  ignoreFolderPaths: string[];
  settleMs: number;
}

interface WrapResult {
  fileStillThere: boolean;     // original loose file still at its path?
  subfolders: string[];        // folders created under folderPath (wrap creates one)
}

function runWrap(p: WrapParams): Promise<WrapResult> {
  return browser.executeObsidian(async ({ app }: any, p: WrapParams): Promise<WrapResult> => {
    const plugin = app.plugins.plugins['folder-notes'];
    Object.assign(plugin.settings, {
      autoCreate: false,                 // folder creation shouldn't make a note here
      autoCreateForFiles: p.autoCreateForFiles,
      autoCreateFocusFiles: false,
      storageLocation: 'insideFolder',
      folderNoteName: '{{folder_name}}',
      folderNoteType: '.md',
      templatePath: '',
      syncSafeAutoCreate: true,
      ignoreFrontmatterKey: 'fn-ignore',
      ignoreFolderPaths: p.ignoreFolderPaths,
    });
    plugin.settings.excludeFolders = [];
    if (typeof plugin.saveSettings === 'function') await plugin.saveSettings();

    const stale = app.vault.getAbstractFileByPath(p.folderPath);
    if (stale) await app.vault.delete(stale, true);
    await app.vault.createFolder(p.folderPath);

    const filePath = `${p.folderPath}/${p.fileName}`;
    await app.vault.create(filePath, p.content);

    await new Promise<void>((r) => setTimeout(r, p.settleMs));

    const fileStillThere = app.vault.getAbstractFileByPath(filePath) != null;
    const folder = app.vault.getAbstractFileByPath(p.folderPath);
    const children = (folder?.children ?? []) as any[];
    const subfolders = children.filter((c) => c.children !== undefined).map((c) => c.name);
    return { fileStillThere, subfolders };
  }, p);
}

describe('folder-notes escape hatches (file wrapping)', function () {
  it('BASELINE: with autoCreateForFiles on, a loose file IS wrapped — but KEEPS its name', async function () {
    const r = await runWrap({
      folderPath: 'W1', fileName: 'provider.md', content: '# Provider',
      autoCreateForFiles: true, ignoreFolderPaths: [], settleMs: 1800,
    });
    // It is wrapped (moved into a new folder)…
    expect(r.fileStillThere).toBe(false);
    // …but into a folder named after the FILE, not the old name-losing "Untitled".
    expect(r.subfolders).toContain('provider');
    expect(r.subfolders).not.toContain('Untitled');
  });

  it('fn-ignore frontmatter blocks wrapping (works for filesystem writes)', async function () {
    const r = await runWrap({
      folderPath: 'W2', fileName: 'provider.md', content: '---\nfn-ignore: true\n---\n# Provider',
      autoCreateForFiles: true, ignoreFolderPaths: [], settleMs: 1800,
    });
    expect(r.fileStillThere).toBe(true);
    expect(r.subfolders.length).toBe(0);
  });

  it('always-ignore folder path blocks wrapping', async function () {
    const r = await runWrap({
      folderPath: 'W3', fileName: 'provider.md', content: '# Provider',
      autoCreateForFiles: true, ignoreFolderPaths: ['W3'], settleMs: 1800,
    });
    expect(r.fileStillThere).toBe(true);
    expect(r.subfolders.length).toBe(0);
  });

  it('autoCreateForFiles off → no wrapping', async function () {
    const r = await runWrap({
      folderPath: 'W4', fileName: 'provider.md', content: '# Provider',
      autoCreateForFiles: false, ignoreFolderPaths: [], settleMs: 1200,
    });
    expect(r.fileStillThere).toBe(true);
    expect(r.subfolders.length).toBe(0);
  });

  it('the three escape-hatch commands are registered', async function () {
    const ids = await browser.executeObsidian(({ app }: any) => {
      const all = Object.keys(app.commands.commands);
      return [
        'folder-notes:create-plain-note-no-folder-note',
        'folder-notes:toggle-folder-note-exclusion',
        'folder-notes:toggle-auto-create-folder-notes',
      ].filter((id) => all.includes(id));
    });
    expect(ids).toEqual([
      'folder-notes:create-plain-note-no-folder-note',
      'folder-notes:toggle-folder-note-exclusion',
      'folder-notes:toggle-auto-create-folder-notes',
    ]);
  });
});
