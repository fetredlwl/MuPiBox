// (fork "wishes") Wishes from Spotify: the child searches Spotify on the display, wishes an album, an artist or a show
// for a tab of its choice; the parents approve or refuse it in the app (page "Wünsche"), approved it goes on the start
// page under that tab. Home Assistant is told (/search_events, "wish") with a link to the app's page.
//
// Few requests to Spotify (its quota is per developer account and a block lasts hours):
// - a search only when the child taps "Bei Spotify suchen" (never while typing), one page of 10 per kind, the next page
//   only when the child scrolls to the end of the hits;
// - an artist's albums: its list kept on the SD card when there is one (artist-albums-store.ts, no request), else pages
//   of 10, the next one only when the child swipes to the end;
// - every page kept a day on the SD card (cache/wishes-pages.json): the same search or artist again, also after a
//   restart, asks Spotify nothing; nothing during a Spotify block;
// - a wish, its approval and the list in the app ask Spotify nothing (all of it was handed out with the pages).
//
// Switched on in the app: Bedienung › Suche › "Wünsche aus Spotify" (mupibox.displayWishes), with the display's search
// on. Off, the display offers no Spotify search and nothing here answers but the app's list of the wishes made.

import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { Express, RequestHandler } from 'express'
import { keptArtistAlbums } from './artist-albums-store'
import { backupBeforeWrite } from './file-backup'
import { localOnly } from './request-guard'
import type { SearchPool } from './search-pool'
import { spotifyBlock } from './spotify-block'

export type WishKind = 'album' | 'artist' | 'show'
const WISH_KINDS: WishKind[] = ['album', 'artist', 'show']
const CATEGORIES = ['audiobook', 'music', 'other'] as const
type Category = (typeof CATEGORIES)[number]

/** something the display may show and the child may wish */
export interface WishItem {
  kind: WishKind
  id: string
  name: string
  artist: string
  cover: string
}

export interface Wish {
  id: string
  at: string
  kind: WishKind
  spotifyId: string
  name: string
  artist: string
  cover: string
  /** the tab the child chose */
  category: Category
  /** revoked: approved before, the parents took the approval back (out of the pool and off the start page) */
  status: 'open' | 'approved' | 'rejected' | 'revoked'
  decidedAt?: string
  /** approved: it is in the search pool too - the child may take it out and put it back itself, as any approval */
  pooled?: boolean
}

export interface WishPage {
  items: WishItem[]
  more: boolean
}

export interface WishesDeps {
  configDir: string
  cacheDir: string
  pool: SearchPool
  getMupiboxConfig: () => Record<string, unknown> | undefined
  /** one page of a search (Spotify's search, 10 of each kind) */
  searchPage?: (
    query: string,
    offset: number,
  ) => Promise<{
    albums: { id: string; name: string; artist: string; cover: string }[]
    artists: { id: string; name: string; cover: string }[]
    shows: { id: string; name: string; artist: string; cover: string }[]
    more: boolean
  }>
  /** one page of an artist's albums (10) */
  artistPage?: (
    artistId: string,
    offset: number,
  ) => Promise<{ items: { id: string; name: string; cover: string }[]; total: number }>
  /** the artist's whole list kept on the SD card, or undefined (no request) */
  keptAlbums?: (artistId: string) => { id: string; name: string; cover: string }[] | undefined
  session: RequestHandler
  csrf: RequestHandler
  now?: () => number
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const PAGE = 10
const KEEP_MS = 24 * 60 * 60 * 1000
const MAX_PAGES = 400
const DECIDED_KEPT = 50

export function wishesOn(cfg: Record<string, unknown> | undefined): boolean {
  const mb = (cfg?.mupibox ?? {}) as Record<string, unknown>
  return mb.displaySearch === true && mb.displayWishes === true
}

const normal = (q: string) => q.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim()
const identOfWish = (kind: WishKind, id: string) => `${kind}:${id}`

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 1))
  await fsp.rename(tmp, file)
}

export class Wishes {
  private readonly file: string
  private readonly pagesFile: string
  private queue: Promise<unknown> = Promise.resolve()
  // the pages handed out (search and artist pages), kept a day - also on the SD card
  private pages: Map<string, { at: number; page: WishPage }> | null = null
  private readonly now: () => number

  constructor(private readonly deps: WishesDeps) {
    this.file = path.join(deps.configDir, 'wishes.json')
    this.pagesFile = path.join(deps.cacheDir, 'wishes-pages.json')
    this.now = deps.now ?? Date.now
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  // ---------- the pages, kept a day ----------

  private async keptPages(): Promise<Map<string, { at: number; page: WishPage }>> {
    if (!this.pages) {
      const list = await readJson<[string, { at: number; page: WishPage }][]>(this.pagesFile, [])
      this.pages = new Map(
        Array.isArray(list) ? list.filter((e) => Array.isArray(e) && this.now() - (e[1]?.at ?? 0) < KEEP_MS) : [],
      )
    }
    return this.pages
  }

  private async keepPage(key: string, page: WishPage): Promise<void> {
    const pages = await this.keptPages()
    for (const [k, e] of pages) if (this.now() - e.at >= KEEP_MS) pages.delete(k)
    while (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value as string)
    pages.set(key, { at: this.now(), page })
    await writeJson(this.pagesFile, [...pages.entries()]).catch(() => undefined)
  }

  /** a page kept from the last day, or the answer of `ask` (kept then) */
  private async page(key: string, ask: () => Promise<WishPage>): Promise<{ page: WishPage; kept: boolean }> {
    const have = (await this.keptPages()).get(key)
    if (have && this.now() - have.at < KEEP_MS) return { page: have.page, kept: true }
    const page = await ask()
    await this.keepPage(key, page)
    return { page, kept: false }
  }

  /** something handed out with a page of the last day (only those may be wished - not any id) */
  private async offered(kind: WishKind, id: string): Promise<WishItem | undefined> {
    for (const { at, page } of (await this.keptPages()).values()) {
      if (this.now() - at >= KEEP_MS) continue
      const item = page.items.find((i) => i.kind === kind && i.id === id)
      if (item) return item
    }
    return undefined
  }

  /** one page of a search: albums, artists, shows (10 of each kind at most) */
  async search(q: string, offset: number): Promise<{ page: WishPage; kept: boolean }> {
    const ask = this.deps.searchPage
    if (!ask) throw Object.assign(new Error('no Spotify'), { status: 503 })
    return this.page(`search|${normal(q)}|${offset}`, async () => {
      if (spotifyBlock()) throw Object.assign(new Error('spotify_blocked'), { status: 503 })
      const r = await ask(q, offset)
      return {
        items: [
          ...r.artists.map((a) => ({ kind: 'artist' as const, id: a.id, name: a.name, artist: '', cover: a.cover })),
          ...r.albums.map((a) => ({ kind: 'album' as const, ...a })),
          ...r.shows.map((s) => ({ kind: 'show' as const, ...s })),
        ].filter((i) => SPOTIFY_ID.test(i.id) && i.name),
        more: r.more,
      }
    })
  }

  /** one page of an artist's albums (10): from its list kept on the SD card when there is one, else Spotify's */
  async artistAlbums(artistId: string, offset: number): Promise<{ page: WishPage; kept: boolean }> {
    const artist = (await this.offered('artist', artistId))?.name ?? ''
    const whole = this.deps.keptAlbums?.(artistId)
    if (whole) {
      const items = whole
        .slice(offset, offset + PAGE)
        .map((a) => ({ kind: 'album' as const, id: a.id, name: a.name, artist, cover: a.cover }))
      const page = { items, more: whole.length > offset + PAGE }
      // (kept as a page too: an album of it may be wished)
      await this.keepPage(`artist|${artistId}|${offset}`, page)
      return { page, kept: true }
    }
    const ask = this.deps.artistPage
    if (!ask) throw Object.assign(new Error('no Spotify'), { status: 503 })
    return this.page(`artist|${artistId}|${offset}`, async () => {
      if (spotifyBlock()) throw Object.assign(new Error('spotify_blocked'), { status: 503 })
      const r = await ask(artistId, offset)
      return {
        items: r.items
          .filter((a) => SPOTIFY_ID.test(a.id) && a.name)
          .map((a) => ({ kind: 'album' as const, id: a.id, name: a.name, artist, cover: a.cover })),
        more: r.total > offset + PAGE,
      }
    })
  }

  // ---------- the wishes ----------

  async list(): Promise<Wish[]> {
    const list = await readJson<unknown>(this.file, [])
    return Array.isArray(list)
      ? (list as Wish[]).filter((w) => w && WISH_KINDS.includes(w.kind) && SPOTIFY_ID.test(w.spotifyId))
      : []
  }

  private async save(list: Wish[]): Promise<void> {
    // (with the copies data.json has: before the last write, and one a day for 7 days - backup/)
    backupBeforeWrite(this.file)
    await writeJson(this.file, list)
  }

  /** the child wishes something it was shown, for a tab (allowed: approved before - it may fetch it itself) */
  async wish(
    kind: WishKind,
    id: string,
    category: Category,
  ): Promise<'wished' | 'already' | 'there' | 'allowed' | 'unknown'> {
    const item = await this.offered(kind, id)
    if (!item) return 'unknown'
    if ((await this.deps.pool.libraryIdents()).has(identOfWish(kind, id))) return 'there'
    if ((await this.deps.pool.entries()).some((e) => e.kind === kind && e.spotifyId === id)) return 'allowed'
    const result = await this.serial(async () => {
      const list = await this.list()
      if (list.some((w) => w.status === 'open' && w.kind === kind && w.spotifyId === id)) return 'already' as const
      const wish: Wish = {
        id: `w_${this.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        at: new Date(this.now()).toISOString(),
        kind,
        spotifyId: id,
        name: item.name,
        artist: item.artist,
        cover: item.cover,
        category,
        status: 'open',
      }
      await this.save([...list, wish])
      return 'wished' as const
    })
    if (result === 'wished')
      await this.deps.pool.announce({ what: 'wish', kind, name: item.name, artist: item.artist, category })
    return result
  }

  /**
   * The parents decide: approved, it goes on the start page under the child's tab - and into the search pool: the child
   * may take it out and put it back itself, as anything the parents allowed in the search ("Nur in der Suche").
   */
  async decide(id: string, approve: boolean): Promise<'approved' | 'rejected' | 'unknown' | 'locked'> {
    const wish = (await this.list()).find((w) => w.id === id && w.status === 'open')
    if (!wish) return 'unknown'
    if (approve) {
      const r = await this.deps.pool.addWished(
        { kind: wish.kind, spotifyId: wish.spotifyId, name: wish.name, artist: wish.artist, cover: wish.cover },
        wish.category,
        wish.id,
      )
      if (r === 'locked') return 'locked'
      await this.toPool(wish)
    }
    await this.change(id, {
      status: approve ? 'approved' : 'rejected',
      decidedAt: new Date(this.now()).toISOString(),
      ...(approve ? { pooled: true } : {}),
    })
    // (the same thing wished more than once while open: decided with it)
    for (const twin of (await this.list()).filter(
      (w) => w.status === 'open' && w.kind === wish.kind && w.spotifyId === wish.spotifyId,
    ))
      await this.change(twin.id, {
        status: approve ? 'approved' : 'rejected',
        decidedAt: new Date(this.now()).toISOString(),
      })
    return approve ? 'approved' : 'rejected'
  }

  /**
   * The parents take an approval back ("Freigabe widerrufen"): out of the search pool, and off the start page when the
   * child has it there (only what it has as its own). The wish stays in the list as revoked.
   */
  async revoke(id: string): Promise<'revoked' | 'unknown' | 'locked'> {
    const wish = (await this.list()).find((w) => w.id === id && w.status === 'approved')
    if (!wish) return 'unknown'
    const ident = identOfWish(wish.kind, wish.spotifyId)
    // (Home Assistant is not told: the parents did it themselves)
    if ((await this.deps.pool.removeOwn(ident, false)) === 'locked') return 'locked'
    await this.deps.pool.removeByIdent(ident)
    // (all approvals of the same thing: revoked together - none of them is in the pool any more)
    for (const w of (await this.list()).filter(
      (x) => x.status === 'approved' && x.kind === wish.kind && x.spotifyId === wish.spotifyId,
    ))
      await this.change(w.id, { status: 'revoked', decidedAt: new Date(this.now()).toISOString(), pooled: false })
    return 'revoked'
  }

  /**
   * The approvals made before the pool kept them (fork state of 22.11.2026): into the pool once (marked pooled - taken
   * out of the pool in the app later, they are not put back).
   */
  async rememberApproved(): Promise<void> {
    for (const w of (await this.list()).filter((x) => x.status === 'approved' && !x.pooled)) {
      await this.toPool(w)
      await this.change(w.id, { pooled: true })
    }
  }

  private async toPool(wish: Wish): Promise<void> {
    await this.deps.pool.add({
      kind: wish.kind,
      spotifyId: wish.spotifyId,
      name: wish.name,
      artist: wish.kind === 'artist' ? '' : wish.artist,
      cover: wish.cover,
    })
  }

  private change(id: string, fields: Partial<Wish>): Promise<void> {
    return this.serial(async () => {
      const list = await this.list()
      const at = list.findIndex((w) => w.id === id)
      if (at < 0) return
      list[at] = { ...list[at], ...fields }
      // (the open ones all, of the decided ones the newest)
      const open = list.filter((w) => w.status === 'open')
      const decided = list.filter((w) => w.status !== 'open').slice(-DECIDED_KEPT)
      await this.save([...open, ...decided].sort((a, b) => a.at.localeCompare(b.at)))
    })
  }
}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const offsetOf = (v: unknown) => {
  const n = Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) && n >= 0 && n <= 990 && n % PAGE === 0 ? n : -1
}

export function registerWishesRoutes(app: Express, deps: WishesDeps): Wishes {
  const wishes = new Wishes(deps)
  const fail = (res: Parameters<RequestHandler>[1], status: number, error: string) =>
    void res.status(status).json({ error })
  const failed = (res: Parameters<RequestHandler>[1], err: unknown, what: string) => {
    const status = (err as { status?: number })?.status
    if (status === 503)
      return fail(res, 503, (err as Error).message === 'spotify_blocked' ? 'spotify_blocked' : 'spotify_unavailable')
    // (Spotify's own block: the next request waits for it, see spotify-block.ts)
    if ((err as { statusCode?: number })?.statusCode === 429) return fail(res, 503, 'spotify_blocked')
    console.error(`${new Date().toLocaleString()}: [wishes] ${what}:`, err)
    fail(res, 502, 'spotify_failed')
  }
  const on = () => wishesOn(deps.getMupiboxConfig())

  // ---------- the display ----------

  /** GET /api/wishes/search?q=…&offset=0 - one page of a search on Spotify (kept a day) */
  app.get('/api/wishes/search', localOnly, async (req, res) => {
    if (!on()) return fail(res, 403, 'off')
    const q = text(req.query.q, 100)
    const offset = offsetOf(req.query.offset)
    if (normal(q).length < 2 || offset < 0) return fail(res, 400, 'invalid_query')
    try {
      const { page, kept } = await wishes.search(q, offset)
      res.json({ ...page, kept })
    } catch (err) {
      failed(res, err, 'search')
    }
  })

  /** GET /api/wishes/artist?id=…&offset=0 - one page of an artist's albums (kept a day; its whole list when kept) */
  app.get('/api/wishes/artist', localOnly, async (req, res) => {
    if (!on()) return fail(res, 403, 'off')
    const id = text(req.query.id, 40)
    const offset = offsetOf(req.query.offset)
    if (!SPOTIFY_ID.test(id) || offset < 0) return fail(res, 400, 'invalid_request')
    try {
      const { page, kept } = await wishes.artistAlbums(id, offset)
      res.json({ ...page, kept })
    } catch (err) {
      failed(res, err, 'artist albums')
    }
  })

  /** GET /api/wishes/mine - the open wishes (the display marks them "gewünscht") */
  app.get('/api/wishes/mine', localOnly, async (_req, res) => {
    if (!on()) return void res.json({ wishes: [] })
    res.json({
      wishes: (await wishes.list()).filter((w) => w.status === 'open').map((w) => ({ kind: w.kind, id: w.spotifyId })),
    })
  })

  /** POST /api/wishes {kind, id, category} - the child wishes something it was shown */
  app.post('/api/wishes', localOnly, async (req, res) => {
    if (!on()) return fail(res, 403, 'off')
    const b = (req.body ?? {}) as Record<string, unknown>
    const kind = b.kind as WishKind
    const id = text(b.id, 40)
    const category = b.category as Category
    if (!WISH_KINDS.includes(kind) || !SPOTIFY_ID.test(id) || !CATEGORIES.includes(category))
      return fail(res, 400, 'invalid_request')
    const result = await wishes.wish(kind, id, category)
    if (result === 'unknown') return fail(res, 403, 'not_offered')
    res.json({ ok: true, result })
  })

  // ---------- the parents' app ----------

  /** GET /api/app/wishes - the open wishes and the decided ones (newest first) */
  app.get('/api/app/wishes', deps.session, async (_req, res) => {
    const list = (await wishes.list()).reverse()
    res.json({
      on: on(),
      open: list.filter((w) => w.status === 'open'),
      decided: list.filter((w) => w.status !== 'open'),
    })
  })

  /** POST /api/app/wishes/decide {id, approve} - approved: on the start page under the child's tab */
  app.post('/api/app/wishes/decide', deps.session, deps.csrf, async (req, res) => {
    const id = text(req.body?.id, 40)
    if (!id || typeof req.body?.approve !== 'boolean') return fail(res, 400, 'invalid_request')
    try {
      const result = await wishes.decide(id, req.body.approve)
      if (result === 'unknown') return fail(res, 404, 'not_open')
      if (result === 'locked') return fail(res, 409, 'library_busy')
      res.json({ ok: true, result })
    } catch (err) {
      console.error(`${new Date().toLocaleString()}: [wishes] decide:`, err)
      fail(res, 500, 'could_not_decide')
    }
  })

  /** POST /api/app/wishes/revoke {id} - an approval taken back: out of the search pool and off the start page */
  app.post('/api/app/wishes/revoke', deps.session, deps.csrf, async (req, res) => {
    const id = text(req.body?.id, 40)
    if (!id) return fail(res, 400, 'invalid_request')
    try {
      const result = await wishes.revoke(id)
      if (result === 'unknown') return fail(res, 404, 'not_approved')
      if (result === 'locked') return fail(res, 409, 'library_busy')
      res.json({ ok: true, result })
    } catch (err) {
      console.error(`${new Date().toLocaleString()}: [wishes] revoke:`, err)
      fail(res, 500, 'could_not_revoke')
    }
  })

  // (the approvals of before into the pool, once - a moment after the start)
  setTimeout(() => {
    wishes.rememberApproved().catch((err) => console.warn(`${new Date().toLocaleString()}: [wishes] remember:`, err))
  }, 5_000).unref()

  return wishes
}

/** the kept list of an artist's albums in the form the wishes use (artist-albums-store.ts; no request) */
export function keptWishAlbums(artistId: string): { id: string; name: string; cover: string }[] | undefined {
  const albums = keptArtistAlbums(artistId, 'album,single,compilation')
  return albums
    ?.filter((a) => a.id && a.name)
    .map((a) => ({ id: a.id as string, name: a.name as string, cover: a.images?.[1]?.url ?? a.images?.[0]?.url ?? '' }))
}
