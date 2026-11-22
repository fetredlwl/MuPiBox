// (fork "wishes") Podcasts for children in the display's search: the app's podcast search ("Podcasts suchen", Apple's
// directory and for German the ARD Audiothek) with its "Für Kinder" filter only - Apple's children's categories, not
// explicit; the ARD's children's shows. The child puts one on the start page itself, without the parents' approval.
//
// - Asked only when the child taps "Podcasts für Kinder suchen" (never while typing), and each search term once a day
//   (kept here 24 hours): the term goes to Apple / the ARD, as in the app.
// - Only a show this search handed out may be added (its feed among the hits of the last day) - not any address.
// - Switched on in the app: Bedienung › Suche › "Podcasts für Kinder in der Suche" (mupibox.displayPodcasts), with the
//   display's search on and the podcast search of the app not switched off.
// - Not to Spotify: no quota of the box is used.

import type { Express } from 'express'
import { type ArdShow, ardKidsShows, ardSearch } from './ard-sounds'
import { podcastSearchOn } from './eltern/podcasts'
import type { MupiboxConfig } from './models/mupibox-config.model'
import { CONTENT_LANGUAGES, mergeHits, type PodcastHit, searchPodcasts, topKidsPodcasts } from './podcast-search'
import { localOnly } from './request-guard'
import { nameKey, type OnBox, type SearchPool } from './search-pool'

export interface KidsPodcast {
  feedUrl: string
  title: string
  author: string
  image: string
  episodes: number
}

export interface SearchPodcastsDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  pool: SearchPool
  /** the directories (tests: invented hits) */
  search?: (term: string, lang: string) => Promise<PodcastHit[]>
  /** the tips before anything is typed (tests: invented hits) */
  tips?: (lang: string) => Promise<PodcastHit[]>
  now?: () => number
}

const KEEP_MS = 24 * 60 * 60 * 1000
// the tips: asked again after 6 hours at the soonest (as the app's suggestions)
const TIPS_MS = 6 * 60 * 60 * 1000
const MAX_TIPS = 20
const MAX_KEPT = 300
const MAX_HITS = 24

/** whether the display may search podcasts for children */
export function kidsPodcastsOn(cfg: MupiboxConfig | undefined): boolean {
  const mb = (cfg?.mupibox ?? {}) as Record<string, unknown>
  return mb.displaySearch === true && mb.displayPodcasts === true && podcastSearchOn(cfg)
}

/** the language of the search: the box's language where the directory knows it, else German */
export function contentLanguage(cfg: MupiboxConfig | undefined): string {
  const lang = String((cfg as Record<string, unknown> | undefined)?.displayLanguage ?? '')
  return lang in CONTENT_LANGUAGES ? lang : 'de'
}

const ardToHit = (s: ArdShow): PodcastHit => ({
  title: s.title,
  author: s.station || 'ARD',
  feedUrl: `ard:${s.id}`,
  image: s.image,
  genre: 'ARD Audiothek',
  episodes: s.episodes,
  country: 'DE',
  kids: s.kids,
  explicit: false,
})

/** Apple's directory and (German) the ARD Audiothek, children's shows only */
async function directories(term: string, lang: string): Promise<PodcastHit[]> {
  const [apple, ard] = await Promise.allSettled([
    searchPodcasts(term, lang, true),
    lang === 'de' ? ardSearch(term, true) : Promise.resolve([]),
  ])
  if (apple.status === 'rejected' && ard.status === 'rejected') throw new Error('directory_unavailable')
  return mergeHits(
    apple.status === 'fulfilled' ? apple.value : [],
    ard.status === 'fulfilled' ? ard.value.map(ardToHit) : [],
  )
}

/** the app's "Vorschläge für Kinder": Apple's children's charts, for German with the ARD's children's shows */
async function kidsTips(lang: string): Promise<PodcastHit[]> {
  const [apple, ard] = await Promise.allSettled([
    topKidsPodcasts(lang),
    lang === 'de' ? ardKidsShows() : Promise.resolve([]),
  ])
  if (apple.status === 'rejected' && ard.status === 'rejected') throw new Error('directory_unavailable')
  return mergeHits(
    apple.status === 'fulfilled' ? apple.value : [],
    ard.status === 'fulfilled' ? ard.value.map(ardToHit) : [],
  )
}

const normal = (q: string) => q.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()

/** a show the box has already (its feed, or a podcast of the same name - another address of it): not offered */
const notOnBox = (box: OnBox) => (h: KidsPodcast) =>
  !box.idents.has(`podcast:${h.feedUrl.replace(/^https?:\/\//i, '')}`) && !box.names.has(nameKey(h.title))

export function registerSearchPodcastsRoutes(app: Express, deps: SearchPodcastsDeps): void {
  const search = deps.search ?? directories
  const tips = deps.tips ?? kidsTips
  const now = deps.now ?? Date.now
  // the answers of the last day: "lang|term" -> hits (a search term asked once a day)
  const kept = new Map<string, { at: number; hits: KidsPodcast[] }>()

  const fresh = (e: { at: number }) => now() - e.at < KEEP_MS
  const offered = (feedUrl: string): KidsPodcast | undefined => {
    for (const e of kept.values()) {
      if (!fresh(e)) continue
      const hit = e.hits.find((h) => h.feedUrl === feedUrl)
      if (hit) return hit
    }
    return undefined
  }

  /** GET /api/search-podcasts?q=… - podcasts for children for the display's search (kept a day per term) */
  app.get('/api/search-podcasts', localOnly, async (req, res) => {
    const cfg = deps.getMupiboxConfig()
    if (!kidsPodcastsOn(cfg)) return void res.status(403).json({ error: 'off' })
    const q = normal(String(req.query.q ?? ''))
    if (q.length < 2 || q.length > 100) return void res.status(400).json({ error: 'invalid_query' })
    const lang = contentLanguage(cfg)
    const key = `${lang}|${q}`
    const have = kept.get(key)
    if (have && fresh(have))
      return void res.json({ shows: have.hits.filter(notOnBox(await deps.pool.onBox())), kept: true })
    try {
      const hits = (await search(q, lang))
        .filter((h) => h.kids && !h.explicit && h.feedUrl && h.title)
        .slice(0, MAX_HITS)
        .map((h) => ({ feedUrl: h.feedUrl, title: h.title, author: h.author, image: h.image, episodes: h.episodes }))
      // (the oldest out when too many terms are kept)
      for (const [k, e] of kept) if (!fresh(e) || kept.size >= MAX_KEPT) kept.delete(k)
      kept.set(key, { at: now(), hits })
      res.json({ shows: hits.filter(notOnBox(await deps.pool.onBox())), kept: false })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-podcasts] ${error}`)
      res.status(502).json({ error: 'directory_unavailable' })
    }
  })

  /**
   * GET /api/search-podcasts/tips - podcasts for children before anything is typed ("Tipps für Kinder"): the app's
   * suggestions, asked again after 6 hours at the soonest; they may be added as the search's hits
   */
  app.get('/api/search-podcasts/tips', localOnly, async (_req, res) => {
    const cfg = deps.getMupiboxConfig()
    if (!kidsPodcastsOn(cfg)) return void res.status(403).json({ error: 'off' })
    const lang = contentLanguage(cfg)
    const key = `tips|${lang}`
    const have = kept.get(key)
    if (have && now() - have.at < TIPS_MS)
      return void res.json({ shows: have.hits.filter(notOnBox(await deps.pool.onBox())), kept: true })
    try {
      const hits = (await tips(lang))
        .filter((h) => h.kids && !h.explicit && h.feedUrl && h.title)
        .slice(0, MAX_TIPS)
        .map((h) => ({ feedUrl: h.feedUrl, title: h.title, author: h.author, image: h.image, episodes: h.episodes }))
      kept.set(key, { at: now(), hits })
      res.json({ shows: hits.filter(notOnBox(await deps.pool.onBox())), kept: false })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-podcasts] tips: ${error}`)
      // (the tips kept before, older as they are, rather than none)
      res.json({ shows: (have?.hits ?? []).filter(notOnBox(await deps.pool.onBox())), kept: true })
    }
  })

  /** POST /api/search-podcasts/add {feedUrl, category} - a show of the search on the start page, by the child */
  app.post('/api/search-podcasts/add', localOnly, async (req, res) => {
    if (!kidsPodcastsOn(deps.getMupiboxConfig())) return void res.status(403).json({ error: 'off' })
    const b = (req.body ?? {}) as { feedUrl?: unknown; category?: unknown }
    const category = String(b.category ?? '')
    if (!['audiobook', 'music', 'other'].includes(category))
      return void res.status(400).json({ error: 'invalid_category' })
    const show = offered(String(b.feedUrl ?? ''))
    if (!show) return void res.status(403).json({ error: 'not_offered' })
    try {
      const result = await deps.pool.addKidsPodcast(
        { feedUrl: show.feedUrl, name: show.title, artist: show.author, cover: show.image },
        category as 'audiobook' | 'music' | 'other',
      )
      if (result === 'locked') return void res.status(409).json({ error: 'library_busy' })
      res.json({ ok: true, result })
    } catch (error) {
      console.error(`${new Date().toLocaleString()}: [search-podcasts] add failed: ${error}`)
      res.status(500).json({ error: 'could_not_add' })
    }
  })
}
