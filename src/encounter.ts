// The encounter is plain text, one combatant per line, so the note stays readable
// and the plugin can write every change back into it.
//
//   round 2
//   > Goblin 2 [[Goblin]] init 14 mod +2 hp 5/7 ac 15 (prone)
//   Aria player init 12 hp 31/31 ac 15
//
// Hand-written lines can be shorter: "3x [[Goblin]]", "Aria player init 17",
// "Bandit captain hp 65 ac 15 init +2". Missing numbers come from the linked note.

export interface Combatant {
	name: string;
	link?: string; // the target inside [[ ]], without alias
	init?: number; // rolled or set initiative
	mod?: number; // initiative modifier
	hp?: number;
	maxHp?: number;
	ac?: number;
	player: boolean;
	conditions: string[];
	current: boolean;
}

export interface Encounter {
	round: number; // 0 = not started
	combatants: Combatant[];
}

export type Rng = () => number;

export const CONDITIONS = [
	'blinded', 'charmed', 'concentrating', 'deafened', 'frightened', 'grappled', 'incapacitated',
	'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious',
];

const int = (s: string | undefined) => (s !== undefined && /^[+-]?\d+$/.test(s) ? parseInt(s, 10) : undefined);

function linkName(link: string): string {
	const base = link.split('#')[0]!.split('^')[0]!;
	return base.split('/').pop()!.replace(/\.md$/i, '');
}

export function parseLine(line: string): Combatant[] {
	let rest = line.trim().replace(/^[-*+]\s+/, '');
	let current = false;
	if (rest.startsWith('>')) {
		current = true;
		rest = rest.slice(1).trim();
	}
	if (!rest) return [];

	let link: string | undefined;
	let alias: string | undefined;
	rest = rest.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/, (_m, l: string, a?: string) => {
		link = l.trim();
		alias = a?.trim();
		return ' ';
	});
	let conditions: string[] = [];
	rest = rest.replace(/\(([^)]*)\)/, (_m, c: string) => {
		conditions = c.split(',').map((s) => s.trim()).filter(Boolean);
		return ' ';
	});

	const tokens = rest.split(/\s+/).filter(Boolean);
	const name: string[] = [];
	let count = 1;
	const c: Combatant = { name: '', player: false, conditions, current };
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i]!;
		const low = t.toLowerCase();
		const next = tokens[i + 1];
		let m: RegExpExecArray | null;
		if ((m = /^(?:(\d+)x|x(\d+))$/i.exec(t))) {
			count = parseInt(m[1] ?? m[2]!, 10);
		} else if (i === 0 && /^\d+$/.test(t) && (tokens.length > 1 || link)) {
			count = parseInt(t, 10);
		} else if (low === 'player' || low === 'pc') {
			c.player = true;
		} else if (low === 'init' && next !== undefined && int(next) !== undefined) {
			if (/^[+-]/.test(next)) c.mod = int(next);
			else c.init = int(next);
			i++;
		} else if (low === 'mod' && int(next) !== undefined) {
			c.mod = int(next);
			i++;
		} else if (low === 'hp' && next !== undefined && (m = /^(\d+)(?:\/(\d+))?$/.exec(next))) {
			c.hp = parseInt(m[1]!, 10);
			c.maxHp = m[2] !== undefined ? parseInt(m[2], 10) : c.hp;
			i++;
		} else if (low === 'ac' && next !== undefined && /^\d+$/.test(next)) {
			c.ac = parseInt(next, 10);
			i++;
		} else {
			name.push(t);
		}
	}
	c.name = name.join(' ') || alias || (link ? linkName(link) : '');
	if (link) c.link = link;
	if (!c.name) return [];
	count = Math.max(1, Math.min(count, 50));
	if (count === 1) return [c];
	return Array.from({ length: count }, (_, i) => ({
		...c,
		name: `${c.name} ${i + 1}`,
		conditions: [...c.conditions],
		current: false,
	}));
}

export function parseEncounter(src: string): Encounter {
	const enc: Encounter = { round: 0, combatants: [] };
	for (const raw of src.split('\n')) {
		const line = raw.trim();
		if (!line || line.startsWith('%%') || line.startsWith('//')) continue;
		const r = /^round\s+(\d+)$/i.exec(line);
		if (r) {
			enc.round = parseInt(r[1]!, 10);
			continue;
		}
		enc.combatants.push(...parseLine(line));
	}
	// only one current turn
	let seen = false;
	for (const c of enc.combatants) {
		if (c.current && seen) c.current = false;
		if (c.current) seen = true;
	}
	return enc;
}

const signed = (n: number) => (n >= 0 ? `+${n}` : String(n));

export function serializeLine(c: Combatant): string {
	const parts: string[] = [];
	if (c.current) parts.push('>');
	parts.push(c.name);
	if (c.link) parts.push(`[[${c.link}]]`);
	if (c.player) parts.push('player');
	if (c.init !== undefined) parts.push(`init ${c.init}`);
	if (c.mod !== undefined) parts.push(`mod ${signed(c.mod)}`);
	if (c.hp !== undefined) parts.push(`hp ${c.hp}/${c.maxHp ?? c.hp}`);
	if (c.ac !== undefined) parts.push(`ac ${c.ac}`);
	if (c.conditions.length) parts.push(`(${c.conditions.join(', ')})`);
	return parts.join(' ');
}

export function serializeEncounter(e: Encounter): string {
	const lines = e.combatants.map(serializeLine);
	if (e.round > 0) lines.unshift(`round ${e.round}`);
	return lines.join('\n');
}

// ---- reading creature notes (Fantasy Statblocks frontmatter) ----

const num = (v: unknown): number | undefined => {
	if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
	if (typeof v === 'string') {
		const m = /-?\d+/.exec(v);
		return m ? parseInt(m[0], 10) : undefined;
	}
	return undefined;
};

export function statsFromFrontmatter(fm: Record<string, unknown> | undefined | null) {
	if (!fm) return {};
	const hp = num(fm.hp);
	const ac = num(fm.ac);
	let mod = num(fm.initiative) ?? num(fm.modifier);
	if (mod === undefined && Array.isArray(fm.stats)) {
		const dex = num(fm.stats[1]);
		if (dex !== undefined) mod = Math.floor((dex - 10) / 2);
	}
	const hitDice = typeof fm.hit_dice === 'string' ? fm.hit_dice : undefined;
	return { hp, ac, mod, hitDice };
}

// "18d10 + 36", "2d6", "3d8-3"
export function rollHitDice(expr: string, rng: Rng): number | undefined {
	const m = /^\s*(\d+)\s*d\s*(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(expr);
	if (!m) return undefined;
	let total = 0;
	const n = Math.min(parseInt(m[1]!, 10), 200);
	const faces = parseInt(m[2]!, 10);
	for (let i = 0; i < n; i++) total += Math.floor(rng() * faces) + 1;
	if (m[3]) total += (m[3] === '-' ? -1 : 1) * parseInt(m[4]!, 10);
	return Math.max(1, total);
}

// ---- turn order ----

export const d20 = (rng: Rng) => Math.floor(rng() * 20) + 1;

export function sortOrder(e: Encounter) {
	const idx = new Map(e.combatants.map((c, i) => [c, i]));
	e.combatants.sort((a, b) => {
		const ai = a.init ?? -Infinity;
		const bi = b.init ?? -Infinity;
		if (ai !== bi) return bi - ai;
		const am = a.mod ?? 0;
		const bm = b.mod ?? 0;
		if (am !== bm) return bm - am;
		return idx.get(a)! - idx.get(b)!;
	});
}

const isDown = (c: Combatant) => !c.player && c.hp !== undefined && c.hp <= 0;

// Rolls for every creature, and for players who have no number yet. Starts round 1.
export function rollAll(e: Encounter, rng: Rng) {
	for (const c of e.combatants) {
		if (!c.player || c.init === undefined) c.init = d20(rng) + (c.mod ?? 0);
		c.current = false;
	}
	sortOrder(e);
	e.round = 1;
	const first = e.combatants.find((c) => !isDown(c));
	if (first) first.current = true;
}

export function currentIndex(e: Encounter): number {
	return e.combatants.findIndex((c) => c.current);
}

export function step(e: Encounter, dir: 1 | -1, skipDown = true) {
	const list = e.combatants;
	if (!list.length) return;
	const eligible = (c: Combatant) => !(skipDown && isDown(c));
	if (!list.some(eligible)) return;
	let i = currentIndex(e);
	if (i < 0) {
		const first = dir === 1 ? list.findIndex(eligible) : list.length - 1 - [...list].reverse().findIndex(eligible);
		list[first]!.current = true;
		e.round = Math.max(1, e.round);
		return;
	}
	list[i]!.current = false;
	do {
		i += dir;
		if (i >= list.length) {
			i = 0;
			e.round++;
		} else if (i < 0) {
			i = list.length - 1;
			e.round = Math.max(1, e.round - 1);
		}
	} while (!eligible(list[i]!));
	list[i]!.current = true;
}

export function endCombat(e: Encounter) {
	e.round = 0;
	for (const c of e.combatants) c.current = false;
}

export function damage(c: Combatant, n: number) {
	if (c.hp === undefined) return;
	c.hp = Math.max(0, c.hp - Math.abs(n));
}

export function heal(c: Combatant, n: number) {
	if (c.hp === undefined) return;
	c.hp = Math.min(c.maxHp ?? Infinity, c.hp + Math.abs(n));
}

// New combatants added mid-fight with a modifier but no number get rolled in.
export function addCombatants(e: Encounter, line: string, rng: Rng): Combatant[] {
	const added = parseLine(line).map((c) => ({ ...c, current: false }));
	// "Goblin" added next to "Goblin 1", "Goblin 2" becomes "Goblin 3"
	for (const c of added) {
		const base = c.name.replace(/\s+\d+$/, '');
		const taken = new Set(e.combatants.map((x) => x.name));
		if (taken.has(c.name)) {
			let n = 2;
			while (taken.has(`${base} ${n}`)) n++;
			c.name = `${base} ${n}`;
		}
		if (e.round > 0 && c.init === undefined && !c.player) c.init = d20(rng) + (c.mod ?? 0);
		e.combatants.push(c);
	}
	if (e.round > 0) {
		const cur = e.combatants.find((c) => c.current);
		sortOrder(e);
		if (cur) cur.current = true;
	}
	return added;
}
