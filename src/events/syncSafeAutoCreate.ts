import { TFolder, TFile, type EventRef } from 'obsidian';
import type FolderNotesPlugin from 'src/main';
import { getFolderNote } from 'src/functions/folderNoteFunctions';
import { getFolderNameFromPathString, getFolderPathFromString } from '@app/functions/utils';
import { decideAutoCreate } from './autoCreateDecision';

/**
 * ── cybersader sync-safe fork: layered autoCreate guard ──────────────────────
 *
 * Problem: a sync engine delivers a folder BEFORE its folder-note ".md".
 * Upstream autoCreate immediately writes an EMPTY note, which then races (and can
 * lose to) the real inbound note → silent data loss.
 *
 * This module decides whether autoCreate should be DEFERRED-and-SKIPPED. It is a
 * set of independent, composable signals (each a setting) so the safest mix can
 * be chosen / measured. They degrade gracefully — if Obsidian Sync isn't present,
 * the sync-status layer is simply skipped.
 *
 *   master (syncSafeAutoCreate)  off → behave like upstream (create immediately)
 *   event-driven                 the real note's `create` event cancels the pending create
 *   sync-status                  hold while Obsidian Sync is actively transferring (closes the window)
 *   disk-check                   adapter.exists() belt for metadata-cache lag
 *   timer (delay/maxWait)        bounds: min quiet wait + hard cap
 *
 * The core insight: the discriminator between "user made this folder" and "sync
 * made this folder" is whether a real note shows up on its own shortly after —
 * which is itself an observable `create` event, no source flag required.
 */

const TICK_MS = 150;
const FALLBACK_DELAY_MS = 2500;
const FALLBACK_MAX_WAIT_MS = 30000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Returns true when autoCreate should be ABORTED (a real note arrived, or the
 * folder vanished), false when it is safe to synthesize the folder note.
 */
export async function deferAndShouldSkipAutoCreate(
	plugin: FolderNotesPlugin,
	folderPath: string,
): Promise<boolean> {
	const s = plugin.settings;

	// Master off → upstream behaviour: never defer, create immediately.
	if (s.syncSafeAutoCreate === false) return false;

	const minQuiet = Math.max(0, s.syncSafeAutoCreateDelay ?? FALLBACK_DELAY_MS);
	const maxWait = Math.max(minQuiet, s.syncSafeMaxWait ?? FALLBACK_MAX_WAIT_MS);
	const eventDriven = s.syncSafeEventDriven !== false;
	const useSyncStatus = s.syncSafeUseSyncStatus !== false;
	const diskCheck = s.syncSafeDiskCheck !== false;
	const expectedPath = getExpectedFolderNotePath(plugin, folderPath);

	// Event-driven layer: flip a flag the instant the genuine note's create event
	// fires. This is the real arrival signal — engine-agnostic, public API only.
	let noteArrivedViaEvent = false;
	let eventRef: EventRef | null = null;
	if (eventDriven) {
		eventRef = plugin.app.vault.on('create', (file) => {
			if (!(file instanceof TFile)) return;
			if (file.path === expectedPath || getFolderNote(plugin, folderPath)) {
				noteArrivedViaEvent = true;
			}
		});
	}

	try {
		const startedAt = Date.now();
		let syncIdleSince = startedAt; // wall-clock instant Sync last became idle

		// eslint-disable-next-line no-constant-condition
		while (true) {
			const now = Date.now();
			const elapsedMs = now - startedAt;

			// Gather the snapshot (all IO happens here; the verdict is pure).
			const folderExists = plugin.app.vault.getAbstractFileByPath(folderPath) instanceof TFolder;

			let noteArrived = false;
			if (folderExists) {
				noteArrived = noteArrivedViaEvent || getFolderNote(plugin, folderPath) != null;
				if (!noteArrived && diskCheck && expectedPath) {
					try {
						noteArrived = await plugin.app.vault.adapter.exists(expectedPath);
					} catch {
						/* adapter hiccup — rely on the other arrival signals */
					}
				}
			}

			const syncUsable = useSyncStatus && isSyncStatusUsable(plugin);
			if (syncUsable && isSyncActivelyTransferring(plugin)) {
				syncIdleSince = now; // reset the idle clock while sync is transferring
			}
			const syncIdleForMs = syncUsable ? now - syncIdleSince : 0;

			const decision = decideAutoCreate({
				elapsedMs,
				minQuietMs: minQuiet,
				maxWaitMs: maxWait,
				folderExists,
				noteArrived,
				eventDriven,
				useSyncStatus,
				syncUsable,
				syncIdleForMs,
			});

			if (decision === 'skip') return true;
			if (decision === 'create') return false;

			await sleep(TICK_MS);
		}
	} finally {
		if (eventRef) plugin.app.vault.offref(eventRef);
	}
}

/**
 * Best-effort path the folder note WOULD occupy, mirroring `createFolderNote`'s
 * storage-location logic. Used only for the disk-existence belt; if it can't be
 * derived the other signals still apply.
 */
export function getExpectedFolderNotePath(
	plugin: FolderNotesPlugin,
	folderPath: string,
): string | null {
	try {
		const s = plugin.settings;
		const folderName = getFolderNameFromPathString(folderPath);
		const fileName = (s.folderNoteName || '{{folder_name}}').replace('{{folder_name}}', folderName);
		const type = s.folderNoteType === '.excalidraw' ? '.md' : (s.folderNoteType || '.md');

		if (s.storageLocation === 'parentFolder') {
			const parent = getFolderPathFromString(folderPath);
			return parent.trim() === '' ? `${fileName}${type}` : `${parent}/${fileName}${type}`;
		} else if (s.storageLocation === 'vaultFolder') {
			return `${fileName}${type}`;
		}
		return `${folderPath}/${fileName}${type}`;
	} catch {
		return null;
	}
}

/**
 * The Obsidian Sync core plugin's status is only trustworthy once it is actually
 * operational. When the user isn't logged in it reports `syncing: true` /
 * `syncStatus: "Uninitialized"`, which we must NOT treat as "actively syncing".
 */
function getSyncInstance(plugin: FolderNotesPlugin): any | null {
	try {
		const ip: any = (plugin.app as any).internalPlugins;
		const shell = ip?.getPluginById?.('sync') ?? ip?.plugins?.['sync'];
		return shell?.instance ?? null;
	} catch {
		return null;
	}
}

function isSyncStatusUsable(plugin: FolderNotesPlugin): boolean {
	const inst = getSyncInstance(plugin);
	if (!inst) return false;
	const status = String(inst.syncStatus ?? '');
	return !!inst.dataLoaded && status !== '' && status !== 'Uninitialized';
}

function isSyncActivelyTransferring(plugin: FolderNotesPlugin): boolean {
	const inst = getSyncInstance(plugin);
	if (!inst) return false;
	if (inst.pause === true) return false; // paused → not transferring
	return inst.syncing === true;
}

/** True when Obsidian Sync is present, operational, AND actively transferring.
 *  Used to hold off file→folder-note wrapping during a sync burst. */
export function isSyncBusy(plugin: FolderNotesPlugin): boolean {
	return isSyncStatusUsable(plugin) && isSyncActivelyTransferring(plugin);
}
