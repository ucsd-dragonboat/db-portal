import { describe, expect, it } from 'vitest'
import { decodePolyline, MATRIX_PROVIDERS, ROUTE_PROVIDERS } from './providers'

const A = { lat: 32.8, lon: -117.2 }
const B = { lat: 32.9, lon: -117.1 }
const route = (id: string) => ROUTE_PROVIDERS.find((p) => p.id === id)!
const matrix = (id: string) => MATRIX_PROVIDERS.find((p) => p.id === id)!

describe('decodePolyline', () => {
  it('decodes the reference precision-5 example to [lon, lat]', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5)).toEqual([[-120.2, 38.5], [-120.95, 40.7], [-126.453, 43.252]])
  })
  it('decodes a real Valhalla precision-6 shape', () => {
    const [[lon, lat]] = decodePolyline('_o}p}@f|ip~E', 6)
    expect(lat).toBeCloseTo(32.8, 3)
    expect(lon).toBeCloseTo(-117.2, 3)
  })
})

describe('provider order', () => {
  it('tries the keyless public servers first', () => {
    expect(ROUTE_PROVIDERS.slice(0, 3).map((p) => [p.id, p.needsKey])).toEqual([['osrm', undefined], ['fossgis-osrm', undefined], ['fossgis-valhalla', undefined]])
    expect(MATRIX_PROVIDERS.slice(0, 3).every((p) => !p.needsKey)).toBe(true)
  })
  it('leaves out matrices that the free plans cannot afford', () => {
    expect(MATRIX_PROVIDERS.map((p) => p.id)).not.toContain('tomtom')
    expect(MATRIX_PROVIDERS.map((p) => p.id)).not.toContain('graphhopper')
    expect(route('graphhopper').maxPoints).toBe(5)
  })
})

describe('requests', () => {
  it('FOSSGIS OSRM mirror uses the OSRM URL shape on its own host', () => {
    expect(route('fossgis-osrm').request([A, B]).url).toBe('https://routing.openstreetmap.de/routed-car/route/v1/driving/-117.2,32.8;-117.1,32.9?overview=full&geometries=geojson')
    expect(matrix('fossgis-osrm').request([A, B]).url).toBe('https://routing.openstreetmap.de/routed-car/table/v1/driving/-117.2,32.8;-117.1,32.9?annotations=duration,distance')
  })
  it('Valhalla posts lat/lon objects in kilometres', () => {
    const r = route('fossgis-valhalla').request([A, B])
    expect(r.method).toBe('POST')
    expect(JSON.parse(r.body!)).toEqual({ locations: [A, B], costing: 'auto', units: 'kilometers' })
  })
  it('ORS sends [lon, lat] and the key as a header', () => {
    const r = route('ors').request([A, B], 'K')
    expect(r.headers?.Authorization).toBe('K')
    expect(JSON.parse(r.body!).coordinates).toEqual([[-117.2, 32.8], [-117.1, 32.9]])
    expect(r.url).not.toContain('K')
  })
  it('LocationIQ and Mapbox put the key in the query string', () => {
    expect(route('locationiq').request([A, B], 'K').url).toBe('https://us1.locationiq.com/v1/directions/driving/-117.2,32.8;-117.1,32.9?overview=full&geometries=geojson&key=K')
    expect(matrix('mapbox').request([A, B], 'K').url).toBe('https://api.mapbox.com/directions-matrix/v1/mapbox/driving/-117.2,32.8;-117.1,32.9?annotations=duration,distance&access_token=K')
  })
  it('Geoapify, TomTom and GraphHopper take lat,lon order', () => {
    expect(route('geoapify').request([A, B], 'K').url).toBe('https://api.geoapify.com/v1/routing?mode=drive&waypoints=32.8,-117.2|32.9,-117.1&apiKey=K')
    expect(route('tomtom').request([A, B], 'K').url).toBe('https://api.tomtom.com/routing/1/calculateRoute/32.8,-117.2:32.9,-117.1/json?travelMode=car&key=K')
    expect(route('graphhopper').request([A, B], 'K').url).toBe('https://graphhopper.com/api/1/route?profile=car&points_encoded=false&point=32.8,-117.2&point=32.9,-117.1&key=K')
  })
  it('Geoapify matrix posts [lon, lat] locations', () => {
    expect(JSON.parse(matrix('geoapify').request([A, B], 'K').body!).sources).toEqual([{ location: [-117.2, 32.8] }, { location: [-117.1, 32.9] }])
  })
})

// Every route parser normalises to km, minutes and a [lon, lat] LineString.
const want = { distanceKm: 22.26, durationMin: 23.8, geometry: { type: 'LineString', coordinates: [[-117.2, 32.8], [-117.1, 32.9]] } }

describe('route parsers', () => {
  it('Valhalla (km, seconds, encoded shape per leg)', () => {
    const r = route('fossgis-valhalla').parse({ trip: { summary: { length: 22.26, time: 1428 }, legs: [{ shape: '_o}p}@f|ip~E' }] } })
    expect(r?.distanceKm).toBe(22.26)
    expect(r?.durationMin).toBeCloseTo(23.8)
    expect(r?.geometry.coordinates).toHaveLength(1)
  })
  it('ORS (metres, seconds, GeoJSON feature)', () => {
    expect(route('ors').parse({ features: [{ geometry: want.geometry, properties: { summary: { distance: 22260, duration: 1428 } } }] })).toEqual(want)
  })
  it('Geoapify (metres, seconds, MultiLineString flattened)', () => {
    expect(route('geoapify').parse({ features: [{ geometry: { type: 'MultiLineString', coordinates: [[[-117.2, 32.8]], [[-117.1, 32.9]]] }, properties: { distance: 22260, time: 1428 } }] })).toEqual(want)
  })
  it('TomTom (metres, seconds, latitude/longitude points per leg)', () => {
    expect(route('tomtom').parse({ routes: [{ summary: { lengthInMeters: 22260, travelTimeInSeconds: 1428 }, legs: [{ points: [{ latitude: 32.8, longitude: -117.2 }, { latitude: 32.9, longitude: -117.1 }] }] }] })).toEqual(want)
  })
  it('GraphHopper (metres, milliseconds)', () => {
    expect(route('graphhopper').parse({ paths: [{ distance: 22260, time: 1428000, points: want.geometry }] })).toEqual(want)
  })
  it('returns null for an error body instead of throwing', () => {
    for (const p of ROUTE_PROVIDERS) {
      expect(p.parse({ error: 'rate limited' })).toBeNull()
      expect(p.parse(null)).toBeNull()
    }
  })
})

describe('matrix parsers', () => {
  const pts = [A, B]
  it('Valhalla (km, seconds)', () => {
    const cell = (time: number, distance: number) => ({ time, distance })
    const m = matrix('fossgis-valhalla').parse(pts, { sources_to_targets: [[cell(0, 0), cell(1428, 22.26)], [cell(1480, 24.1), cell(0, 0)]] })
    expect(m?.durationMin[0][1]).toBeCloseTo(23.8)
    expect(m?.distanceKm[1][0]).toBe(24.1)
    expect(m?.index.get('32.900,-117.100')).toBe(1)
  })
  it('ORS (metres, seconds), unreachable pairs become null', () => {
    const m = matrix('ors').parse(pts, { durations: [[0, 1428], [null, 0]], distances: [[0, 22260], [null, 0]] })
    expect(m?.distanceKm[0][1]).toBe(22.26)
    expect(m?.durationMin[1][0]).toBeNull()
  })
  it('Geoapify (metres, seconds)', () => {
    const cell = (time: number, distance: number) => ({ time, distance })
    const m = matrix('geoapify').parse(pts, { sources_to_targets: [[cell(0, 0), cell(1428, 22260)], [cell(1480, 24100), cell(0, 0)]] })
    expect(m?.distanceKm[0][1]).toBe(22.26)
  })
  it('rejects a matrix of the wrong size', () => {
    expect(matrix('ors').parse(pts, { durations: [[0]], distances: [[0]] })).toBeNull()
    expect(matrix('fossgis-valhalla').parse(pts, { sources_to_targets: [] })).toBeNull()
  })
})
