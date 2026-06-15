/**
 * autoCreateDecision.ts — pure decision core for the sync-safe autoCreate guard.
 *
 * Deliberately has NO Obsidian imports so it is a total, side-effect-free state
 * machine that can be exhaustively unit-tested (tests/unit/autoCreateDecision.test.ts).
 * The IO (reading the vault / Sync status / disk) lives in syncSafeAutoCreate.ts,
 * which each tick gathers a GuardSnapshot and asks decide().
 *
 * State machine — one pending folder, evaluated each tick:
 *
 *     ┌──────────┐   folderGone | noteArrived        ┌──────┐
 *     │  WAITING │ ────────────────────────────────▶ │ SKIP │   (do not create)
 *     └────┬─────┘                                    └──────┘
 *          │   "no note is coming" (layer-dependent)  ┌────────┐
 *          └─────────────────────────────────────────▶│ CREATE │ (synthesize note)
 *                                                      └────────┘
 *
 * Terminal precedence (high → low):
 *   1. folderGone      → SKIP   (folder was renamed/deleted out from under us)
 *   2. noteArrived     → SKIP   (the genuine note exists — registry, event, or disk)
 *   3. elapsed≥maxWait → CREATE (hard bound; treat as a genuine empty folder)
 *   4. layer verdict   → CREATE | WAIT
 *
 * Layer verdict ("are we confident no note is coming yet?"):
 *   - sync-status usable → CREATE once Obsidian Sync has been idle ≥ minQuiet
 *                          (AND past the minQuiet floor); else WAIT.
 *   - else event-driven  → WAIT (no positive all-clear signal exists, so give the
 *                          arrival event the full maxWait; only #2 or #3 end it).
 *   - else timer-only    → CREATE once elapsed ≥ minQuiet; else WAIT.
 */

export type AutoCreateDecision = 'skip' | 'create' | 'wait';

export interface GuardSnapshot {
	/** ms since the folder-create event was first seen. */
	elapsedMs: number;
	/** minimum quiet window before a note may be synthesized. */
	minQuietMs: number;
	/** hard cap on total deferral. */
	maxWaitMs: number;
	/** does the folder still exist? */
	folderExists: boolean;
	/** has the genuine folder note appeared (registry / create event / disk)? */
	noteArrived: boolean;
	/** event-driven layer enabled? */
	eventDriven: boolean;
	/** sync-status layer enabled? */
	useSyncStatus: boolean;
	/** is the Obsidian Sync signal present AND operational (trustworthy)? */
	syncUsable: boolean;
	/** ms Obsidian Sync has been continuously idle (0 while transferring). */
	syncIdleForMs: number;
}

export function decideAutoCreate(s: GuardSnapshot): AutoCreateDecision {
	// (1)(2) terminals that always end the wait.
	if (!s.folderExists) return 'skip';
	if (s.noteArrived) return 'skip';

	// (3) hard bound — never defer forever.
	if (s.elapsedMs >= s.maxWaitMs) return 'create';

	// (4) layer verdict.
	if (s.useSyncStatus && s.syncUsable) {
		const settled = s.syncIdleForMs >= s.minQuietMs && s.elapsedMs >= s.minQuietMs;
		return settled ? 'create' : 'wait';
	}
	if (s.eventDriven) {
		return 'wait';
	}
	return s.elapsedMs >= s.minQuietMs ? 'create' : 'wait';
}
