export type LatLon = { lat: number; lon: number }

export type Rider = {
  id: string
  name: string
  location: LatLon | null
}

export type Car = {
  id: string
  driverId: string
  /** Total seats including the driver. */
  capacity: number
  passengerIds: string[]
  locked?: boolean
}

export type Destination = LatLon & { label?: string }

export type Mode = 'pickup' | 'dropoff'

export type AssignOptions = {
  mode?: Mode
  /** km-equivalent cost added per distinct stop already on a car. */
  stopPenaltyKm?: number
  /** Try not to exceed this many distinct stops per car. */
  softStopCap?: number
  /** Never exceed this many distinct stops per car. */
  hardStopCap?: number
}

export type AssignResult = {
  cars: Car[]
  unassigned: string[]
}

/** One direction of the rides sheet: cars grouped by campus, plus self-transport. */
export type DirSet = {
  onCampus: Car[]
  offCampus: Car[]
  /** Rider ids who get themselves there (DIY). */
  diy: string[]
}

/** Which TOTAL-panel column a hand-typed guest was written into. */
export type GuestCol = 'drivers' | 'offCampus' | 'onCampus' | 'diy'

/** A name typed directly into the TOTAL panel — not a roster member, no location.
 * Ids are namespaced `x:<random>` so they can sit in passengerIds like anyone. */
export type CarpoolGuest = { id: string; name: string; col: GuestCol }

/** carpools.data, version 2 — the Sheets-style layout with separate directions.
 * Car ids are namespaced `g:<driverId>` / `b:<driverId>` so map layers stay unique. */
export type CarpoolDataV2 = {
  v: 2
  /** Editable black banner line at the top of the sheet. */
  header: string
  /** Form question shown in the yellow Name | Response panel. */
  funFactQuestionId: string | null
  /** Campus grouping keywords, matched case-insensitively against name + pickup. */
  collegeKeywords: string[]
  /** Hand-typed temporary people in the TOTAL panel. */
  guests: CarpoolGuest[]
  going: DirSet
  back: DirSet
}

/** The pre-sheet shape ({ cars, mode }) still stored on old rows. */
export type LegacyCarpoolData = { cars: Car[]; mode: Mode }

export const DEFAULT_CARPOOL_HEADER = 'LEAVE BY **:**AM, ISLAND BY **:**AM'
export const DEFAULT_COLLEGE_KEYWORDS = ['SEVENTH', 'MARSHALL', 'SIXTH', 'MUIR', 'REVELLE', 'EIGHTH', 'WARREN', 'TRANSFER']
