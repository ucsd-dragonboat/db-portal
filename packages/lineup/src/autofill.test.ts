import { describe, expect, it } from 'vitest';
import { autoFill } from './autofill';
import { emptyLineup, findPaddler, lineupPaddlerIds, placePaddler, sideWeights } from './lineup';
import type { Paddler, Roster } from './types';

/** Small deterministic PRNG (mulberry32). */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synthRoster(n: number, rng: () => number, gender: (i: number) => Paddler['gender']): Roster {
  const roster: Roster = {};
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    roster[id] = { id, name: `Paddler ${i}`, weight: Math.round(55 + rng() * 45), gender: gender(i) };
  }
  return roster;
}

describe('autoFill', () => {
  it('fills all 20 seats with the heaviest paddlers and balances within a few kg', () => {
    const rng = seeded(1);
    const roster = synthRoster(30, rng, (i) => (i % 2 ? 'male' : 'female'));
    const { lineup, unplaced } = autoFill(emptyLineup('open'), roster, { rng: seeded(2) });

    expect(lineup.seats.flat().every(Boolean)).toBe(true);
    expect(unplaced).toHaveLength(10);

    const seated = lineupPaddlerIds(lineup).map((id) => roster[id]!.weight);
    const minSeated = Math.min(...seated);
    for (const id of unplaced) expect(roster[id]!.weight).toBeLessThanOrEqual(minSeated);

    const { left, right, diff } = sideWeights(lineup, roster);
    expect(left).toBeGreaterThan(0);
    expect(right).toBeGreaterThan(0);
    expect(Math.abs(diff)).toBeLessThanOrEqual(10);
  });

  it('is deterministic for a given rng and leaves drummer/steer alone', () => {
    const roster = synthRoster(24, seeded(3), () => 'male');
    let start = emptyLineup('open');
    start = placePaddler(start, { kind: 'drummer' }, 'p0', roster).lineup;
    start = placePaddler(start, { kind: 'steer' }, 'p1', roster).lineup;
    const a = autoFill(start, roster, { rng: seeded(9) });
    const b = autoFill(start, roster, { rng: seeded(9) });
    expect(a).toEqual(b);
    expect(a.lineup.drummer).toBe('p0');
    expect(a.lineup.steer).toBe('p1');
    expect(findPaddler(a.lineup, 'p0')).toEqual({ kind: 'drummer' });
    expect(new Set(lineupPaddlerIds(a.lineup)).size).toBe(22);
  });

  it('seats nearest the middle first when there are not enough paddlers', () => {
    const roster = synthRoster(4, seeded(4), () => 'male');
    const { lineup } = autoFill(emptyLineup('open'), roster, { rng: seeded(5) });
    // rows 4 and 5 are the two nearest to 4.5 -> both should be full, all others empty
    expect(lineup.seats[4]!.every(Boolean)).toBe(true);
    expect(lineup.seats[5]!.every(Boolean)).toBe(true);
    expect(lineup.seats.filter((_, i) => i !== 4 && i !== 5).flat().every((s) => s === null)).toBe(true);
  });

  it('mixed: skips paddlers over the gender cap instead of leaving seats empty', () => {
    // 15 heavy men + 12 lighter women: naive heaviest-first would try 15 men.
    const roster: Roster = {};
    for (let i = 0; i < 15; i++) roster[`m${i}`] = { id: `m${i}`, name: `M${i}`, weight: 90 - i, gender: 'male' };
    for (let i = 0; i < 12; i++) roster[`f${i}`] = { id: `f${i}`, name: `F${i}`, weight: 65 - i, gender: 'female' };
    const { lineup } = autoFill(emptyLineup('mixed'), roster, { rng: seeded(6) });
    const ids = lineup.seats.flat().filter((x): x is string => x !== null);
    expect(ids).toHaveLength(20);
    expect(ids.filter((id) => roster[id]!.gender === 'male')).toHaveLength(10);
    expect(ids.filter((id) => roster[id]!.gender === 'female')).toHaveLength(10);
  });

  it('womens: only seats female paddlers', () => {
    const roster = synthRoster(30, seeded(7), (i) => (i < 12 ? 'male' : 'female'));
    const { lineup } = autoFill(emptyLineup('womens'), roster, { rng: seeded(8) });
    const ids = lineup.seats.flat().filter((x): x is string => x !== null);
    expect(ids).toHaveLength(18);
    expect(ids.every((id) => roster[id]!.gender === 'female')).toBe(true);
  });

  it('honors side preference when it stays within tolerance, otherwise uses the lighter side', () => {
    const base: Roster = {
      l: { id: 'l', name: 'L', weight: 70, gender: 'male' },
      r: { id: 'r', name: 'R', weight: 65, gender: 'male' },
      light: { id: 'light', name: 'Light', weight: 4, gender: 'male', sidePreference: 'left' },
      heavy: { id: 'heavy', name: 'Heavy', weight: 20, gender: 'male', sidePreference: 'left' },
      rightPref: { id: 'rightPref', name: 'RP', weight: 20, gender: 'male', sidePreference: 'right' },
    };
    let start = emptyLineup('open');
    start = placePaddler(start, { kind: 'seat', row: 4, side: 'left' }, 'l', base).lineup; // left 70
    start = placePaddler(start, { kind: 'seat', row: 4, side: 'right' }, 'r', base).lineup; // right 65

    const only = (id: string): Roster => ({ l: base.l!, r: base.r!, [id]: base[id]! });
    const side = (id: string) => {
      const seat = findPaddler(autoFill(start, only(id), { rng: seeded(10) }).lineup, id);
      return seat?.kind === 'seat' ? seat.side : null;
    };
    // left is heavier by 5; +4 on the left leaves diff 9 <= 10 -> preference honored
    expect(side('light')).toBe('left');
    // +20 on the left would leave diff 25 > 10 -> goes to the lighter (right) side
    expect(side('heavy')).toBe('right');
    // prefers the lighter side -> trivially honored
    expect(side('rightPref')).toBe('right');
  });

  it('overrides side preference when it would exceed the tolerance', () => {
    // Everyone prefers left; only 10 left seats -> half must go right, and the
    // heaviest ones should not all pile onto the left.
    const roster: Roster = {};
    for (let i = 0; i < 20; i++) {
      roster[`p${i}`] = { id: `p${i}`, name: `P${i}`, weight: 60 + i * 2, gender: 'male', sidePreference: 'left' };
    }
    const { lineup } = autoFill(emptyLineup('open'), roster, { rng: seeded(11), sidePreferenceTolerance: 5 });
    expect(lineup.seats.flat().every(Boolean)).toBe(true);
    expect(Math.abs(sideWeights(lineup, roster).diff)).toBeLessThanOrEqual(10);
  });

  describe('eligible (who is attending that day)', () => {
    it('only seats eligible paddlers, leaving the rest unplaced', () => {
      const roster = synthRoster(30, seeded(3), () => 'male');
      const eligible = new Set(['p0', 'p1', 'p2', 'p3', 'p4']);
      const { lineup, unplaced } = autoFill(emptyLineup('open'), roster, { rng: seeded(4), eligible });

      const seated = lineup.seats.flat().filter(Boolean) as string[];
      expect(seated).toHaveLength(5);
      expect(seated.every((id) => eligible.has(id))).toBe(true);
      expect(unplaced).toHaveLength(0); // nobody eligible was left over
    });

    it('never unseats someone already in the boat who is not eligible', () => {
      const roster = synthRoster(30, seeded(5), () => 'male');
      const seeded0 = placePaddler(emptyLineup('open'), { kind: 'seat', row: 0, side: 'left' }, 'p9', roster);
      const { lineup } = autoFill(seeded0.lineup, roster, {
        rng: seeded(6),
        eligible: new Set(['p0', 'p1', 'p2']),
      });

      expect(findPaddler(lineup, 'p9')).toEqual({ kind: 'seat', row: 0, side: 'left' });
      expect(lineupPaddlerIds(lineup).sort()).toEqual(['p0', 'p1', 'p2', 'p9']);
    });

    it('fills the whole roster when no eligible set is given', () => {
      const roster = synthRoster(30, seeded(7), () => 'male');
      const { lineup } = autoFill(emptyLineup('open'), roster, { rng: seeded(8) });
      expect(lineup.seats.flat().filter(Boolean)).toHaveLength(20);
    });
  });
});
