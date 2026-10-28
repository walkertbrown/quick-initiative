// A tiny stand-in for the `obsidian` module so main.ts can run under jsdom.
// Only what Quick Initiative touches is here.

type Opts = { cls?: string; text?: string; type?: string; placeholder?: string };

function make(this: HTMLElement | void, tag: string, o?: Opts): HTMLElement {
	const el = document.createElement(tag);
	if (o?.cls) el.className = o.cls;
	if (o?.text) el.textContent = o.text;
	if (o?.type) el.setAttribute('type', o.type);
	if (o?.placeholder) el.setAttribute('placeholder', o.placeholder);
	if (this && this !== (globalThis as unknown)) (this as HTMLElement).appendChild(el);
	return el;
}

export function installDomHelpers() {
	const P = HTMLElement.prototype as unknown as Record<string, unknown>;
	P.createSpan = function (this: HTMLElement, o?: Opts) { return make.call(this, 'span', o); };
	P.createDiv = function (this: HTMLElement, o?: Opts) { return make.call(this, 'div', o); };
	P.createEl = function (this: HTMLElement, tag: string, o?: Opts) { return make.call(this, tag, o); };
	P.setText = function (this: HTMLElement, t: string) { this.textContent = t; };
	P.empty = function (this: HTMLElement) { this.replaceChildren(); };
	P.addClass = function (this: HTMLElement, ...c: string[]) { this.classList.add(...c); };
	P.removeClass = function (this: HTMLElement, ...c: string[]) { this.classList.remove(...c); };
	P.hide = function (this: HTMLElement) { this.style.display = 'none'; };
	P.show = function (this: HTMLElement) { this.style.display = ''; };
	P.setAttr = function (this: HTMLElement, k: string, v: string) { this.setAttribute(k, v); };
	(globalThis as unknown as Record<string, unknown>).createSpan = (o?: Opts) => make.call(undefined, 'span', o);
	(globalThis as unknown as Record<string, unknown>).createDiv = (o?: Opts) => make.call(undefined, 'div', o);
}

export class TFile {
	constructor(public path: string, public basename = path.replace(/\.md$/, '')) {}
}

export interface FakeNote { path: string; content: string; frontmatter?: Record<string, unknown> }

export class App {
	notes = new Map<string, FakeNote>();
	events: { name: string; data: unknown }[] = [];
	opened: string[] = [];
	private find(key: string) {
		return this.notes.get(key) ?? this.notes.get(key + '.md') ?? [...this.notes.values()].find((n) => n.path === key);
	}
	metadataCache = {
		getFirstLinkpathDest: (link: string): TFile | null => {
			const n = this.find(link);
			return n ? new TFile(n.path) : null;
		},
		getFileCache: (f: TFile) => {
			const n = this.find(f.path);
			return n ? { frontmatter: n.frontmatter } : null;
		},
	};
	vault = {
		getAbstractFileByPath: (path: string) => (this.find(path) ? new TFile(path) : null),
		process: async (f: TFile, fn: (data: string) => string) => {
			const n = this.find(f.path)!;
			n.content = fn(n.content);
			return n.content;
		},
	};
	workspace = {
		trigger: (name: string, data: unknown) => { this.events.push({ name, data }); },
		openLinkText: async (link: string) => { this.opened.push(link); },
	};
}

export class Component {
	load() {}
	unload() {}
}
export class MarkdownRenderChild extends Component {
	constructor(public containerEl: HTMLElement) { super(); }
}

export class Plugin extends Component {
	postProcessors: ((el: HTMLElement, ctx: Ctx) => void)[] = [];
	codeBlocks: Record<string, (src: string, el: HTMLElement, ctx: Ctx) => void> = {};
	commands: { id: string; name: string; callback: () => void }[] = [];
	settingTab: unknown;
	data: unknown = null;
	constructor(public app: App, public manifest: unknown) { super(); }
	registerMarkdownPostProcessor(fn: (el: HTMLElement, ctx: Ctx) => void) { this.postProcessors.push(fn); }
	registerMarkdownCodeBlockProcessor(lang: string, fn: (src: string, el: HTMLElement, ctx: Ctx) => void) { this.codeBlocks[lang] = fn; }
	addCommand(c: { id: string; name: string; callback: () => void }) { this.commands.push(c); }
	addSettingTab(t: unknown) { this.settingTab = t; }
	async loadData() { return this.data; }
	async saveData(d: unknown) { this.data = d; }
}

export interface SectionInfo { text: string; lineStart: number; lineEnd: number }
export interface Ctx { sourcePath: string; addChild: (c: Component) => void; getSectionInfo: (el: HTMLElement) => SectionInfo | null }
export function ctx(sourcePath = 'Game.md', info: SectionInfo | null = null): Ctx {
	return { sourcePath, addChild: () => {}, getSectionInfo: () => info };
}

export class Modal {
	contentEl = document.createElement('div');
	titleEl = document.createElement('div');
	constructor(public app: App) {}
	open() { this.onOpen(); }
	close() { this.onClose(); }
	onOpen() {}
	onClose() {}
	setTitle(t: string) { this.titleEl.textContent = t; }
}

export class PluginSettingTab {
	containerEl = document.createElement('div');
	constructor(public app: App, public plugin: Plugin) {}
}

export class Notice {
	static last = '';
	constructor(msg: string) { Notice.last = msg; }
}

export const MarkdownRenderer = {
	render: async (_app: App, md: string, el: HTMLElement) => {
		el.textContent = md;
	},
};

export function setIcon(el: HTMLElement, name: string) {
	el.setAttribute('data-icon', name);
	// the browser demo draws real icons through this hook
	const hook = (globalThis as unknown as { __iconHook?: (el: HTMLElement, name: string) => void }).__iconHook;
	if (hook) hook(el, name);
}
