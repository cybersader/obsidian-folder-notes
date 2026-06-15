/**
 * Unit tests for the pure sync-safe autoCreate decision core.
 * Run: `npm run test:unit`  (bun test — native TS, no Obsidian needed)
 *
 * These exhaustively pin the state machine in autoCreateDecision.ts. The E2E
 * matrix (tests/e2e/sync-race.spec.ts) then proves the IO layer wires it to real
 * Obsidian correctly.
 */

import { describe, test, expect } from 'bun:test';
import { decideAutoCreate, type GuardSnapshot } from '../../src/events/autoCreateDecision';

/** A baseline "still waiting, nothing decided yet" snapshot; override per case. */
function snap(over: Partial<GuardSnapshot> = {}): GuardSnapshot {
	return {
		elapsedMs: 0,
		minQuietMs: 600,
		maxWaitMs: 4000,
		folderExists: true,
		noteArrived: false,
		eventDriven: true,
		useSyncStatus: true,
		syncUsable: false,
		syncIdleForMs: 0,
		...over,
	};
}

describe('decideAutoCreate — terminals (always win)', () => {
	test('folder gone → skip, regardless of everything else', () => {
		expect(decideAutoCreate(snap({ folderExists: false }))).toBe('skip');
		expect(decideAutoCreate(snap({ folderExists: false, noteArrived: true, elapsedMs: 99999 }))).toBe('skip');
	});

	test('note arrived → skip, even past the hard maxWait bound', () => {
		expect(decideAutoCreate(snap({ noteArrived: true }))).toBe('skip');
		expect(decideAutoCreate(snap({ noteArrived: true, elapsedMs: 999999 }))).toBe('skip');
	});

	test('elapsed ≥ maxWait with no note → create (never defer forever)', () => {
		expect(decideAutoCreate(snap({ elapsedMs: 4000 }))).toBe('create');
		expect(decideAutoCreate(snap({ elapsedMs: 4001, syncUsable: true, syncIdleForMs: 0 }))).toBe('create');
	});
});

describe('decideAutoCreate — sync-status layer (usable)', () => {
	const base = { useSyncStatus: true, syncUsable: true } as const;

	test('sync busy (idle 0) → wait, no matter how much time passed', () => {
		expect(decideAutoCreate(snap({ ...base, elapsedMs: 3000, syncIdleForMs: 0 }))).toBe('wait');
	});

	test('sync idle but < minQuiet → wait', () => {
		expect(decideAutoCreate(snap({ ...base, elapsedMs: 2000, syncIdleForMs: 300 }))).toBe('wait');
	});

	test('sync idle ≥ minQuiet AND past the floor → create', () => {
		expect(decideAutoCreate(snap({ ...base, elapsedMs: 700, syncIdleForMs: 600 }))).toBe('create');
	});

	test('idle ≥ minQuiet but elapsed still below the floor → wait', () => {
		expect(decideAutoCreate(snap({ ...base, elapsedMs: 500, minQuietMs: 600, syncIdleForMs: 600 }))).toBe('wait');
	});
});

describe('decideAutoCreate — event-driven layer (no usable sync)', () => {
	test('waits the full bound for the arrival event; the timer never fires early', () => {
		const s = snap({ useSyncStatus: false, syncUsable: false, eventDriven: true, elapsedMs: 3500, minQuietMs: 600 });
		expect(decideAutoCreate(s)).toBe('wait'); // would be "create" under timer-only
	});

	test('still ends via maxWait', () => {
		const s = snap({ useSyncStatus: false, eventDriven: true, elapsedMs: 4000 });
		expect(decideAutoCreate(s)).toBe('create');
	});

	test('useSyncStatus on but sync NOT usable falls through to event-driven', () => {
		const s = snap({ useSyncStatus: true, syncUsable: false, eventDriven: true, elapsedMs: 3500 });
		expect(decideAutoCreate(s)).toBe('wait');
	});
});

describe('decideAutoCreate — timer-only layer', () => {
	const timer = { eventDriven: false, useSyncStatus: false, syncUsable: false } as const;

	test('before minQuiet → wait', () => {
		expect(decideAutoCreate(snap({ ...timer, elapsedMs: 599, minQuietMs: 600 }))).toBe('wait');
	});

	test('at/after minQuiet → create (the fixed-window behaviour)', () => {
		expect(decideAutoCreate(snap({ ...timer, elapsedMs: 600, minQuietMs: 600 }))).toBe('create');
		expect(decideAutoCreate(snap({ ...timer, elapsedMs: 5000, minQuietMs: 600 }))).toBe('create');
	});

	test('minQuiet = 0 → creates immediately when nothing else intervenes', () => {
		expect(decideAutoCreate(snap({ ...timer, elapsedMs: 0, minQuietMs: 0 }))).toBe('create');
	});
});
