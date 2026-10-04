import { emptySeats, lineupPaddlerIds, placePaddler, sideWeights } from './lineup';
import { ROWS, type Lineup, type Paddler, type Roster, type Seat, type Side } from './types';

export interface AutoFillOptions {
  /** Random source in [0, 1). Defaults to Math.random. Used only to break weight ties. */
  rng?: () => number;
  /**
   * When a paddler prefers a side, they get it if that side is lighter, or if
   * putting them there leaves the boat within this much weight of balance. Default 10.
   */
  sidePreferenceTolerance?: number;
  /**
   * Restrict seating to these paddler ids — the people attending that day. Anyone
   * outside it is left alone (including anyone already seated: this only governs
   * who gets picked up, never who gets removed). Omitted = the whole roster.
   */
  eligible?: Set<string>;
}

export interface AutoFillResult {
  lineup: Lineup;
  /** Ids from the roster that were eligible but did not get a seat. */
  unplaced: string[];
}

/**
 * Greedy fill of the empty paddling seats (drummer/steer are never touched):
 *  1. Empty seats are ordered nearest-the-middle first (row 4.5), left before right.
 *  2. Candidates = roster paddlers not already in the boat, shuffled (rng) then
 *     sorted heaviest first. Unlike the original, ALL candidates are considered
 *     (no truncation before sorting), so the heaviest paddlers get seated and
 *     paddlers rejected by gender caps are skipped rather than leaving a seat empty.
 *  3. Each paddler goes to the lighter side (ties -> left). If they have a
 *     sidePreference of 'left'/'right' with an open seat there, they get it when
 *     it is the lighter side or when doing so keeps |left - right| within
 *     `sidePreferenceTolerance`.
 *  4. Womens boats only consider female paddlers; mixed caps are enforced by
 *     placePaddler and rejected paddlers are skipped.
 */
export function autoFill(lineup: Lineup, roster: Roster, opts: AutoFillOptions = {}): AutoFillResult {
  const rng = opts.rng ?? Math.random;
  const tolerance = opts.sidePreferenceTolerance ?? 10;
  const middle = (ROWS - 1) / 2;

  const seats = emptySeats(lineup)
    .filter((s): s is Extract<Seat, { kind: 'seat' }> => s.kind === 'seat')
    .sort((a, b) => Math.abs(a.row - middle) - Math.abs(b.row - middle));

  const inBoat = new Set(lineupPaddlerIds(lineup));
  const eligible = opts.eligible;
  const candidates = shuffle(
    Object.values(roster).filter(
      (p) =>
        !inBoat.has(p.id) &&
        (!eligible || eligible.has(p.id)) &&
        (lineup.boatType !== 'womens' || p.gender === 'female'),
    ),
    rng,
  ).sort((a, b) => b.weight - a.weight);

  let current = lineup;
  const unplaced: string[] = [];

  for (const paddler of candidates) {
    if (seats.length === 0) {
      unplaced.push(paddler.id);
      continue;
    }
    const side = chooseSide(current, roster, paddler, seats, tolerance);
    const idx = seats.findIndex((s) => s.side === side);
    const seat = seats[idx]!;
    const result = placePaddler(current, seat, paddler.id, roster);
    if (result.error) {
      unplaced.push(paddler.id);
      continue;
    }
    current = result.lineup;
    seats.splice(idx, 1);
  }

  return { lineup: current, unplaced };
}

function chooseSide(
  lineup: Lineup,
  roster: Roster,
  paddler: Paddler,
  seats: Extract<Seat, { kind: 'seat' }>[],
  tolerance: number,
): Side {
  const open = (side: Side) => seats.some((s) => s.side === side);
  const { left, right } = sideWeights(lineup, roster);
  const lighter: Side = left <= right ? 'left' : 'right';
  const pref = paddler.sidePreference;

  if ((pref === 'left' || pref === 'right') && open(pref)) {
    if (pref === lighter) return pref;
    const after = pref === 'left' ? left + paddler.weight - right : right + paddler.weight - left;
    if (after <= tolerance) return pref;
  }
  if (open(lighter)) return lighter;
  return lighter === 'left' ? 'right' : 'left';
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
