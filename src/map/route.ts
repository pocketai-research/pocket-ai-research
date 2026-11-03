import { VectorTile } from '@mapbox/vector-tile'
import { PbfReader } from 'pbf'
import { countTiles, tileRange, type BBox } from './geo'

/**
 * Directions on the device, from the roads in the map's vector tiles (OpenMapTiles
 * "transportation" layer, street names from "transportation_name"). The tiles are made for
 * drawing, not routing: junction vertices on straight roads are simplified away and roads are
 * cut at tile edges, so the network is stitched back together before searching it with A*.
 * Turn restrictions, traffic and most access rules are not in the tiles, so routes are a guide.
 */

export type TravelMode = 'walk' | 'drive'

/** Reads one vector tile, from an offline area or from OpenFreeMap; undefined when it is missing. */
export type TileSource = (z: number, x: number, y: number) => Promise<ArrayBuffer | undefined>

export interface RouteStep {
  /** e.g. "Turn left onto Jalan Malioboro". */
  text: string
  /** Metres to travel after the instruction. */
  distance: number
}

export interface Route {
  mode: TravelMode
  /** [lon, lat] points from the start to the destination. */
  line: [number, number][]
  /** Metres along the roads. */
  distance: number
  /** Seconds, from typical speeds for each kind of road. */
  duration: number
  steps: RouteStep[]
  /** The map data held only bigger roads (a lower zoom level), so the route is rougher. */
  mainRoadsOnly: boolean
}

export class RouteError extends Error {}

/**
 * Per OpenMapTiles road class: typical car or motorbike speed in km/h in town (well below speed
 * limits, for traffic and junctions), whether walking is allowed, and a name for unnamed ones.
 */
const ROADS: Record<string, { drive?: number; walk?: boolean; label: string }> = {
  motorway: { drive: 80, label: 'the motorway' },
  trunk: { drive: 50, walk: true, label: 'a main road' },
  primary: { drive: 35, walk: true, label: 'a main road' },
  secondary: { drive: 30, walk: true, label: 'a main road' },
  tertiary: { drive: 25, walk: true, label: 'a road' },
  minor: { drive: 20, walk: true, label: 'a side street' },
  service: { drive: 10, walk: true, label: 'a service road' },
  track: { drive: 10, walk: true, label: 'a track' },
  path: { walk: true, label: 'a path' },
}
const WALK_KMH = 4.5
const FASTEST_KMH = 80

/**
 * Deepest zoom first. Lower zooms cover more ground per tile but hold only bigger roads, so the
 * start and destination may be farther from a road.
 */
const LEVELS = [
  { zoom: 14, snapMetres: 400 },
  { zoom: 13, snapMetres: 1000 },
  { zoom: 12, snapMetres: 2500 },
]
/** Tiles read for one route; also bounds the memory and time used to build the network. */
const MAX_TILES = 150
const PARALLEL_READS = 6
/** A road end this close to another road (in tile units, about 2 m at zoom 14) joins it. */
const JOIN_UNITS = 3
const CELL_UNITS = 64

interface Road {
  cls: string
  oneway: number
  /** "bridge", "tunnel" or "ford"; roads crossing a bridge or tunnel are not joined to it. */
  brunnel: string
  layer: number
  name?: string
}

interface Segment {
  a: number
  b: number
  road: number
  /** Junctions found along the segment: position (0–1) and node. */
  splits: { t: number; node: number }[]
}

function allowed(props: Record<string, unknown>, mode: TravelMode) {
  const kind = ROADS[String(props.class)]
  if (!kind || (mode === 'drive' ? !kind.drive : !kind.walk)) return false
  const foot = String(props.foot ?? '')
  if (mode === 'walk' && foot === 'no') return false
  const access = String(props.access ?? '')
  const closed = access === 'no' || access === 'private'
  return !closed || (mode === 'walk' && (foot === 'yes' || foot === 'designated'))
}

/** Nearest point on segment a–b to p, as position t (0–1) and squared distance. */
function project(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0
  const qx = ax + t * dx - px
  const qy = ay + t * dy - py
  return { t, d2: qx * qx + qy * qy }
}

/** Where segments p1–p2 and p3–p4 cross strictly inside both, as positions along each. */
function crossing(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
  const den = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3)
  if (!den) return null
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / den
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / den
  return t > 0 && t < 1 && u > 0 && u < 1 ? { t, u } : null
}

/** Spatial index of segments over a grid, for finding the ones near a point. */
class Grid {
  private cells = new Map<string, number[]>()
  constructor(private cell: number) {}

  add(id: number, ax: number, ay: number, bx: number, by: number) {
    const c = this.cell
    for (let cx = Math.floor(Math.min(ax, bx) / c); cx <= Math.floor(Math.max(ax, bx) / c); cx++) {
      for (let cy = Math.floor(Math.min(ay, by) / c); cy <= Math.floor(Math.max(ay, by) / c); cy++) {
        const key = `${cx},${cy}`
        const list = this.cells.get(key)
        if (list) list.push(id)
        else this.cells.set(key, [id])
      }
    }
  }

  /** Ids in cells within radius of the point (may repeat). */
  near(x: number, y: number, radius: number) {
    const c = this.cell
    const found: number[] = []
    for (let cx = Math.floor((x - radius) / c); cx <= Math.floor((x + radius) / c); cx++) {
      for (let cy = Math.floor((y - radius) / c); cy <= Math.floor((y + radius) / c); cy++) {
        const list = this.cells.get(`${cx},${cy}`)
        if (list) for (const id of list) found.push(id)
      }
    }
    return found
  }

  lists() {
    return this.cells.values()
  }
}

interface LoadedTile {
  x: number
  y: number
  tile: VectorTile
}

/** The road network of the tiles, in global tile units (tile x × extent + x within the tile). */
function buildNetwork(tiles: LoadedTile[], mode: TravelMode) {
  const xs: number[] = []
  const ys: number[] = []
  const ids = new Map<string, number>()
  const roads: Road[] = []
  const segments: Segment[] = []
  const seen = new Set<string>()
  let extent = 4096

  // Neighbouring tiles repeat the roads near their shared edge with identical global
  // coordinates, so equal points become one node and repeated segments are skipped.
  for (const { x: tx, y: ty, tile } of tiles) {
    const layer = tile.layers.transportation
    if (!layer) continue
    extent = layer.extent
    for (let i = 0; i < layer.length; i++) {
      const feature = layer.feature(i)
      const props = feature.properties
      if (feature.type !== 2 || !allowed(props, mode)) continue
      const road =
        roads.push({
          cls: String(props.class),
          oneway: Number(props.oneway ?? 0),
          brunnel: String(props.brunnel ?? ''),
          layer: Number(props.layer ?? 0),
        }) - 1
      for (const part of feature.loadGeometry()) {
        let prev = -1
        for (const point of part) {
          const gx = tx * layer.extent + point.x
          const gy = ty * layer.extent + point.y
          const key = `${gx},${gy}`
          let node = ids.get(key)
          if (node === undefined) {
            node = xs.push(gx) - 1
            ys.push(gy)
            ids.set(key, node)
          }
          if (prev >= 0 && prev !== node) {
            const pair = prev < node ? `${prev}|${node}` : `${node}|${prev}`
            if (!seen.has(pair)) {
              seen.add(pair)
              segments.push({ a: prev, b: node, road, splits: [] })
            }
          }
          prev = node
        }
      }
    }
  }

  // Street names: name lines share their vertices with the road lines.
  const names = new Map<number, string[]>()
  for (const { x: tx, y: ty, tile } of tiles) {
    const layer = tile.layers.transportation_name
    for (let i = 0; layer && i < layer.length; i++) {
      const feature = layer.feature(i)
      const name = feature.properties.name
      if (typeof name !== 'string' || !name) continue
      for (const part of feature.loadGeometry()) {
        for (const point of part) {
          const node = ids.get(`${tx * layer.extent + point.x},${ty * layer.extent + point.y}`)
          if (node === undefined) continue
          const list = names.get(node)
          if (!list) names.set(node, [name])
          else if (!list.includes(name)) list.push(name)
        }
      }
    }
  }
  const segmentName = (s: Segment) => {
    const atB = names.get(s.b)
    return names.get(s.a)?.find((name) => atB?.includes(name))
  }

  const grid = new Grid(CELL_UNITS)
  const degree = new Uint32Array(xs.length)
  segments.forEach((s, i) => {
    grid.add(i, xs[s.a], ys[s.a], xs[s.b], ys[s.b])
    degree[s.a]++
    degree[s.b]++
  })

  // Road ends that touch the side of another road: the junction vertex was simplified away.
  for (let node = 0; node < degree.length; node++) {
    if (degree[node] !== 1) continue
    let best: { segment: number; t: number; d2: number } | null = null
    for (const id of grid.near(xs[node], ys[node], JOIN_UNITS)) {
      const s = segments[id]
      if (s.a === node || s.b === node) continue
      const { t, d2 } = project(xs[node], ys[node], xs[s.a], ys[s.a], xs[s.b], ys[s.b])
      if (d2 <= JOIN_UNITS * JOIN_UNITS && (!best || d2 < best.d2)) best = { segment: id, t, d2 }
    }
    if (best) segments[best.segment].splits.push({ t: best.t, node })
  }

  // Roads that cross with no shared vertex, unless one is a bridge or tunnel or they are on different levels.
  const crossed = new Set<string>()
  for (const list of grid.lists()) {
    for (let i = 0; i < list.length; i++) {
      const s = segments[list[i]]
      const rs = roads[s.road]
      if (rs.brunnel) continue
      for (let j = i + 1; j < list.length; j++) {
        const u = segments[list[j]]
        const ru = roads[u.road]
        if (ru.brunnel || ru.layer !== rs.layer) continue
        if (s.a === u.a || s.a === u.b || s.b === u.a || s.b === u.b) continue
        const hit = crossing(xs[s.a], ys[s.a], xs[s.b], ys[s.b], xs[u.a], ys[u.a], xs[u.b], ys[u.b])
        if (!hit) continue
        const pair = list[i] < list[j] ? `${list[i]}|${list[j]}` : `${list[j]}|${list[i]}`
        if (crossed.has(pair)) continue
        crossed.add(pair)
        const node = xs.push(xs[s.a] + hit.t * (xs[s.b] - xs[s.a])) - 1
        ys.push(ys[s.a] + hit.t * (ys[s.b] - ys[s.a]))
        s.splits.push({ t: hit.t, node })
        u.splits.push({ t: hit.u, node })
      }
    }
  }

  // Final edges: each segment cut at its junctions, in the direction the line was drawn
  // (which is the allowed direction of a one-way road with oneway = 1).
  const edgeA: number[] = []
  const edgeB: number[] = []
  const edgeRoad: number[] = []
  // Named per segment: tiles merge streets with the same properties into one feature.
  const named = new Map<string, number>()
  for (const s of segments) {
    const name = segmentName(s)
    let road = s.road
    if (name) {
      const key = `${s.road}|${name}`
      road = named.get(key) ?? roads.push({ ...roads[s.road], name }) - 1
      named.set(key, road)
    }
    const points = [s.a, ...s.splits.sort((p, q) => p.t - q.t).map((p) => p.node), s.b]
    for (let k = 1; k < points.length; k++) {
      if (points[k - 1] === points[k]) continue
      edgeA.push(points[k - 1])
      edgeB.push(points[k])
      edgeRoad.push(road)
    }
  }

  return { xs, ys, extent, roads, edgeA, edgeB, edgeRoad }
}

type Network = ReturnType<typeof buildNetwork>

const RAD = Math.PI / 180

/** Metres between two [lon, lat] points; flat-earth approximation, fine for a city. */
function metres([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD) * 111_320
  const y = (lat2 - lat1) * 110_574
  return Math.hypot(x, y)
}

/** Compass bearing in degrees from a to b. */
function bearing([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]) {
  const x = (lon2 - lon1) * Math.cos(((lat1 + lat2) / 2) * RAD)
  const y = lat2 - lat1
  return (Math.atan2(x, y) / RAD + 360) % 360
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']

/** Box around both points with room for roads that bend away from the straight line. */
function routeBox([lon1, lat1]: [number, number], [lon2, lat2]: [number, number]): BBox {
  const perLon = 111_320 * Math.cos(((lat1 + lat2) / 2) * RAD)
  const perLat = 110_574
  const span = Math.max(Math.abs(lon2 - lon1) * perLon, Math.abs(lat2 - lat1) * perLat)
  const margin = Math.max(span * 0.2, 800)
  return [
    Math.min(lon1, lon2) - margin / perLon,
    Math.min(lat1, lat2) - margin / perLat,
    Math.max(lon1, lon2) + margin / perLon,
    Math.max(lat1, lat2) + margin / perLat,
  ]
}

/** Binary min-heap of node ids by priority. */
class Heap {
  private ids: number[] = []
  private keys: number[] = []

  get size() {
    return this.ids.length
  }

  push(id: number, key: number) {
    const { ids, keys } = this
    let i = ids.push(id) - 1
    keys.push(key)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (keys[parent] <= key) break
      ids[i] = ids[parent]
      keys[i] = keys[parent]
      i = parent
    }
    ids[i] = id
    keys[i] = key
  }

  pop() {
    const { ids, keys } = this
    const top = ids[0]
    const lastId = ids.pop()!
    const lastKey = keys.pop()!
    if (ids.length) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= ids.length) break
        if (child + 1 < ids.length && keys[child + 1] < keys[child]) child++
        if (keys[child] >= lastKey) break
        ids[i] = ids[child]
        keys[i] = keys[child]
        i = child
      }
      ids[i] = lastId
      keys[i] = lastKey
    }
    return top
  }
}

type PathPoint = { point: [number, number]; edge: number; node: number }

/** A point snapped onto an edge: the edge, the position along it (0–1), and the distance in metres. */
interface Snap {
  edge: number
  t: number
  point: [number, number]
  distance: number
}

/** Searches the network from one snapped point to another. */
function search(net: Network, mode: TravelMode, coords: [number, number][], from: Snap, to: Snap) {
  const { edgeA, edgeB, edgeRoad, roads } = net
  const nodes = coords.length
  const start = nodes
  const goal = nodes + 1
  const speed = (edge: number) => ((mode === 'walk' ? WALK_KMH : ROADS[roads[edgeRoad[edge]].cls].drive!) * 1000) / 3600
  const oneway = (edge: number) => (mode === 'drive' ? roads[edgeRoad[edge]].oneway : 0)
  const length = (edge: number) => metres(coords[edgeA[edge]], coords[edgeB[edge]])

  // Outgoing edges per node; even codes go a → b, odd codes b → a.
  const out: number[][] = Array.from({ length: nodes }, () => [])
  for (let e = 0; e < edgeA.length; e++) {
    const dir = oneway(e)
    if (dir !== -1) out[edgeA[e]].push(2 * e)
    if (dir !== 1) out[edgeB[e]].push(2 * e + 1)
  }

  // Links to and from the snapped points: [to node, metres, edge].
  const fromLinks: [number, number, number][] = []
  const fromLength = length(from.edge)
  if (oneway(from.edge) !== -1) fromLinks.push([edgeB[from.edge], (1 - from.t) * fromLength, from.edge])
  if (oneway(from.edge) !== 1) fromLinks.push([edgeA[from.edge], from.t * fromLength, from.edge])
  const toLinks = new Map<number, [number, number, number]>()
  const toLength = length(to.edge)
  if (oneway(to.edge) !== -1) toLinks.set(edgeA[to.edge], [goal, to.t * toLength, to.edge])
  if (oneway(to.edge) !== 1) toLinks.set(edgeB[to.edge], [goal, (1 - to.t) * toLength, to.edge])
  if (from.edge === to.edge) {
    const forward = to.t >= from.t
    if (oneway(from.edge) !== (forward ? -1 : 1)) fromLinks.push([goal, Math.abs(to.t - from.t) * fromLength, from.edge])
  }

  const fastest = ((mode === 'walk' ? WALK_KMH : FASTEST_KMH) * 1000) / 3600
  const estimate = (node: number) => metres(node === start ? from.point : coords[node], to.point) / fastest
  const cost = new Float64Array(nodes + 2).fill(Infinity)
  const prev = new Int32Array(nodes + 2).fill(-1)
  const via = new Int32Array(nodes + 2).fill(-1)
  const dist = new Float64Array(nodes + 2)
  const heap = new Heap()
  cost[start] = 0
  heap.push(start, estimate(start))

  const relax = (node: number, next: number, m: number, edge: number) => {
    const c = cost[node] + m / speed(edge)
    if (c >= cost[next]) return
    cost[next] = c
    prev[next] = node
    via[next] = edge
    dist[next] = dist[node] + m
    heap.push(next, c + (next === goal ? 0 : estimate(next)))
  }

  const done = new Uint8Array(nodes + 2)
  while (heap.size) {
    const node = heap.pop()
    if (done[node]) continue
    done[node] = 1
    if (node === goal) break
    if (node === start) {
      for (const [next, m, edge] of fromLinks) relax(node, next, m, edge)
      continue
    }
    for (const code of out[node]) {
      const edge = code >> 1
      const next = code & 1 ? edgeA[edge] : edgeB[edge]
      relax(node, next, length(edge), edge)
    }
    const link = toLinks.get(node)
    if (link) relax(node, link[0], link[1], link[2])
  }
  if (prev[goal] < 0) return null

  // Walk back from the goal: points, and the edge used to reach each.
  const path: PathPoint[] = []
  for (let node = goal; node >= 0; node = prev[node]) {
    path.push({ point: node === goal ? to.point : node === start ? from.point : coords[node], edge: via[node], node })
  }
  path.reverse()
  return { path, distance: dist[goal], duration: cost[goal] }
}

/** Snaps a point to the nearest edges within the radius, nearest first. */
function snapCandidates(net: Network, grid: Grid, coords: [number, number][], point: [number, number], world: number, radiusMetres: number) {
  const unitsPerMetre = world / (40_075_017 * Math.cos(point[1] * RAD))
  const px = ((point[0] + 180) / 360) * world
  const py = ((1 - Math.log(Math.tan(point[1] * RAD) + 1 / Math.cos(point[1] * RAD)) / Math.PI) / 2) * world
  const seen = new Set<number>()
  const found: Snap[] = []
  for (const edge of grid.near(px, py, radiusMetres * unitsPerMetre)) {
    if (seen.has(edge)) continue
    seen.add(edge)
    const a = net.edgeA[edge]
    const b = net.edgeB[edge]
    const { t } = project(px, py, net.xs[a], net.ys[a], net.xs[b], net.ys[b])
    const [lonA, latA] = coords[a]
    const [lonB, latB] = coords[b]
    const snapped: [number, number] = [lonA + t * (lonB - lonA), latA + t * (latB - latA)]
    const distance = metres(point, snapped)
    if (distance <= radiusMetres) found.push({ edge, t, point: snapped, distance })
  }
  return found.sort((p, q) => p.distance - q.distance)
}

/** Groups of nodes connected by edges (ignoring one-way rules), as a find function. */
function components(nodes: number, edgeA: number[], edgeB: number[]) {
  const parent = Int32Array.from({ length: nodes }, (_, i) => i)
  const find = (n: number): number => {
    while (parent[n] !== n) {
      parent[n] = parent[parent[n]]
      n = parent[n]
    }
    return n
  }
  for (let e = 0; e < edgeA.length; e++) parent[find(edgeA[e])] = find(edgeB[e])
  return find
}

function turnWords(change: number) {
  const angle = Math.abs(change)
  const side = change > 0 ? 'right' : 'left'
  if (angle < 25) return 'Continue'
  if (angle < 60) return `Bear ${side}`
  if (angle < 150) return `Turn ${side}`
  return 'Make a U-turn'
}

/** Turn-by-turn steps: a new step where the street changes, or at a real turn at a junction. */
function describe(net: Network, path: PathPoint[], junctions: Uint8Array, destination: string): RouteStep[] {
  const roadOf = (edge: number) => net.roads[net.edgeRoad[edge]]
  const legLength = (k: number) => metres(path[k - 1].point, path[k].point)

  // Bearing over about 20 m before or after point k, so tiny kinks do not count as turns.
  const pointBack = (k: number) => {
    let i = k
    for (let m = 0; i > 0 && m < 20; i--) m += legLength(i)
    return path[i].point
  }
  const pointAhead = (k: number) => {
    let i = k
    for (let m = 0; i < path.length - 1 && m < 20; i++) m += legLength(i + 1)
    return path[i].point
  }

  // Legs path[k - 1] → path[k]. An unnamed piece that carries straight on from a named street of
  // the same kind is taken as part of it (the street's name is missing at some junctions).
  interface Step {
    street: string
    cls: string
    named: boolean
    change: number
    distance: number
  }
  const steps: Step[] = []
  for (let k = 1; k < path.length; k++) {
    const road = roadOf(path[k].edge)
    const leg = legLength(k)
    if (k === 1) {
      steps.push({ street: road.name ?? `#${road.cls}`, cls: road.cls, named: !!road.name, change: 0, distance: leg })
      continue
    }
    const at = k - 1
    const change = ((bearing(path[at].point, pointAhead(at)) - bearing(pointBack(at), path[at].point) + 540) % 360) - 180
    const last = steps[steps.length - 1]
    const turn = junctions[path[at].node] === 1 && Math.abs(change) >= 60
    const street = road.name ?? (last.named && last.cls === road.cls && !turn ? last.street : `#${road.cls}`)
    if (street === last.street && !turn) {
      last.distance += leg
    } else {
      steps.push({ street, cls: road.cls, named: street === road.name || (last.named && street === last.street), change, distance: leg })
    }
  }

  // A step of a few metres is a jog between two roads, not an instruction worth reading; once it
  // is gone, the steps on either side may be the same street. Going straight on from one unnamed
  // main road to another reads as one step too.
  const label = (step: Step) => (step.named ? step.street : ROADS[step.cls].label)
  const kept: Step[] = []
  for (const step of steps) {
    const last = kept[kept.length - 1]
    const sameStreet = last && (step.street === last.street || (!step.named && label(step) === label(last)))
    if (last && (step.distance < 15 || (sameStreet && Math.abs(step.change) < 60))) {
      last.distance += step.distance
    } else {
      kept.push(step)
    }
  }

  const result = kept.map((step, i): RouteStep => {
    if (i > 0) return { text: `${turnWords(step.change)} onto ${label(step)}`, distance: step.distance }
    const heading = COMPASS[Math.round(bearing(path[0].point, pointAhead(0)) / 45) % 8]
    return { text: `Head ${heading} ${step.named ? 'on' : 'along'} ${label(step)}`, distance: step.distance }
  })
  result.push({ text: `Arrive at ${destination}`, distance: 0 })
  return result
}

/** What a route needs from the map: which zoom level, which tiles, and how far to look for a road. */
export function planRoute(from: [number, number], to: [number, number], maxZoom = 14) {
  if (maxZoom < LEVELS.at(-1)!.zoom) {
    throw new RouteError('This offline area is not detailed enough for directions. Download a smaller area for street-level detail.')
  }
  const box = routeBox(from, to)
  const level = LEVELS.find((l) => l.zoom <= maxZoom && countTiles(box, l.zoom) <= MAX_TILES)
  if (!level) throw new RouteError('These places are too far apart for directions on this device.')
  return { ...level, box }
}

export interface RawTile {
  x: number
  y: number
  data: ArrayBuffer
}

/** Reads the route's tiles, a few requests at a time; missing and empty tiles are left out. */
export async function readTiles(source: TileSource, zoom: number, box: BBox) {
  const { x0, x1, y0, y1 } = tileRange(box, zoom)
  const queue: [number, number][] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) queue.push([x, y])
  const tiles: RawTile[] = []
  const worker = async () => {
    for (let next = queue.pop(); next; next = queue.pop()) {
      const [x, y] = next
      const data = await source(zoom, x, y)
      if (data && data.byteLength) tiles.push({ x, y, data })
    }
  }
  await Promise.all(Array.from({ length: PARALLEL_READS }, worker))
  return tiles
}

export interface RouteRequest {
  from: [number, number]
  to: [number, number]
  destination: string
  mode: TravelMode
  zoom: number
  snapMetres: number
  tiles: RawTile[]
}

/** Builds the road network from the tiles and finds the route. CPU-heavy, so it runs in a worker. */
export function computeRoute({ from, to, destination, mode, zoom, snapMetres, tiles }: RouteRequest): Route {
  const net = buildNetwork(
    tiles.map(({ x, y, data }) => ({ x, y, tile: new VectorTile(new PbfReader(data)) })),
    mode,
  )
  const world = 2 ** zoom * net.extent
  const coords = net.xs.map((x, i): [number, number] => [
    (x / world) * 360 - 180,
    Math.atan(Math.sinh(Math.PI * (1 - (2 * net.ys[i]) / world))) / RAD,
  ])

  const grid = new Grid(CELL_UNITS)
  for (let e = 0; e < net.edgeA.length; e++) {
    grid.add(e, net.xs[net.edgeA[e]], net.ys[net.edgeA[e]], net.xs[net.edgeB[e]], net.ys[net.edgeB[e]])
  }
  const starts = snapCandidates(net, grid, coords, from, world, snapMetres).slice(0, 12)
  const ends = snapCandidates(net, grid, coords, to, world, snapMetres).slice(0, 12)
  const how = mode === 'walk' ? 'walk on' : 'drive on'
  if (!starts.length) throw new RouteError(`No road you can ${how} was found near the start in this map data.`)
  if (!ends.length) throw new RouteError(`No road you can ${how} was found near ${destination} in this map data.`)

  // Small pieces of road (a car park, a road cut off at the edge of the data) can be nearest to
  // a point without leading anywhere, so pick the closest pair that is connected.
  const find = components(coords.length, net.edgeA, net.edgeB)
  let best: [Snap, Snap] | null = null
  for (const s of starts) {
    for (const e of ends) {
      if (find(net.edgeA[s.edge]) !== find(net.edgeA[e.edge])) continue
      if (!best || s.distance + e.distance < best[0].distance + best[1].distance) best = [s, e]
    }
  }
  const result = best && search(net, mode, coords, best[0], best[1])
  if (!best || !result) {
    throw new RouteError(`No ${mode === 'walk' ? 'walking' : 'driving'} route to ${destination} was found in this map data.`)
  }

  const degree = new Uint32Array(coords.length)
  for (let e = 0; e < net.edgeA.length; e++) {
    degree[net.edgeA[e]]++
    degree[net.edgeB[e]]++
  }
  // Two extra entries for the start and destination points, which are never junctions.
  const junctions = new Uint8Array(coords.length + 2)
  degree.forEach((d, node) => (junctions[node] = d >= 3 ? 1 : 0))

  const steps = describe(net, result.path, junctions, destination)
  const [snapFrom, snapTo] = best
  if (snapFrom.distance > 30) steps.unshift({ text: 'Go to the nearest road', distance: snapFrom.distance })
  if (snapTo.distance > 30) steps.splice(steps.length - 1, 0, { text: `Leave the road for ${destination}`, distance: snapTo.distance })

  const walkTime = (m: number) => m / ((WALK_KMH * 1000) / 3600)
  return {
    mode,
    line: [from, ...result.path.map((p) => p.point), to],
    distance: result.distance + snapFrom.distance + snapTo.distance,
    duration: result.duration + walkTime(snapFrom.distance) + walkTime(snapTo.distance),
    steps,
    mainRoadsOnly: zoom < 14,
  }
}
