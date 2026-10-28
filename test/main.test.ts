// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from 'vitest';
import { App, ctx, installDomHelpers } from './obsidian-shim';
import QuickInitiativePlugin from '../src/main';

beforeAll(() => installDomHelpers());

type Proc = (src: string, el: HTMLElement, c: ReturnType<typeof ctx>) => void;

async function setup(note: string, extra: Record<string, { content?: string; frontmatter?: Record<string, unknown> }> = {}) {
	const app = new App();
	app.notes.set('Game.md', { path: 'Game.md', content: note });
	for (const [k, v] of Object.entries(extra)) app.notes.set(k, { path: `${k}.md`, content: v.content ?? '', ...v });
	const plugin = new QuickInitiativePlugin(app as never, { id: 'quick-initiative' } as never);
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks.initiative!;
	const lines = note.split('\n');
	const lineStart = lines.findIndex((l) => /```initiative/.test(l));
	const lineEnd = lines.findIndex((l, i) => i > lineStart && l.includes('```'));
	const body = lines.slice(lineStart + 1, lineEnd).join('\n');
	const el = document.createElement('div');
	proc(body, el, ctx('Game.md', { text: note, lineStart, lineEnd }));
	const flush = () => new Promise((r) => setTimeout(r, 0));
	const content = () => app.notes.get('Game.md')!.content;
	const click = async (sel: string) => {
		el.querySelector<HTMLElement>(sel)!.click();
		await flush();
	};
	return { app, plugin, el, content, click, flush };
}

const NOTE = '# Fight\n\n```initiative\nAria player init 15 hp 31 ac 15\n2x [[Goblin]]\n```\n\nAfter.';
const GOBLIN = { frontmatter: { statblock: true, hp: 7, ac: 15, stats: [8, 14, 10, 10, 8, 8] } };

describe('initiative block', () => {
	it('draws rows with numbers filled from the creature note, without editing the note', async () => {
		const { el, content } = await setup(NOTE, { Goblin: GOBLIN });
		const names = Array.from(el.querySelectorAll('.qi-name')).map((n) => n.textContent);
		expect(names).toEqual(['Aria', 'Goblin 1', 'Goblin 2']);
		expect(el.querySelectorAll('.qi-ac').length).toBe(3);
		expect(el.querySelector('.qi-row:nth-child(2) .qi-hp')!.textContent).toBe('7/7');
		expect(content()).toBe(NOTE);
	});

	it('rolls initiative and writes the fight into the note', async () => {
		const { plugin, content, click, el, app } = await setup(NOTE, { Goblin: GOBLIN });
		plugin.rng = () => 0.5; // d20 = 11, goblins +2 = 13
		await click('.qi-roll');
		expect(content()).toBe(
			'# Fight\n\n```initiative\nround 1\n> Aria player init 15 hp 31/31 ac 15\n' +
			'Goblin 1 [[Goblin]] init 13 mod +2 hp 7/7 ac 15\nGoblin 2 [[Goblin]] init 13 mod +2 hp 7/7 ac 15\n```\n\nAfter.',
		);
		expect(el.querySelector('.qi-round-num')!.textContent).toBe('1');
		expect(app.events.at(-1)).toMatchObject({ name: 'quick-initiative:change', data: { round: 1, current: 'Aria' } });
		// conditions go out too, so Session Log can note them going on and off
		expect((app.events.at(-1)!.data as { combatants: { conditions: string[] }[] }).combatants[0]!.conditions).toEqual([]);
	});

	it('next turn moves the marker', async () => {
		const { content, click } = await setup('```initiative\nround 1\n> A init 20\nB init 10\n```');
		await click('.qi-next');
		expect(content()).toBe('```initiative\nround 1\nA init 20\n> B init 10\n```');
		await click('.qi-next');
		expect(content()).toBe('```initiative\nround 2\n> A init 20\nB init 10\n```');
	});

	it('applies damage from the HP editor', async () => {
		const { el, content, click } = await setup('```initiative\nOgre hp 59 ac 11\n```');
		await click('.qi-hp');
		const input = el.querySelector<HTMLInputElement>('.qi-edit input')!;
		input.value = '12';
		await click('.qi-damage');
		expect(content()).toBe('```initiative\nOgre hp 47/59 ac 11\n```');
	});

	it('adds and removes conditions', async () => {
		const { el, content, click } = await setup('```initiative\nOgre\n```');
		await click('.qi-cond-add');
		el.querySelector<HTMLInputElement>('.qi-edit input')!.value = 'Prone, grappled';
		await click('.qi-edit .qi-set');
		expect(content()).toBe('```initiative\nOgre (prone, grappled)\n```');
		await click('.qi-cond');
		expect(content()).toBe('```initiative\nOgre (grappled)\n```');
	});

	it('adds combatants from the input', async () => {
		const { el, content, click } = await setup('```initiative\nAria player\n```', { Goblin: GOBLIN });
		el.querySelector<HTMLInputElement>('.qi-add-input')!.value = '[[Goblin]]';
		await click('.qi-add-go');
		expect(content()).toBe('```initiative\nAria player\nGoblin [[Goblin]] mod +2 hp 7/7 ac 15\n```');
	});

	it('keeps the callout prefix when the block sits in a callout', async () => {
		const { content, click } = await setup('> [!note]\n> ```initiative\n> A init 20\n> B init 10\n> ```');
		await click('.qi-roll');
		expect(content().split('\n')[2]).toMatch(/^> round 1$/);
	});

	it('leaves the note alone if the block moved', async () => {
		const { app, content, click, el } = await setup('```initiative\nA init 20\n```');
		app.notes.get('Game.md')!.content = 'Someone typed above\n```initiative\nA init 20\n```';
		await click('.qi-roll');
		expect(content()).toBe('Someone typed above\n```initiative\nA init 20\n```');
		expect(el.querySelector('.qi-unsaved')).not.toBeNull();
	});

	it('opens the creature note from its name', async () => {
		const { app, click } = await setup('```initiative\n[[Goblin]]\n```', { Goblin: GOBLIN });
		await click('.qi-name');
		expect(app.opened).toEqual(['Goblin']);
	});
});
