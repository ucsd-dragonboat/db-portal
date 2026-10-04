// A "set" is everything one builder session produces: the same boats, filed to
// one or more days of an event. Each (boat, day) is stored as its own lineup row
// — these helpers are the pure bits the UI needs to name a set and to compare
// one day against another.

import { allSeats, getSeat, seatKey } from './lineup';
import type { Lineup, Seat } from './types';

/**
 * The name suggested when a lineup is filed, e.g.
 *   suggestSetName('Week 8 Water Practice', ['10/4', '10/5'])
 *     -> 'Week 8 Water Practice (10/4 - 10/5)'
 * Day labels are pre-formatted by the caller so this stays timezone-free; only
 * the first and last matter, so they must already be in day order.
 */
export function suggestSetName(groupName: string, dayLabels: string[]): string {
  const name = groupName.trim();
  const days = dayLabels.map((d) => d.trim()).filter(Boolean);
  if (!days.length) return name;
  const span = days.length === 1 ? days[0] : `${days[0]} - ${days[days.length - 1]}`;
  return name ? `${name} (${span})` : span;
}

/** True when a stored name still looks auto-generated, so re-filing may re-suggest. */
export function isSuggestedName(name: string, groupName: string): boolean {
  const n = name.trim();
  if (!n) return true;
  return new RegExp(`^${escapeRegExp(groupName.trim())}\\s*\\([^)]*\\)$`).test(n);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Seats whose occupant differs between two days of the same boat — what "show
 * row differences" highlights. Drummer and steer are included.
 */
export function seatDifferences(a: Lineup, b: Lineup): Seat[] {
  const seats: Seat[] = [{ kind: 'drummer' }, { kind: 'steer' }, ...allSeats()];
  return seats.filter((s) => getSeat(a, s) !== getSeat(b, s));
}

/** seatKey set of `seatDifferences`, for cheap lookups while rendering. */
export function seatDifferenceKeys(a: Lineup, b: Lineup): Set<string> {
  return new Set(seatDifferences(a, b).map(seatKey));
}
