import type { TFile } from 'obsidian';
import type FolderNotesPlugin from 'src/main';

/**
 * ── cybersader fork: escape hatches ──────────────────────────────────────────
 *
 * Explicit, durable opt-outs so notes (especially ones written by agents / bulk
 * filesystem writes, where no user is present to press a command) are never
 * auto-wrapped into folder notes:
 *
 *   - frontmatter key (default `fn-ignore: true`) → this note is invisible to
 *     all auto-folder-note logic. Portable; works on filesystem writes.
 *   - always-ignore folder paths → anything under these paths is never wrapped.
 *
 * Companion to ESCAPE_HATCHES.md. The pure string helpers below are unit-tested
 * (tests/unit/escapeHatches.test.ts); `isIgnored` wires them to the vault.
 */

export const DEFAULT_IGNORE_KEY = 'fn-ignore';

/**
 * Pure: does a raw note body's frontmatter set `<key>: true`? Uses a targeted
 * line match (not a full YAML parse) so the module has no runtime dependency on
 * Obsidian and stays unit-testable.
 */
export function frontmatterHasIgnoreKey(content: string, key: string): boolean {
	const block = extractFrontmatter(content);
	if (block === null) return false;
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	// a top-level `key: true` line (optional quotes around the key); `i` covers
	// True/TRUE, `m` anchors to each frontmatter line.
	const re = new RegExp(`^\\s*["']?${escaped}["']?\\s*:\\s*true\\s*$`, 'im');
	return re.test(block);
}

/** Pure: is `filePath` equal to, or nested under, any of `folderPaths`? */
export function pathIsUnderAny(filePath: string, folderPaths: string[]): boolean {
	return folderPaths.some((raw) => {
		const p = (raw ?? '').trim().replace(/\/+$/, '');
		if (!p) return false;
		return filePath === p || filePath.startsWith(p + '/');
	});
}

function extractFrontmatter(content: string): string | null {
	const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
	return m ? m[1] : null;
}

/**
 * True when this file must be left alone by every auto-folder-note path
 * (create-time wrapping and adoption). Checks, in order: always-ignore folder
 * paths, the metadata-cache frontmatter, then the on-disk frontmatter (covers
 * the cache lagging a fresh sync/agent write — the exact case that bit us).
 */
export async function isIgnored(plugin: FolderNotesPlugin, file: TFile): Promise<boolean> {
	const key = (plugin.settings.ignoreFrontmatterKey || DEFAULT_IGNORE_KEY).trim() || DEFAULT_IGNORE_KEY;

	if (pathIsUnderAny(file.path, plugin.settings.ignoreFolderPaths ?? [])) return true;

	const cache = plugin.app.metadataCache.getFileCache(file);
	if (cache?.frontmatter) {
		return cache.frontmatter[key] === true; // cache parsed it → authoritative
	}

	// No parsed frontmatter in cache: could be a brand-new write the cache hasn't
	// indexed yet. Parse the file head directly so a freshly-synced/agent-written
	// `fn-ignore: true` is still honoured.
	if (file.extension !== 'md') return false;
	try {
		const content = await plugin.app.vault.cachedRead(file);
		return frontmatterHasIgnoreKey(content, key);
	} catch {
		return false;
	}
}
