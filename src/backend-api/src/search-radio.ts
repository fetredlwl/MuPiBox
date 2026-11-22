// (fork "wishes") Radio for children in the display's search: the app's radio search ("Radiosender suchen",
// radio-browser.info) with its "Für Kinder" filter only - stations tagged for children. The child puts one on the start
// page itself, without the parents' approval (as the podcasts for children, search-podcasts.ts).
//
// - Searched only when the child asks (the tile, or the keyboard's "Suchen"), each search term once a day (kept here
//   24 hours): the term goes to radio-browser.info, as in the app.
// - Only a station this search handed out may be added (its stream among the hits of the last day) - not any address.
// - Switched on in the app: Bedienung › Suche › "Radio für Kinder in der Suche" (mupibox.displayRadio), with the
//   display's search on and the radio search of the app not switched off.
// - Not to Spotify: no quota of the box is used.

import type { Express } from 'express'
import { radioSearchOn } from './eltern/podcasts'
import type { MupiboxConfig } from './models/mupibox-config.model'
import { kidsRadio, type RadioHit, radioLanguageKnown, searchRadio } from './radio-search'
import { localOnly } from './request-guard'
import type { SearchPool } from './search-pool'

export interface KidsStation {
  url: string
  name: string
  image: string
  country: string
}

export interface SearchRadioDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  pool: SearchPool
  /** the directory (tests: invented hits) */
  search?: (term: string, lang: string) => Promise<RadioHit[]>
  /** the tips before anything is typed (tests: invented hits) */
  tips?: (lang: string) => Promise<RadioHit[]>
  now?: () => number
}

const KEEP_MS = 24 * 60 * 60 * 1000
// the tips: asked again after 6 hours at the soonest (as the app's suggestions)
const TIPS_MS = 6 * 60 * 60 * 1000
const MAX_TIPS = 20
const MAX_KEPT = 300
const MAX_HITS = 24

/** whether the display may search radio stations for children */
export function kidsRadioOn(cfg: MupiboxConfig | undefined): boolean {
  const mb = (cfg?.mupibox ?? {}) as Record<string, unknown>
  return mb.displaySearch === true && mb.displayRadio === true && radioSearchOn(cfg)
}

/** the language of the search: the box's language where the directory knows it, else German */
function radioLanguage(cfg: MupiboxConfig | undefined): string {
  const lang = String((cfg as Record<string, unknown> | undefined)?.displayLanguage ?? '')
  return radioLanguageKnown(lang) ? lang : 'de'
}

const normal = (q: string) => q.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
const station = (h: RadioHit): KidsStation => ({ url: h.url, name: h.name, image: h.image, country: h.country })

export function registerSearchRadioRoutes(app: Express, deps: SearchRadioDeps): void {
  const search = deps.search ?? ((term: string, lang: string) => searchRadio(term, lang, true))
  const tips = deps.tips ?? kidsRadio
  const now = deps.now ?? Date.now
  // the answers of the last day: "lang|term" -> hits (a search term asked once a day)
  const kept = new Map<string, { at: number; hits: KidsStation[] }>()

  const fresh = (e: { at: number }) => now() - e.at < KEEP_MS
  const offered = (url: string): KidsStation | undefined => {
    for (const e of kept.values()) {
      if (!fresh(e)) continue
      const hit = e.hits.find((h) => h.url === url)
      if (hit) return hit
    }
    return undefined
  }

  /** GET /api/search-radio?q=… - radio stations for children for the display's search (kept a day per term) */
  app.get('/api/search-radio', localOnly, async (req, res) => {
    const cfg = deps.getMupiboxConfig()
    if (!kidsRadioOn(cfg)) return void res.status(403).json({ error: 'off' })
    const q = normal(String(req.query.q ?? ''))
    if (q.length < 2 || q.length > 100) return void res.status(400).json({ error: 'invalid_query' })
    const lang = radioLanguage(cfg)
    const key = `${lang}|${q}`
    const have = kept.get(key)
    if (have && fresh(have)) return void res.json({ stations: have.hits, kept: true })
    try {
      const hits = (await search(q, lang))
        .filter((h) => h.kids && h.url && h.name)
        .slice(0, MAX_HITS)
        .map(station)
      // (the oldest out when too many terms are kept)
      for (const [k, e] of kept) if (!fresh(e) || kept.size >= MAX_KEPT) kept.delete(k)
      kept.set(key, { at: now(), hits })
      res.json({ stations: hits, kept: false })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-radio] ${error}`)
      res.status(502).json({ error: 'directory_unavailable' })
    }
  })

  /** GET /api/search-radio/tips - children's stations before anything is typed (the app's "Kinderradio") */
  app.get('/api/search-radio/tips', localOnly, async (_req, res) => {
    const cfg = deps.getMupiboxConfig()
    if (!kidsRadioOn(cfg)) return void res.status(403).json({ error: 'off' })
    const lang = radioLanguage(cfg)
    const key = `tips|${lang}`
    const have = kept.get(key)
    if (have && now() - have.at < TIPS_MS) return void res.json({ stations: have.hits, kept: true })
    try {
      const hits = (await tips(lang))
        .filter((h) => h.kids && h.url && h.name)
        .slice(0, MAX_TIPS)
        .map(station)
      kept.set(key, { at: now(), hits })
      res.json({ stations: hits, kept: false })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-radio] tips: ${error}`)
      // (the tips kept before, older as they are, rather than none)
      res.json({ stations: have?.hits ?? [], kept: true })
    }
  })

  /** POST /api/search-radio/add {url, category} - a station of the search on the start page, by the child */
  app.post('/api/search-radio/add', localOnly, async (req, res) => {
    if (!kidsRadioOn(deps.getMupiboxConfig())) return void res.status(403).json({ error: 'off' })
    const b = (req.body ?? {}) as { url?: unknown; category?: unknown }
    const category = String(b.category ?? '')
    if (!['audiobook', 'music', 'other'].includes(category))
      return void res.status(400).json({ error: 'invalid_category' })
    const hit = offered(String(b.url ?? ''))
    if (!hit) return void res.status(403).json({ error: 'not_offered' })
    try {
      const result = await deps.pool.addKidsRadio(
        { url: hit.url, name: hit.name, cover: hit.image },
        category as 'audiobook' | 'music' | 'other',
      )
      if (result === 'locked') return void res.status(409).json({ error: 'library_busy' })
      res.json({ ok: true, result })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-radio] add failed: ${error}`)
      res.status(500).json({ error: 'could_not_add' })
    }
  })
}
