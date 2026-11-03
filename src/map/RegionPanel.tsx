import { useEffect, useRef, useState } from 'react'
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from '../icons'
import { fetchChildren, levelName, type AdminChildren, type AdminRegion } from './admin'
import { COUNTRIES, type Country } from './countries'
import { canDownload, downloadArea, planDownload, type DownloadProgress } from './download'
import { detailLabel, type BBox } from './geo'
import { deleteArea, type OfflineArea } from './offlineStore'
import type { Place } from './places'
import SearchPanel, { type SearchOrigin } from './SearchPanel'
import type { ReplySettings } from '../settings'

interface RegionPanelProps {
  areas: OfflineArea[]
  viewingAreaId: string | null
  online: boolean
  onSelect: (bbox: BBox) => void
  onViewOffline: (area: OfflineArea) => void
  onViewOnline: () => void
  onAreasChange: () => void
  visibleBBox: () => BBox | null
  ai: { ready: boolean; reply: ReplySettings }
  getOrigin: () => SearchOrigin | null
  onResults: (places: Place[], origin: SearchOrigin) => void
  onFocus: (place: Place) => void
}

interface DownloadTarget {
  name: string
  path: string[]
  bbox: BBox
}

type ChildrenState = { status: 'loading' } | { status: 'error' } | { status: 'done'; data: AdminChildren }

const formatMB = (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`
const sameBBox = (a: BBox, b: BBox) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6)

export default function RegionPanel(props: RegionPanelProps) {
  const { areas, viewingAreaId, online, onSelect, onViewOffline, onViewOnline, onAreasChange, visibleBBox } = props
  const [tab, setTab] = useState<'search' | 'regions' | 'offline'>('search')
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [country, setCountry] = useState<Country | null>(null)
  const [trail, setTrail] = useState<AdminRegion[]>([])
  const [children, setChildren] = useState<ChildrenState | null>(null)
  const [retry, setRetry] = useState(0)
  const [download, setDownload] = useState<{ name: string; progress: DownloadProgress } | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const controllerRef = useRef<AbortController | null>(null)

  const current = trail.at(-1) ?? (country && { id: country.id, name: country.name, level: 2, bbox: country.bbox })

  // Stop a running download when the map is closed.
  useEffect(() => () => controllerRef.current?.abort(), [])

  useEffect(() => {
    if (!country || !current) return setChildren(null)
    let cancelled = false
    setChildren({ status: 'loading' })
    fetchChildren(country.iso, current)
      .then((data) => !cancelled && setChildren({ status: 'done', data }))
      .catch(() => !cancelled && setChildren({ status: 'error' }))
    return () => {
      cancelled = true
    }
  }, [country, current?.id, retry])

  function chooseCountry(next: Country) {
    setCountry(next)
    setTrail([])
    onSelect(next.bbox)
  }

  function chooseRegion(region: AdminRegion) {
    setTrail([...trail, region])
    onSelect(region.bbox)
  }

  /** 0 is the country, 1 the first region below it, and so on. */
  function goTo(depth: number) {
    const next = trail.slice(0, depth)
    setTrail(next)
    onSelect((next.at(-1) ?? country!).bbox)
  }

  async function startDownload(target: DownloadTarget) {
    const controller = new AbortController()
    controllerRef.current = controller
    setDownloadError(null)
    setDownload({ name: target.name, progress: { done: 0, total: planDownload(target.bbox).tiles, bytes: 0 } })
    try {
      await downloadArea(target, (progress) => setDownload({ name: target.name, progress }), controller.signal)
      onAreasChange()
      setTab('offline')
    } catch (err) {
      if (!controller.signal.aborted) setDownloadError(err instanceof Error ? err.message : String(err))
    } finally {
      controllerRef.current = null
      setDownload(null)
    }
  }

  async function removeArea(area: OfflineArea) {
    if (!confirm(`Delete the offline map of ${area.name}?`)) return
    await deleteArea(area.id)
    if (area.id === viewingAreaId) onViewOnline()
    onAreasChange()
  }

  function downloadCard(target: DownloadTarget) {
    const plan = planDownload(target.bbox)
    const saved = areas.find((a) => a.name === target.name && sameBBox(a.bbox, target.bbox))
    return (
      <div className="download-card">
        <strong>{target.name}</strong>
        {saved ? (
          <p className="ready">
            ✓ Saved for offline use ·{' '}
            <button className="link" onClick={() => onViewOffline(saved)}>
              View offline
            </button>
          </p>
        ) : (
          <>
            <p className="muted">
              {plan.tiles.toLocaleString('en')} map tiles · {detailLabel(plan.maxzoom)}
            </p>
            {canDownload ? (
              <button className="btn primary" disabled={!online || download !== null} onClick={() => startDownload(target)}>
                Download for offline
              </button>
            ) : (
              <p className="muted small">Downloading areas for offline use is available in the Android app.</p>
            )}
          </>
        )}
      </div>
    )
  }

  const query = search.trim().toLowerCase()
  const countries = query
    ? COUNTRIES.filter((c) => c.name.toLowerCase().includes(query) || c.iso.toLowerCase() === query)
    : COUNTRIES

  const regionsTab = !country ? (
    <>
      <input
        className="panel-search"
        type="search"
        placeholder="Search countries"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search countries"
      />
      <ul className="region-list">
        {countries.map((c) => (
          <li key={c.iso}>
            <button onClick={() => chooseCountry(c)}>{c.name}</button>
          </li>
        ))}
      </ul>
    </>
  ) : (
    <>
      <nav className="breadcrumb" aria-label="Selected region">
        <button className="link" onClick={() => setCountry(null)}>
          All countries
        </button>
        {[country, ...trail].map((node, depth) => (
          <span key={node.id}>
            {' › '}
            {depth === trail.length ? (
              <strong>{node.name}</strong>
            ) : (
              <button className="link" onClick={() => goTo(depth)}>
                {node.name}
              </button>
            )}
          </span>
        ))}
      </nav>

      {downloadCard({
        name: current!.name,
        path: [country.name, ...trail.map((r) => r.name)].slice(0, -1),
        bbox: current!.bbox,
      })}

      {children?.status === 'loading' && (
        <p className="muted">Loading smaller areas from OpenStreetMap… The first time can take up to a minute.</p>
      )}
      {children?.status === 'error' && (
        <p className="alert">
          Could not load the list. {online ? 'The OpenStreetMap server may be busy.' : 'You are offline.'}{' '}
          <button className="link" onClick={() => setRetry((n) => n + 1)}>
            Try again
          </button>
        </p>
      )}
      {children?.status === 'done' && children.data.groups.length === 0 && (
        <p className="muted">There are no smaller areas here.</p>
      )}
      {children?.status === 'done' &&
        children.data.groups.map((group) => (
          <div key={group.level}>
            <h3 className="list-title">{levelName(country.iso, group.level)}</h3>
            <ul className="region-list">
              {group.regions.map((region) => (
                <li key={region.id}>
                  <button onClick={() => chooseRegion(region)}>
                    {region.name}
                    {region.nameEn && <small>{region.nameEn}</small>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
    </>
  )

  const offlineTab = (
    <>
      {areas.length === 0 ? (
        <p className="muted">No offline areas yet. Pick a region and tap “Download for offline”.</p>
      ) : (
        <ul className="area-list">
          {areas.map((area) => (
            <li key={area.id} className={area.id === viewingAreaId ? 'active' : undefined}>
              <div className="area-info">
                <strong>{area.name}</strong>
                <small>
                  {[area.path.join(' › '), detailLabel(area.maxzoom), formatMB(area.bytes)].filter(Boolean).join(' · ')}
                </small>
              </div>
              <button className="btn ghost" onClick={() => onViewOffline(area)} disabled={area.id === viewingAreaId}>
                {area.id === viewingAreaId ? 'Viewing' : 'View'}
              </button>
              <button className="icon-btn" aria-label={`Delete ${area.name}`} onClick={() => removeArea(area)}>
                <TrashIcon />
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewingAreaId && online && (
        <button className="btn primary" onClick={onViewOnline}>
          Back to the online map
        </button>
      )}
    </>
  )

  return (
    <section className={`region-panel${collapsed ? ' collapsed' : ''}`} aria-label="Regions and offline areas">
      <div className="panel-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'search'} onClick={() => (setTab('search'), setCollapsed(false))}>
            Search
          </button>
          <button role="tab" aria-selected={tab === 'regions'} onClick={() => (setTab('regions'), setCollapsed(false))}>
            Regions
          </button>
          <button role="tab" aria-selected={tab === 'offline'} onClick={() => (setTab('offline'), setCollapsed(false))}>
            Offline ({areas.length})
          </button>
        </div>
        <button
          className="icon-btn"
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
        </button>
      </div>

      {download && (
        <div className="progress" role="status">
          <div className="progress-label">
            <span>Downloading {download.name}…</span>
            <span>
              {download.progress.done.toLocaleString('en')} / {download.progress.total.toLocaleString('en')} ·{' '}
              {formatMB(download.progress.bytes)}
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-bar"
              style={{ width: `${Math.round((download.progress.done / Math.max(1, download.progress.total)) * 100)}%` }}
            />
          </div>
          <button className="link" onClick={() => controllerRef.current?.abort()}>
            Cancel
          </button>
        </div>
      )}
      {downloadError && <p className="alert">{downloadError}</p>}

      {!collapsed && (
        <div className="panel-body">
          {/* Kept mounted so a search and its answer survive switching tabs. */}
          <div hidden={tab !== 'search'} className="tab-page">
            <SearchPanel
              area={areas.find((a) => a.id === viewingAreaId) ?? null}
              online={online}
              ai={props.ai}
              getOrigin={props.getOrigin}
              onResults={props.onResults}
              onFocus={props.onFocus}
            />
          </div>
          {tab === 'regions' && regionsTab}
          {tab === 'offline' && offlineTab}
          {tab === 'regions' && online && canDownload && (
            <button
              className="btn ghost"
              disabled={download !== null}
              onClick={() => {
                const bbox = visibleBBox()
                if (bbox) startDownload({ name: `Map area, ${new Date().toLocaleDateString('en', { day: 'numeric', month: 'short' })}`, path: [], bbox })
              }}
            >
              Download the area on screen
            </button>
          )}
        </div>
      )}
    </section>
  )
}
