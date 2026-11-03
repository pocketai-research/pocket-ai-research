import countries from './countries.json'
import type { BBox } from './geo'

export interface Country {
  /** ISO 3166-1 alpha-2 code. */
  iso: string
  name: string
  /** OpenStreetMap relation id of the national boundary. */
  id: number
  bbox: BBox
}

// Generated once from OpenStreetMap (admin_level=2 boundaries). Countries that cross the
// antimeridian or have far overseas areas use the box of their main territory.
export const COUNTRIES = countries as Country[]
