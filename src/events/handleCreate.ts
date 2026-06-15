import { TFolder, TFile, normalizePath, type TAbstractFile } from 'obsidian';
import type FolderNotesPlugin from 'src/main';
import {
	createFolderNote,
	getFolder,
	getFolderNote,
	turnIntoFolderNote,
} from 'src/functions/folderNoteFunctions';
import { getExcludedFolder } from 'src/ExcludeFolders/functions/folderFunctions';
import {
	removeCSSClassFromFileExplorerEL,
	addCSSClassToFileExplorerEl,
} from 'src/functions/styleFunctions';
import { isFileInAttachmentFolder } from '@app/functions/utils';
import { deferAndShouldSkipAutoCreate, isSyncBusy } from './syncSafeAutoCreate';
import { isIgnored } from '@app/functions/escapeHatches';

export async function handleCreate(file: TAbstractFile, plugin: FolderNotesPlugin): Promise<void> {
	if (!plugin.app.workspace.layoutReady) return;

	const folder = file.parent;
	if (folder instanceof TFolder) {
		if (plugin.isEmptyFolderNoteFolder(folder) && getFolderNote(plugin, folder.path)) {
			addCSSClassToFileExplorerEl(folder.path, 'only-has-folder-note', true, plugin);
		} else {
			removeCSSClassFromFileExplorerEL(folder.path, 'only-has-folder-note', true, plugin);
		}
	}

	if (file instanceof TFile) {
		handleFileCreation(file, plugin);
	} else if (file instanceof TFolder && plugin.settings.autoCreate) {
		handleFolderCreation(file, plugin);
	}
}

async function handleFileCreation(file: TFile, plugin: FolderNotesPlugin): Promise<void> {
	const folder = getFolder(plugin, file);

	if (!(folder instanceof TFolder) && plugin.settings.autoCreateForFiles) {
		if (!file.parent) { return; }
		if (await shouldSkipFileWrap(plugin, file)) { return; }
		const newFolder = await createNamedFolderForFile(plugin, file);
		if (!newFolder) { return; }
		turnIntoFolderNote(plugin, file, newFolder);
	} else if (folder instanceof TFolder) {
		if (folder.children.length >= 1) {
			removeCSSClassFromFileExplorerEL(folder.path, 'fn-empty-folder', false, plugin);
		}

		const detachedFolder = getExcludedFolder(plugin, folder.path, true);
		if (detachedFolder) { return; }
		const folderNote = getFolderNote(plugin, folder.path);

		if (folderNote && folderNote.path === file.path) {
			addCSSClassToFileExplorerEl(folder.path, 'has-folder-note', false, plugin);
			addCSSClassToFileExplorerEl(file.path, 'is-folder-note', false, plugin);
		} else if (plugin.settings.autoCreateForFiles && !isFileInAttachmentFolder(plugin, file)) {
			if (!plugin.settings.supportedFileTypes.includes(file.extension)) { return; }
			if (!file.parent) { return; }
			if (await shouldSkipFileWrap(plugin, file)) { return; }
			const newFolder = await createNamedFolderForFile(plugin, file);
			if (!newFolder) { return; }
			turnIntoFolderNote(plugin, file, newFolder);
		}
	}
}

// cybersader fork: when autoCreateForFiles wraps a loose file, create the new
// folder named AFTER THE FILE so the folder note keeps the file's name — instead
// of upstream's generic "Untitled" folder, which discarded the name (turning
// "Joyful Days.md" into "Untitled/Untitled.md"). Dedups on collision. Returns
// null if there's no parent or the folder can't be created.
async function createNamedFolderForFile(plugin: FolderNotesPlugin, file: TFile): Promise<TFolder | null> {
	const parent = file.parent;
	if (!parent) return null;
	const base = parent.path === '' || parent.path === '/' ? '' : `${parent.path}/`;
	let candidate = normalizePath(`${base}${file.basename}`);
	let n = 0;
	while (plugin.app.vault.getAbstractFileByPath(candidate)) {
		n += 1;
		candidate = normalizePath(`${base}${file.basename} ${n}`);
	}
	try {
		await plugin.app.vault.createFolder(candidate);
	} catch {
		return null;
	}
	const created = plugin.app.vault.getAbstractFileByPath(candidate);
	return created instanceof TFolder ? created : null;
}

// cybersader fork escape hatches: never auto-wrap a file into a folder note when
// it has opted out (fn-ignore / always-ignore path), its folder is excluded, or
// Obsidian Sync is mid-transfer (a synced file wrapped mid-sync is what produced
// the "Untitled" folder-note mess). See src/functions/escapeHatches.ts.
async function shouldSkipFileWrap(plugin: FolderNotesPlugin, file: TFile): Promise<boolean> {
	if (await isIgnored(plugin, file)) return true;
	if (file.parent && getExcludedFolder(plugin, file.parent.path, true)) return true;
	if (plugin.settings.syncSafeAutoCreate && isSyncBusy(plugin)) return true;
	return false;
}

async function handleFolderCreation(folder: TFolder, plugin: FolderNotesPlugin): Promise<void> {
	let openFile = plugin.settings.autoCreateFocusFiles;

	const attachmentFolderPath = plugin.app.vault.getConfig('attachmentFolderPath') as string;
	const cleanAttachmentFolderPath = attachmentFolderPath?.replace('./', '') || '';
	const attachmentsAreInRootFolder = attachmentFolderPath === './' || attachmentFolderPath === '';
	addCSSClassToFileExplorerEl(folder.path, 'fn-empty-folder', false, plugin);

	if (!plugin.settings.autoCreateForAttachmentFolder) {
		if (!attachmentsAreInRootFolder && cleanAttachmentFolderPath === folder.name) return;
	} else if (!attachmentsAreInRootFolder && cleanAttachmentFolderPath === folder.name) {
		openFile = false;
	}

	const excludedFolder = getExcludedFolder(plugin, folder.path, true);
	if (excludedFolder?.disableAutoCreate) return;

	const folderNote = getFolderNote(plugin, folder.path);
	if (folderNote) return;

	// cybersader sync-safe fork: defer-and-recheck before synthesizing a note,
	// so a real folder note arriving via sync wins the race instead of being
	// overwritten by an empty auto-created one. See ./syncSafeAutoCreate.ts.
	if (await deferAndShouldSkipAutoCreate(plugin, folder.path)) return;

	// Re-validate after the (possibly long) deferral: the folder note may have
	// appeared, or the folder been removed, between the guard returning and now.
	if (!(plugin.app.vault.getAbstractFileByPath(folder.path) instanceof TFolder)) return;
	if (getFolderNote(plugin, folder.path)) return;

	void createFolderNote(plugin, folder.path, openFile, undefined, true);
	addCSSClassToFileExplorerEl(folder.path, 'has-folder-note', false, plugin);
}
