import { describe, expect, it } from 'vitest';
import {
	addCombatants,
	currentIndex,
	damage,
	endCombat,
	heal,
	parseEncounter,
	parseLine,
	rollAll,
	rollHitDice,
	serializeEncounter,
	serializeLine,
	statsFromFrontmatter,
	step,
} from '../src/encounter';

// a fixed sequence of "random" numbers in [0,1)
const seq = (...xs: number[]) => {
	let i = 0;
	return () => xs[i++ % xs.length]!;
};

describe('parseLine', () => {
	it('reads a full line', () => {
		const [c] = parseLine('> Goblin 2 [[Goblin]] init 14 mod +2 hp 5/7 ac 15 (prone, poisoned)');
		expect(c).toEqual({
			name: 'Goblin 2', link: 'Goblin', init: 14, mod: 2, hp: 5, maxHp: 7, ac: 15,
			player: false, conditions: ['prone', 'poisoned'], current: true,
		});
	});
	it('reads a short player line', () => {
		const [c] = parseLine('Aria player init 17 hp 31 ac 15');
		expect(c).toMatchObject({ name: 'Aria', player: true, init: 17, hp: 31, maxHp: 31, ac: 15 });
	});
	it('treats a signed init as the modifier', () => {
		expect(parseLine('Bandit captain hp 65 init +2')[0]).toMatchObject({ name: 'Bandit captain', mod: 2, hp: 65 });
		expect(parseLine('Bandit captain init +2')[0]!.init).toBeUndefined();
		expect(parseLine('Zombie init -2')[0]!.mod).toBe(-2);
	});
	it('expands counts and names from the link', () => {
		const three = parseLine('3x [[Monsters/Goblin]]');
		expect(three.map((c) => c.name)).toEqual(['Goblin 1', 'Goblin 2', 'Goblin 3']);
		expect(three[0]!.link).toBe('Monsters/Goblin');
		expect(parseLine('[[Goblin]] x2').length).toBe(2);
		expect(parseLine('2 Bandits').map((c) => c.name)).toEqual(['Bandits 1', 'Bandits 2']);
		expect(parseLine('Goblin 2')).toHaveLength(1);
	});
	it('uses the link alias as the name', () => {
		expect(parseLine('[[Goblin|Snik]]')[0]).toMatchObject({ name: 'Snik', link: 'Goblin' });
	});
	it('ignores list markers and empty lines', () => {
		expect(parseLine('- Aria player')[0]!.name).toBe('Aria');
		expect(parseLine('   ')).toEqual([]);
	});
	it('round-trips', () => {
		for (const l of [
			'> Goblin 2 [[Goblin]] init 14 mod +2 hp 5/7 ac 15 (prone, poisoned)',
			'Aria player init 12 hp 31/31 ac 15',
			'Zombie init 3 mod -2 hp 22/22',
		]) {
			expect(serializeLine(parseLine(l)[0]!)).toBe(l);
		}
	});
});

describe('encounter', () => {
	const src = 'round 2\n> Goblin 1 init 14 hp 0/7\nAria player init 12 hp 31/31\nGoblin 2 init 9 hp 7/7\n';

	it('parses and writes back', () => {
		const e = parseEncounter(src);
		expect(e.round).toBe(2);
		expect(e.combatants).toHaveLength(3);
		expect(serializeEncounter(e)).toBe(src.trim());
	});
	it('keeps only one current turn', () => {
		const e = parseEncounter('> A\n> B');
		expect(e.combatants.filter((c) => c.current)).toHaveLength(1);
	});
	it('rolls everyone but players who have a number, sorts, starts round 1', () => {
		const e = parseEncounter('Aria player init 12\nBorin player\nOgre mod -1\nWolf mod +2');
		// d20 rolls: Borin 0.5 -> 11, Ogre 0.95 -> 20, Wolf 0.0 -> 1
		rollAll(e, seq(0.5, 0.95, 0.0));
		expect(e.combatants.map((c) => [c.name, c.init])).toEqual([
			['Ogre', 19], ['Aria', 12], ['Borin', 11], ['Wolf', 3],
		]);
		expect(e.round).toBe(1);
		expect(e.combatants[0]!.current).toBe(true);
	});
	it('breaks ties by modifier, then by order', () => {
		const e = parseEncounter('A init 10 mod 0\nB init 10 mod +3\nC init 10 mod 0');
		rollAll(e, seq(0.45)); // all roll 10
		expect(e.combatants.map((c) => c.name)).toEqual(['B', 'A', 'C']);
	});
	it('steps turns, wraps rounds and skips creatures that are down', () => {
		const e = parseEncounter(src);
		step(e, 1);
		expect(e.combatants[currentIndex(e)]!.name).toBe('Aria');
		step(e, 1);
		expect(e.combatants[currentIndex(e)]!.name).toBe('Goblin 2');
		step(e, 1); // Goblin 1 is at 0 HP
		expect(e.combatants[currentIndex(e)]!.name).toBe('Aria');
		expect(e.round).toBe(3);
		step(e, -1);
		expect(e.combatants[currentIndex(e)]!.name).toBe('Goblin 2');
		expect(e.round).toBe(2);
	});
	it('does not skip down creatures when told not to', () => {
		const e = parseEncounter(src);
		step(e, 1, false);
		step(e, 1, false);
		step(e, 1, false);
		expect(e.combatants[currentIndex(e)]!.name).toBe('Goblin 1');
	});
	it('ends combat', () => {
		const e = parseEncounter(src);
		endCombat(e);
		expect(e.round).toBe(0);
		expect(currentIndex(e)).toBe(-1);
	});
	it('damages and heals within bounds', () => {
		const [c] = parseLine('Ogre hp 30/59');
		damage(c!, 40);
		expect(c!.hp).toBe(0);
		heal(c!, 100);
		expect(c!.hp).toBe(59);
	});
	it('adds mid-fight, numbers duplicates, rolls them in and keeps the turn', () => {
		const e = parseEncounter('round 1\n> Aria player init 12\nGoblin init 5');
		addCombatants(e, 'Goblin mod +1', seq(0.95)); // 20 + 1
		expect(e.combatants.map((c) => c.name)).toEqual(['Goblin 2', 'Aria', 'Goblin']);
		expect(e.combatants[1]!.current).toBe(true);
	});
});

describe('creature notes', () => {
	it('reads Fantasy Statblocks frontmatter', () => {
		expect(statsFromFrontmatter({ hp: 135, ac: 17, stats: [21, 9, 15, 18, 15, 18], hit_dice: '18d10 + 36' }))
			.toEqual({ hp: 135, ac: 17, mod: -1, hitDice: '18d10 + 36' });
		expect(statsFromFrontmatter({ hp: '7 (2d6)', ac: '15 (leather armor, shield)', stats: [8, 14] }))
			.toMatchObject({ hp: 7, ac: 15, mod: 2 });
		expect(statsFromFrontmatter({ initiative: 4, stats: [10, 10] }).mod).toBe(4);
		expect(statsFromFrontmatter(null)).toEqual({});
	});
	it('rolls hit dice', () => {
		expect(rollHitDice('2d6 + 3', seq(0.99))).toBe(15);
		expect(rollHitDice('3d8-3', seq(0))).toBe(1); // never below 1
		expect(rollHitDice('lots', seq(0))).toBeUndefined();
	});
});
