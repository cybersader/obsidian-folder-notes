/**
 * sync-race.spec.ts — E2E matrix for the layered autoCreate sync-race guard.
 *
 * Reproduces the exact race in REAL Obsidian (create folder = sync delivers the
 * folder; write the note a beat later = sync delivers the .md), then runs it
 * against different combinations of the guard's signals to show which actually
 * hold — and which don't.
 *
 *   master       off → upstream immediate-create (the control)
 *   timer        fixed quiet window (syncSafeAutoCreateDelay)
 *   event        the real note's create event cancels the pending create
 *   sync-status  hold while Obsidian Sync reports actively-transferring
 *   disk         adapter.exists() belt for metadata-cache lag
 *
 * The Sync core plugin isn't logged in here, so the sync-status scenarios STUB
 * its instance (dataLoaded/syncStatus/syncing) to model a busy→idle transition.
 *
 * Run: `npm run e2e`
 */

import { browser } from '@wdio/globals';
import { expect } from 'expect';

const REAL = '# Meeting note 2026-06-08\n\nInbound content that must NOT be lost.';

interface Flags {
  master: boolean;
  event: boolean;
  sync: boolean;
  disk: boolean;
}

interface RaceParams {
  folderPath: string;
  notePath: string;
  realContent: string | null;   // null → no note ever syncs in (genuine folder)
  flags: Flags;
  delay: number;                // syncSafeAutoCreateDelay (min quiet wait, ms)
  maxWait: number;              // syncSafeMaxWait (hard cap, ms)
  arrivalMs: number;            // when the inbound note is delivered after the folder
  observeMs: number;            // extra wait after delivery before reading back
  simulateSyncBusyMs: number | null; // if set, stub Sync busy then idle after N ms
}

interface RaceResult {
  inboundError: string | null;
  noteExists: boolean;
  finalContent: string | null;
  notesUnderFolder: string[];
  syncSimEngaged: boolean;
}

function runRace(p: RaceParams): Promise<RaceResult> {
  return browser.executeObsidian(async ({ app }: any, p: RaceParams): Promise<RaceResult> => {
    // Serialized into the renderer — cannot close over Node-side constants.
    const plugin = app.plugins.plugins['folder-notes'];

    Object.assign(plugin.settings, {
      autoCreate: true,
      autoCreateFocusFiles: false,
      storageLocation: 'insideFolder',
      folderNoteName: '{{folder_name}}',
      folderNoteType: '.md',
      templatePath: '',
      syncSafeAutoCreate: p.flags.master,
      syncSafeEventDriven: p.flags.event,
      syncSafeUseSyncStatus: p.flags.sync,
      syncSafeDiskCheck: p.flags.disk,
      syncSafeAutoCreateDelay: p.delay,
      syncSafeMaxWait: p.maxWait,
    });
    if (typeof plugin.saveSettings === 'function') await plugin.saveSettings();

    // Optionally stub Obsidian Sync into an operational busy→idle cycle.
    let syncSimEngaged = false;
    let restoreSync: (() => void) | null = null;
    if (p.simulateSyncBusyMs !== null) {
      try {
        const ip = app.internalPlugins;
        const shell = ip?.getPluginById?.('sync') ?? ip?.plugins?.['sync'];
        if (shell && !shell._loaded && typeof shell.enable === 'function') await shell.enable(false);
        const inst = shell?.instance ?? null;
        if (inst) {
          const orig = { dataLoaded: inst.dataLoaded, syncStatus: inst.syncStatus, syncing: inst.syncing, pause: inst.pause };
          inst.dataLoaded = true;
          inst.syncStatus = 'Synchronizing...';
          inst.pause = false;
          inst.syncing = true;
          setTimeout(() => { try { inst.syncing = false; inst.syncStatus = 'Fully synced'; } catch { /* */ } }, p.simulateSyncBusyMs);
          restoreSync = () => { try { Object.assign(inst, orig); } catch { /* */ } };
          syncSimEngaged = true;
        }
      } catch { /* sync sim best-effort */ }
    }

    // Clean slate.
    for (const path of [p.notePath, p.folderPath]) {
      const existing = app.vault.getAbstractFileByPath(path);
      if (existing) await app.vault.delete(existing, true);
    }

    let inboundError: string | null = null;

    // (1) Sync delivers the FOLDER.
    await app.vault.createFolder(p.folderPath);

    // (2) Sync delivers the real NOTE `arrivalMs` later (unless realContent is null).
    await new Promise<void>((resolve) => {
      setTimeout(async () => {
        if (p.realContent === null) { resolve(); return; }
        try {
          const occupied = app.vault.getAbstractFileByPath(p.notePath);
          if (occupied) {
            inboundError = 'path-occupied-before-sync-arrived'; // plugin won the race = the bug
          } else {
            await app.vault.create(p.notePath, p.realContent);
          }
        } catch (e: any) {
          inboundError = String(e?.message ?? e);
        }
        resolve();
      }, p.arrivalMs);
    });

    // (3) Let the guard finish deciding.
    await new Promise<void>((r) => setTimeout(r, p.observeMs));

    // (4) Observe.
    const finalFile = app.vault.getAbstractFileByPath(p.notePath);
    let finalContent: string | null = null;
    if (finalFile && 'extension' in finalFile) finalContent = await app.vault.read(finalFile);
    const notesUnderFolder = app.vault.getMarkdownFiles().map((f: any) => f.path).filter((path: string) => path.startsWith(p.folderPath + '/'));

    if (restoreSync) restoreSync();
    return { inboundError, noteExists: !!finalFile, finalContent, notesUnderFolder, syncSimEngaged };
  }, p);
}

const ALL_OFF: Flags = { master: false, event: false, sync: false, disk: false };
const TIMER_ONLY: Flags = { master: true, event: false, sync: false, disk: false };
const EVENT_ONLY: Flags = { master: true, event: true, sync: false, disk: false };
const SYNC_ONLY: Flags = { master: true, event: false, sync: true, disk: true };
const ALL_ON: Flags = { master: true, event: true, sync: true, disk: true };

describe('folder-notes autoCreate sync race — layer matrix', function () {
  it('CONTROL (master off): plugin blanks the note — proves the bug is real', async function () {
    const r = await runRace({
      folderPath: 'R1', notePath: 'R1/R1.md', realContent: REAL, flags: ALL_OFF,
      delay: 600, maxWait: 4000, arrivalMs: 400, observeMs: 600, simulateSyncBusyMs: null,
    });
    expect(r.noteExists).toBe(true);
    expect(r.inboundError).toBe('path-occupied-before-sync-arrived');
    expect(r.finalContent).toBe(''); // blanked
  });

  it('TIMER only, note arrives WITHIN the window: survives', async function () {
    const r = await runRace({
      folderPath: 'R2', notePath: 'R2/R2.md', realContent: REAL, flags: TIMER_ONLY,
      delay: 600, maxWait: 4000, arrivalMs: 300, observeMs: 900, simulateSyncBusyMs: null,
    });
    expect(r.inboundError).toBeNull();
    expect(r.finalContent).toBe(REAL);
    expect(r.notesUnderFolder).toEqual(['R2/R2.md']);
  });

  it('TIMER only, note arrives AFTER the window: BLANKS (the fixed-delay weakness)', async function () {
    const r = await runRace({
      folderPath: 'R3', notePath: 'R3/R3.md', realContent: REAL, flags: TIMER_ONLY,
      delay: 600, maxWait: 4000, arrivalMs: 1200, observeMs: 600, simulateSyncBusyMs: null,
    });
    // The timer fired at 600ms and created an empty note before the 1200ms arrival.
    expect(r.inboundError).toBe('path-occupied-before-sync-arrived');
    expect(r.finalContent).toBe(''); // still loses on slow sync
  });

  it('EVENT-driven fixes the slow-arrival case the timer lost', async function () {
    const r = await runRace({
      folderPath: 'R4', notePath: 'R4/R4.md', realContent: REAL, flags: EVENT_ONLY,
      delay: 600, maxWait: 4000, arrivalMs: 1200, observeMs: 1000, simulateSyncBusyMs: null,
    });
    // The note's own create event cancels the pending create → content survives.
    expect(r.inboundError).toBeNull();
    expect(r.finalContent).toBe(REAL);
    expect(r.notesUnderFolder).toEqual(['R4/R4.md']);
  });

  it('SYNC-status (event off) holds the window through a slow arrival: survives', async function () {
    const r = await runRace({
      folderPath: 'R5', notePath: 'R5/R5.md', realContent: REAL, flags: SYNC_ONLY,
      delay: 600, maxWait: 4000, arrivalMs: 1200, observeMs: 1200, simulateSyncBusyMs: 1600,
    });
    expect(r.syncSimEngaged).toBe(true); // the sync stub actually engaged
    // Sync stays "busy" past the 600ms timer, so no premature create; the arrival
    // is caught by the registry/disk checks → content survives even with event off.
    expect(r.inboundError).toBeNull();
    expect(r.finalContent).toBe(REAL);
  });

  it('SYNC-status: a GENUINE folder still gets its note once sync goes idle (no over-suppression)', async function () {
    const r = await runRace({
      folderPath: 'R6', notePath: 'R6/R6.md', realContent: null, flags: ALL_ON,
      delay: 600, maxWait: 4000, arrivalMs: 0, observeMs: 3500, simulateSyncBusyMs: 1000,
    });
    expect(r.syncSimEngaged).toBe(true);
    expect(r.noteExists).toBe(true); // auto-created after sync settled
    expect(r.notesUnderFolder).toEqual(['R6/R6.md']);
  });

  it('ALL layers on, slow arrival + sync busy: survives (the shipping default)', async function () {
    const r = await runRace({
      folderPath: 'R7', notePath: 'R7/R7.md', realContent: REAL, flags: ALL_ON,
      delay: 600, maxWait: 4000, arrivalMs: 1200, observeMs: 1200, simulateSyncBusyMs: 1600,
    });
    expect(r.inboundError).toBeNull();
    expect(r.finalContent).toBe(REAL);
    expect(r.notesUnderFolder).toEqual(['R7/R7.md']);
  });

  it('ALL layers on, NO sync present: bounded fallback still auto-creates a genuine folder', async function () {
    const r = await runRace({
      folderPath: 'R8', notePath: 'R8/R8.md', realContent: null, flags: ALL_ON,
      delay: 600, maxWait: 1000, arrivalMs: 0, observeMs: 3000, simulateSyncBusyMs: null,
    });
    // Sync not usable → event branch waits the bound, then creates. Genuine folders
    // are never permanently suppressed.
    expect(r.noteExists).toBe(true);
    expect(r.notesUnderFolder).toEqual(['R8/R8.md']);
  });
});
