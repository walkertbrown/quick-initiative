// Browser demo: runs the real plugin against the test shim, over a sample note,
// and shows the note's text changing as the tracker is used.
import { App, installDomHelpers } from '../test/obsidian-shim';
import QuickInitiativePlugin from '../src/main';

installDomHelpers();

// Lucide icons (ISC license), the set Obsidian itself uses.
const ICONS: Record<string, string> = {
	x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
	plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
	check: '<path d="M20 6 9 17l-5-5"/>',
	'chevron-left': '<path d="m15 18-6-6 6-6"/>',
	'chevron-right': '<path d="m9 18 6-6-6-6"/>',
	square: '<rect width="18" height="18" x="3" y="3" rx="2"/>',
	shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
	heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
	sword: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/>',
	dices: '<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
};
(globalThis as unknown as { __iconHook: (el: HTMLElement, name: string) => void }).__iconHook = (el, name) => {
	const body = ICONS[name];
	if (!body) return;
	el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
};

const START = `# Session 12: the mill

\`\`\`initiative
Aria player init 17 hp 31 ac 16
Borin player init 9 hp 44 ac 18
3x [[Goblin]]
[[Bugbear]]
\`\`\`

The miller's son is tied up in the loft.`;

type Proc = (src: string, el: HTMLElement, c: unknown) => void;

async function main() {
	const app = new App();
	app.notes.set('Game.md', { path: 'Game.md', content: START });
	app.notes.set('Goblin', { path: 'Goblin.md', content: '', frontmatter: { statblock: true, hp: 7, ac: 15, hit_dice: '2d6', stats: [8, 14, 10, 10, 8, 8] } });
	app.notes.set('Bugbear', { path: 'Bugbear.md', content: '', frontmatter: { statblock: true, hp: 27, ac: 16, hit_dice: '5d8 + 5', stats: [15, 14, 13, 8, 11, 9] } });

	const plugin = new QuickInitiativePlugin(app as never, { id: 'quick-initiative' } as never);
	await plugin.onload();
	const proc = (plugin as never as { codeBlocks: Record<string, Proc> }).codeBlocks.initiative!;

	const source = document.querySelector<HTMLElement>('#source');
	const host = document.querySelector<HTMLElement>('#tracker');
	const note = () => app.notes.get('Game.md')!.content;
	const showSource = () => {
		if (source) source.textContent = note();
	};
	// where the block sits in the note right now, the way Obsidian reports it
	const ctx = {
		sourcePath: 'Game.md',
		addChild: () => {},
		getSectionInfo: () => {
			const lines = note().split('\n');
			const lineStart = lines.findIndex((l) => l.startsWith('```initiative'));
			const lineEnd = lines.findIndex((l, i) => i > lineStart && l.startsWith('```'));
			return { text: note(), lineStart, lineEnd };
		},
	};
	const process = app.vault.process;
	app.vault.process = async (f, fn) => {
		const out = await process(f, fn);
		showSource();
		if (source) {
			source.classList.remove('flash');
			void source.offsetWidth;
			source.classList.add('flash');
		}
		return out;
	};
	const render = () => {
		if (!host) return;
		const info = ctx.getSectionInfo();
		const body = note().split('\n').slice(info.lineStart + 1, info.lineEnd).join('\n');
		proc(body, host, ctx);
		showSource();
	};
	render();

	document.querySelector('#reset')?.addEventListener('click', () => {
		app.notes.get('Game.md')!.content = START;
		render();
	});
	const opened = document.querySelector<HTMLElement>('#opened');
	app.workspace.openLinkText = async (link: string) => {
		if (opened) opened.textContent = `In Obsidian this opens the "${link}" note.`;
	};
}

void main();
