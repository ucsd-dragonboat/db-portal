import { describe, expect, it } from 'vitest';
import { isSuggestedName, seatDifferenceKeys, seatDifferences, suggestSetName } from './sets';
import { emptyLineup, placePaddler } from './lineup';
import type { Roster } from './types';

const roster: Roster = {
  a: { id: 'a', name: 'A', weight: 150, gender: 'male' },
  b: { id: 'b', name: 'B', weight: 160, gender: 'male' },
};

describe('suggestSetName', () => {
  it('spans the first and last day', () => {
    expect(suggestSetName('Week 8 Water Practice', ['10/4', '10/5'])).toBe('Week 8 Water Practice (10/4 - 10/5)');
  });

  it('uses a single date when only one day is chosen', () => {
    expect(suggestSetName('Week 8 Water Practice', ['10/4'])).toBe('Week 8 Water Practice (10/4)');
  });

  it('spans ends only, ignoring the middle', () => {
    expect(suggestSetName('Regatta', ['6/1', '6/2', '6/3'])).toBe('Regatta (6/1 - 6/3)');
  });

  it('falls back to the bare name with no days, and to the span with no name', () => {
    expect(suggestSetName('Week 8', [])).toBe('Week 8');
    expect(suggestSetName('', ['10/4', '10/5'])).toBe('10/4 - 10/5');
  });
});

describe('isSuggestedName', () => {
  it('recognizes a name this helper would have produced', () => {
    expect(isSuggestedName('Week 8 Water Practice (10/4 - 10/5)', 'Week 8 Water Practice')).toBe(true);
    expect(isSuggestedName('', 'Week 8 Water Practice')).toBe(true);
  });

  it('leaves a coach-written name alone', () => {
    expect(isSuggestedName('Sunday A boat experiment', 'Week 8 Water Practice')).toBe(false);
  });

  it('is not confused by regex characters in the event name', () => {
    expect(isSuggestedName('Week 8 (a+b) (10/4)', 'Week 8 (a+b)')).toBe(true);
  });
});

describe('seatDifferences', () => {
  it('is empty for identical days', () => {
    const l = placePaddler(emptyLineup('open'), { kind: 'seat', row: 0, side: 'left' }, 'a', roster).lineup;
    expect(seatDifferences(l, l)).toEqual([]);
  });

  it('reports the seats that changed, including drummer and steer', () => {
    const base = emptyLineup('open');
    const sat = placePaddler(base, { kind: 'seat', row: 2, side: 'right' }, 'a', roster).lineup;
    const sun = placePaddler({ ...base, drummer: 'b' }, { kind: 'seat', row: 2, side: 'right' }, 'b', roster).lineup;

    const keys = seatDifferenceKeys(sat, sun);
    expect(keys.has('drummer')).toBe(true);
    expect(keys.has('seat:2:right')).toBe(true);
    expect(keys.has('seat:0:left')).toBe(false);
  });
});
