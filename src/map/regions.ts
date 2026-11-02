import regions from './regions.json'

export interface MapRegion {
  id: string
  name: string
  /** [west, south, east, north] in degrees. */
  bbox: [number, number, number, number]
  maxzoom: number
}

// Shared with .github/workflows/map-data.yml, which cuts one map pack per region.
export const REGIONS = regions as MapRegion[]
