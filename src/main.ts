import {
	App,
	Editor,
	MarkdownPostProcessorContext,
	Plugin,
	PluginSettingTab,
	SettingDefinitionItem,
	TFile,
	setIcon,
} from 'obsidian';
import {
	addCombatants,
	Combatant,
	CONDITIONS,
	currentIndex,
	damage,
	Encounter,
	endCombat,
	heal,
	parseEncounter,
	rollAll,
	rollHitDice,
	serializeEncounter,
	sortOrder,
	statsFromFrontmatter,
	step,
} from './encounter';

interface Settings {
	rollHp: boolean; // roll creature HP from hit dice instead of taking the average
	skipDown: boolean; // skip creatures at 0 HP when moving to the next turn
}

const DEFAULT_SETTINGS: Settings = { rollHp: false, skipDown: true };

const TEMPLATE = '```initiative\nAria player init 15 hp 31 ac 15\n2x [[Goblin]]\n```\n';

// Other plugins can listen with app.workspace.on('quick-initiative:change', (e) => ...)
export interface ChangeEvent {
	sourcePath: string;
	round: number;
	current: string | null;
	combatants: { name: string; link?: string; init?: number; hp?: number; maxHp?: number; player: boolean }[];
}

export default class QuickInitiativePlugin extends Plugin {
	settings: Settings = DEFAULT_SETTINGS;
	rng: () => number = Math.random;

	async onload() {
		await this.loadSettings();
		this.registerMarkdownCodeBlockProcessor('initiative', (source, el, ctx) => {
			const enc = parseEncounter(source);
			// numbers from creature notes are shown now and written on the next change,
			// so opening a note never edits it
			this.fillFromNotes(enc, ctx.sourcePath);
			new Tracker(this, el, ctx, enc).draw();
		});
		this.addCommand({
			id: 'insert-block',
			name: 'Insert initiative block',
			editorCallback: (editor: Editor) => editor.replaceSelection(TEMPLATE),
		});
		this.addSettingTab(new SettingTab(this.app, this));
	}

	// HP, AC and initiative modifier from the linked creature note, for numbers the line leaves out.
	// Returns true when something was filled in.
	fillFromNotes(enc: Encounter, sourcePath: string): boolean {
		let changed = false;
		for (const c of enc.combatants) {
			if (!c.link) continue;
			const file = this.app.metadataCache.getFirstLinkpathDest(c.link.split('#')[0]!, sourcePath);
			if (!(file instanceof TFile)) continue;
			const s = statsFromFrontmatter(this.app.metadataCache.getFileCache(file)?.frontmatter);
			if (c.hp === undefined) {
				const rolled = this.settings.rollHp && s.hitDice ? rollHitDice(s.hitDice, this.rng) : undefined;
				const hp = rolled ?? s.hp;
				if (hp !== undefined) {
					c.hp = hp;
					c.maxHp = hp;
					changed = true;
				}
			}
			if (c.ac === undefined && s.ac !== undefined) {
				c.ac = s.ac;
				changed = true;
			}
			if (c.mod === undefined && s.mod !== undefined) {
				c.mod = s.mod;
				changed = true;
			}
		}
		return changed;
	}

	// Rewrites the code block's body in the note. Returns false when the block can't be found.
	async write(el: HTMLElement, ctx: MarkdownPostProcessorContext, enc: Encounter): Promise<boolean> {
		const info = ctx.getSectionInfo(el);
		const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
		if (!info || !(file instanceof TFile)) return false;
		let ok = false;
		await this.app.vault.process(file, (data) => {
			const lines = data.split('\n');
			const open = /^((?:\s*>)*\s*)(`{3,}|~{3,})\s*initiative\b/.exec(lines[info.lineStart] ?? '');
			const close = lines[info.lineEnd] ?? '';
			if (!open || !close.includes(open[2]!)) return data; // the note changed under us; leave it alone
			const prefix = open[1]!;
			const body = serializeEncounter(enc).split('\n').filter(Boolean).map((l) => prefix + l);
			lines.splice(info.lineStart + 1, info.lineEnd - info.lineStart - 1, ...body);
			ok = true;
			return lines.join('\n');
		});
		return ok;
	}

	announce(sourcePath: string, enc: Encounter) {
		const cur = enc.combatants[currentIndex(enc)];
		const ev: ChangeEvent = {
			sourcePath,
			round: enc.round,
			current: cur ? cur.name : null,
			combatants: enc.combatants.map((c) => ({
				name: c.name, link: c.link, init: c.init, hp: c.hp, maxHp: c.maxHp, player: c.player,
			})),
		};
		this.app.workspace.trigger('quick-initiative:change', ev);
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<Settings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}
	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// One rendered `initiative` block.
class Tracker {
	private saved = true;
	private openEditor: { index: number; kind: 'hp' | 'init' | 'cond' } | null = null;

	constructor(
		private plugin: QuickInitiativePlugin,
		private el: HTMLElement,
		private ctx: MarkdownPostProcessorContext,
		private enc: Encounter,
	) {}

	private async commit() {
		this.openEditor = null;
		this.draw();
		this.plugin.announce(this.ctx.sourcePath, this.enc);
		this.saved = await this.plugin.write(this.el, this.ctx, this.enc);
		if (!this.saved) this.draw();
	}

	draw() {
		const { enc, el } = this;
		el.empty();
		const root = el.createDiv({ cls: 'qi' });
		if (enc.round > 0) root.addClass('qi-live');

		const head = root.createDiv({ cls: 'qi-head' });
		const badge = head.createDiv({ cls: 'qi-round' });
		if (enc.round > 0) {
			badge.createSpan({ cls: 'qi-round-label', text: 'Round' });
			badge.createSpan({ cls: 'qi-round-num', text: String(enc.round) });
		} else {
			badge.createSpan({ cls: 'qi-round-label', text: enc.combatants.length ? 'Ready' : 'Empty' });
		}
		const tools = head.createDiv({ cls: 'qi-tools' });
		this.button(tools, 'dices', enc.round > 0 ? 'Reroll' : 'Roll initiative', 'qi-roll', () => {
			rollAll(enc, this.plugin.rng);
			void this.commit();
		});
		if (enc.round > 0) {
			this.button(tools, 'chevron-left', '', 'qi-prev', () => {
				step(enc, -1, this.plugin.settings.skipDown);
				void this.commit();
			}, 'Previous turn');
			this.button(tools, 'chevron-right', 'Next', 'qi-next', () => {
				step(enc, 1, this.plugin.settings.skipDown);
				void this.commit();
			}, 'Next turn');
			this.button(tools, 'square', '', 'qi-end', () => {
				endCombat(enc);
				void this.commit();
			}, 'End combat');
		}

		const list = root.createDiv({ cls: 'qi-list' });
		enc.combatants.forEach((c, i) => this.row(list, c, i));
		if (!enc.combatants.length) {
			list.createDiv({ cls: 'qi-empty', text: 'Add a creature or player below, or write one per line in the block.' });
		}

		const add = root.createDiv({ cls: 'qi-add' });
		const input = add.createEl('input', { type: 'text', placeholder: 'Add: 2x [[Goblin]]  or  Aria player init 17' });
		input.addClass('qi-add-input');
		input.setAttr('aria-label', 'Add combatants');
		const go = () => {
			const v = input.value.trim();
			if (!v) return;
			const added = addCombatants(enc, v, this.plugin.rng);
			if (!added.length) return;
			this.plugin.fillFromNotes(enc, this.ctx.sourcePath);
			void this.commit();
		};
		input.addEventListener('keydown', (ev) => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				go();
			}
		});
		this.button(add, 'plus', 'Add', 'qi-add-go', go);

		if (!this.saved) {
			root.createDiv({ cls: 'qi-unsaved', text: 'Not saved: open the note itself to keep changes.' });
		}
	}

	private row(list: HTMLElement, c: Combatant, i: number) {
		const row = list.createDiv({ cls: 'qi-row' });
		if (c.current) row.addClass('is-current');
		if (c.player) row.addClass('is-player');
		const down = c.hp !== undefined && c.hp <= 0;
		if (down) row.addClass('is-down');

		const init = row.createEl('button', { cls: 'qi-init', text: c.init === undefined ? '–' : String(c.init) });
		init.setAttr('aria-label', `Initiative for ${c.name}`);
		if (c.mod !== undefined) init.title = `Modifier ${c.mod >= 0 ? '+' : ''}${c.mod}`;
		init.onclick = () => this.toggleEditor(i, 'init');

		const main = row.createDiv({ cls: 'qi-main' });
		const top = main.createDiv({ cls: 'qi-top' });
		if (c.link) {
			const a = top.createEl('a', { cls: 'qi-name internal-link', text: c.name });
			a.setAttr('data-href', c.link);
			a.setAttr('href', c.link);
			a.onclick = (ev) => {
				ev.preventDefault();
				void this.plugin.app.workspace.openLinkText(c.link!, this.ctx.sourcePath, ev.ctrlKey || ev.metaKey);
			};
		} else {
			top.createSpan({ cls: 'qi-name', text: c.name });
		}
		if (c.player) top.createSpan({ cls: 'qi-tag', text: 'PC' });
		if (c.ac !== undefined) {
			const ac = top.createSpan({ cls: 'qi-ac' });
			const shield = ac.createSpan({ cls: 'qi-ac-icon' });
			setIcon(shield, 'shield');
			ac.createSpan({ text: String(c.ac) });
			ac.title = 'Armor class';
		}

		if (c.hp !== undefined) {
			const max = Math.max(1, c.maxHp ?? c.hp);
			const pct = Math.max(0, Math.min(1, c.hp / max));
			const bar = main.createDiv({ cls: 'qi-bar' });
			const fill = bar.createDiv({ cls: 'qi-bar-fill' });
			fill.style.width = `${Math.round(pct * 100)}%`;
			fill.addClass(pct > 0.5 ? 'qi-ok' : pct > 0.25 ? 'qi-hurt' : 'qi-bad');
		}

		const conds = main.createDiv({ cls: 'qi-conds' });
		for (const cond of c.conditions) {
			const pill = conds.createEl('button', { cls: 'qi-cond', text: cond });
			pill.setAttr('aria-label', `Remove ${cond}`);
			pill.title = 'Click to remove';
			pill.onclick = () => {
				c.conditions = c.conditions.filter((x) => x !== cond);
				void this.commit();
			};
		}
		const plus = conds.createEl('button', { cls: 'qi-cond qi-cond-add', text: '+ condition' });
		plus.onclick = () => this.toggleEditor(i, 'cond');

		const hp = row.createEl('button', { cls: 'qi-hp' });
		hp.setAttr('aria-label', `Hit points for ${c.name}`);
		if (c.hp === undefined) {
			hp.setText('HP');
			hp.addClass('qi-hp-none');
		} else {
			hp.createSpan({ cls: 'qi-hp-now', text: String(c.hp) });
			hp.createSpan({ cls: 'qi-hp-max', text: `/${c.maxHp ?? c.hp}` });
		}
		hp.onclick = () => this.toggleEditor(i, 'hp');

		const del = row.createEl('button', { cls: 'qi-del' });
		setIcon(del, 'x');
		del.setAttr('aria-label', `Remove ${c.name}`);
		del.onclick = () => {
			const wasCurrent = c.current;
			this.enc.combatants.splice(i, 1);
			if (wasCurrent && this.enc.combatants.length) {
				const next = this.enc.combatants[Math.min(i, this.enc.combatants.length - 1)]!;
				next.current = true;
			}
			if (!this.enc.combatants.length) endCombat(this.enc);
			void this.commit();
		};

		if (this.openEditor?.index === i) this.editor(list, c, this.openEditor.kind);
	}

	private toggleEditor(index: number, kind: 'hp' | 'init' | 'cond') {
		const same = this.openEditor?.index === index && this.openEditor.kind === kind;
		this.openEditor = same ? null : { index, kind };
		this.draw();
		this.el.querySelector<HTMLInputElement>('.qi-edit input')?.focus();
	}

	private editor(list: HTMLElement, c: Combatant, kind: 'hp' | 'init' | 'cond') {
		const box = list.createDiv({ cls: 'qi-edit' });
		const input = box.createEl('input', { type: kind === 'cond' ? 'text' : 'number' });
		if (kind === 'hp') {
			input.setAttr('placeholder', c.hp === undefined ? 'Max HP' : 'Amount');
			input.setAttr('inputmode', 'numeric');
			const val = () => Math.abs(parseInt(input.value, 10));
			if (c.hp === undefined) {
				this.button(box, 'check', 'Set HP', 'qi-set', () => {
					if (!Number.isFinite(val())) return;
					c.hp = c.maxHp = val();
					void this.commit();
				});
			} else {
				this.button(box, 'sword', 'Damage', 'qi-damage', () => {
					if (!Number.isFinite(val())) return;
					damage(c, val());
					void this.commit();
				});
				this.button(box, 'heart', 'Heal', 'qi-heal', () => {
					if (!Number.isFinite(val())) return;
					heal(c, val());
					void this.commit();
				});
			}
			input.addEventListener('keydown', (ev) => {
				if (ev.key !== 'Enter') return;
				ev.preventDefault();
				box.querySelector<HTMLButtonElement>('.qi-damage, .qi-set')?.click();
			});
		} else if (kind === 'init') {
			input.setAttr('placeholder', 'Initiative');
			input.setAttr('inputmode', 'numeric');
			const set = () => {
				const n = parseInt(input.value, 10);
				if (!Number.isFinite(n)) return;
				c.init = n;
				if (this.enc.round > 0) {
					const cur = this.enc.combatants.find((x) => x.current);
					sortOrder(this.enc);
					if (cur) cur.current = true;
				}
				void this.commit();
			};
			this.button(box, 'check', 'Set', 'qi-set', set);
			input.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					set();
				}
			});
		} else {
			input.setAttr('placeholder', 'poisoned, prone…');
			const listId = `qi-conds-${Math.floor(Math.random() * 1e9)}`;
			input.setAttr('list', listId);
			const dl = box.createEl('datalist');
			dl.id = listId;
			for (const name of CONDITIONS) dl.createEl('option').setAttr('value', name);
			const add = () => {
				const names = input.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
				if (!names.length) return;
				for (const n of names) if (!c.conditions.includes(n)) c.conditions.push(n);
				void this.commit();
			};
			this.button(box, 'plus', 'Add', 'qi-set', add);
			input.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter') {
					ev.preventDefault();
					add();
				}
			});
			const quick = box.createDiv({ cls: 'qi-quick' });
			for (const name of ['prone', 'poisoned', 'frightened', 'stunned', 'concentrating']) {
				if (c.conditions.includes(name)) continue;
				const b = quick.createEl('button', { cls: 'qi-cond', text: name });
				b.onclick = () => {
					c.conditions.push(name);
					void this.commit();
				};
			}
		}
	}

	private button(parent: HTMLElement, icon: string, label: string, cls: string, fn: () => void, aria?: string) {
		const b = parent.createEl('button', { cls: `qi-btn ${cls}` });
		const i = b.createSpan({ cls: 'qi-btn-icon' });
		setIcon(i, icon);
		if (label) b.createSpan({ text: label });
		b.setAttr('aria-label', aria ?? label);
		b.onclick = (ev) => {
			ev.preventDefault();
			fn();
		};
		return b;
	}
}

class SettingTab extends PluginSettingTab {
	constructor(app: App, private plugin: QuickInitiativePlugin) {
		super(app, plugin);
	}
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Roll creature HP',
				desc: 'Roll hit points from the creature note\'s hit dice instead of using its average.',
				control: { type: 'toggle', key: 'rollHp', defaultValue: false },
			},
			{
				name: 'Skip creatures at 0 HP',
				desc: 'Next turn skips creatures that are down. Players are never skipped.',
				control: { type: 'toggle', key: 'skipDown', defaultValue: true },
			},
		];
	}
	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof Settings];
	}
	async setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
		await this.plugin.saveSettings();
	}
}
