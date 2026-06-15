/**
 * Unit tests for the pure escape-hatch helpers (no Obsidian runtime needed).
 * Run: `npm run test:unit`
 */

import { describe, test, expect } from 'bun:test';
import { frontmatterHasIgnoreKey, pathIsUnderAny } from '../../src/functions/escapeHatches';

describe('frontmatterHasIgnoreKey', () => {
	const KEY = 'fn-ignore';

	test('true when the key is set to true', () => {
		expect(frontmatterHasIgnoreKey('---\nfn-ignore: true\n---\n# Note', KEY)).toBe(true);
	});

	test('handles other frontmatter keys around it', () => {
		const c = '---\ntitle: Hi\nfn-ignore: true\ntags: [a, b]\n---\nbody';
		expect(frontmatterHasIgnoreKey(c, KEY)).toBe(true);
	});

	test('case-insensitive on the value (True / TRUE)', () => {
		expect(frontmatterHasIgnoreKey('---\nfn-ignore: True\n---', KEY)).toBe(true);
		expect(frontmatterHasIgnoreKey('---\nfn-ignore: TRUE\n---', KEY)).toBe(true);
	});

	test('tolerates quoted key', () => {
		expect(frontmatterHasIgnoreKey('---\n"fn-ignore": true\n---', KEY)).toBe(true);
	});

	test('false when key is false / absent / not true', () => {
		expect(frontmatterHasIgnoreKey('---\nfn-ignore: false\n---', KEY)).toBe(false);
		expect(frontmatterHasIgnoreKey('---\ntitle: Hi\n---', KEY)).toBe(false);
		expect(frontmatterHasIgnoreKey('---\nfn-ignore: 1\n---', KEY)).toBe(false);
	});

	test('false when there is no frontmatter block', () => {
		expect(frontmatterHasIgnoreKey('# Just a heading\nfn-ignore: true', KEY)).toBe(false);
		expect(frontmatterHasIgnoreKey('', KEY)).toBe(false);
	});

	test('does not match a substring key (fn-ignore-extra)', () => {
		expect(frontmatterHasIgnoreKey('---\nfn-ignore-extra: true\n---', KEY)).toBe(false);
	});

	test('respects a custom key', () => {
		expect(frontmatterHasIgnoreKey('---\nno-wrap: true\n---', 'no-wrap')).toBe(true);
		expect(frontmatterHasIgnoreKey('---\nno-wrap: true\n---', 'fn-ignore')).toBe(false);
	});
});

describe('pathIsUnderAny', () => {
	test('matches exact path and nested paths', () => {
		expect(pathIsUnderAny('_agent_staging', ['_agent_staging'])).toBe(true);
		expect(pathIsUnderAny('_agent_staging/x.md', ['_agent_staging'])).toBe(true);
		expect(pathIsUnderAny('_agent_staging/sub/x.md', ['_agent_staging'])).toBe(true);
	});

	test('does not match sibling prefixes', () => {
		expect(pathIsUnderAny('_agent_staging_other/x.md', ['_agent_staging'])).toBe(false);
		expect(pathIsUnderAny('Notes/x.md', ['_agent_staging'])).toBe(false);
	});

	test('tolerates trailing slashes and blank entries', () => {
		expect(pathIsUnderAny('Data/x.md', ['Data/'])).toBe(true);
		expect(pathIsUnderAny('Data/x.md', ['', '  ', 'Data'])).toBe(true);
		expect(pathIsUnderAny('Data/x.md', [])).toBe(false);
	});

	test('matches any of several folders', () => {
		expect(pathIsUnderAny('Templates/t.md', ['_agent_staging', 'Templates'])).toBe(true);
	});
});
