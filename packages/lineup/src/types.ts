export type Gender = 'male' | 'female' | 'other' | null;
export type Side = 'left' | 'right';
export type BoatType = 'open' | 'womens' | 'mixed';

export interface Paddler {
  id: string;
  name: string;
  /** Weight, in whatever unit the caller uses throughout — the portal feeds pounds. */
  weight: number;
  gender: Gender;
  sidePreference?: Side | 'either' | null;
  canSteer?: boolean;
  canDrum?: boolean;
}

/** Roster keyed by paddler id. Plain object so it round-trips through JSON. */
export type Roster = Record<string, Paddler>;

export const ROWS = 10;

/**
 * A boat lineup. `seats` is ROWS x [left, right] of paddler ids (or null).
 * Rows are 0-indexed (0 = front / behind the drummer, 9 = back / in front of steer).
 */
export interface Lineup {
  boatType: BoatType;
  drummer: string | null;
  steer: string | null;
  seats: (string | null)[][];
}

export type Seat =
  | { kind: 'drummer' }
  | { kind: 'steer' }
  | { kind: 'seat'; row: number; side: Side };

export interface LineupResult {
  lineup: Lineup;
  error?: string;
}
