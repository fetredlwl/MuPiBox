// The search pool ("Nur in der Suche"): Spotify artists, albums, playlists and podcasts (RSS feeds, found in the app's
// podcast search) the parents allow without
// putting them on the display's start page. The child finds them with the display's search, may play them from there
// and may put an album or a whole artist under a tab of its choice into the library - and take out again only what it
// put in itself (kidAdded). Each such addition is noted for Home Assistant (events).
//
// Kept in a file of its own (search-pool.json next to data.json), not as marked rows of data.json: the official
// version does not know such a mark and would show the rows on the start page after a switch back to it.

import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { Express, RequestHandler } from 'express'
import { backupBeforeWrite } from './file-backup'
import { withLock } from './file-lock'
import { localOnly, localOrElternSession } from './request-guard'
import { spotifyBlock } from './spotify-block'

// (podcast: an RSS feed - feedUrl instead of spotifyId; show: a Spotify podcast)
export type PoolKind = 'artist' | 'album' | 'playlist' | 'show' | 'podcast'
export const POOL_KINDS: PoolKind[] = ['artist', 'album', 'playlist', 'show', 'podcast']
export const LIBRARY_CATEGORIES = ['audiobook', 'music', 'other'] as const
type LibraryCategory = (typeof LIBRARY_CATEGORIES)[number]

export interface PoolAlbum {
  id: string
  name: string
  cover: string
  release: string
}

export interface PoolEntry {
  id: string
  kind: PoolKind
  spotifyId: string
  // podcast: the feed's address
  feedUrl?: string
  name: string
  artist: string
  cover: string
  addedAt: string
  // artists: their albums, asked once when allowed and again once a day at most (the display's search asks nobody)
  albums?: PoolAlbum[]
  albumsAt?: string
}

export interface PoolEvent {
  id: number
  at: string
  what: 'added' | 'removed'
  kind: PoolKind
  name: string
  artist: string
  category: LibraryCategory
}

/** what the search pool needs of the server (server.ts) */
export interface SearchPoolDeps {
  configDir: string
  dataFile: string
  dataLock: string
  writeLibrary: (data: unknown[]) => Promise<void>
  spotify: () =>
    | {
        getAllArtistAlbums(
          artistId: string,
          albumTypes?: string,
          opts?: { pageDelayMs?: number },
        ): Promise<{ id: string; name: string; images?: { url?: string }[]; release_date?: string }[]>
      }
    | undefined
  /** seconds between the Spotify requests of the background work (Sync-Einstellungen, spotify_sync) - default 15 */
  backgroundSeconds?: () => number
  /** "Nur in der Suche" shown in the parents' app (Bedienung › Suche, mupibox.appSearchPool) - off: hidden, kept */
  appEnabled?: () => boolean
  session: RequestHandler
  csrf: RequestHandler
}

// a pause that does not keep the server (or a test) from ending
const pause = (ms: number) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    t.unref?.()
  })

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
// Playlists Spotify makes itself ("This Is …", mixes, editorial ones): Spotify does not hand them to apps like the box
// any more - the player waited for one for ever and the display stood still. Not taken into the pool.
export const isSpotifyOwnPlaylist = (id: string): boolean => /^37i9dQZF/.test(id)
const ALBUMS_MAX_AGE_MS = 24 * 3600_000
const EVENTS_KEPT = 50

const text = (v: unknown, max = 300): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** a podcast feed's address: http(s), no blanks (fetched as any podcast - servers of the home network only allowed ones) */
export function isFeedUrl(url: string): boolean {
  if (!/^https?:\/\/\S+$/i.test(url) || url.length > 500) return false
  try {
    return !!new URL(url).hostname
  } catch {
    return false
  }
}
// (the same feed with http or https: one)
const feedKey = (url: string) => url.replace(/^https?:\/\//i, '')

/** how a pool entry is known in the library: "album:<id>", …, "podcast:<feed without http(s)://>" */
export function poolIdent(e: { kind: PoolKind; spotifyId: string; feedUrl?: string }): string {
  return e.kind === 'podcast' ? `podcast:${feedKey(e.feedUrl ?? '')}` : `${e.kind}:${e.spotifyId}`
}
const coverOf = (images?: { url?: string }[]): string => text(images?.[1]?.url ?? images?.[0]?.url ?? '', 500)

// ---------- the files ----------

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  const tmp = `${file}.tmp.${process.pid}.${Date.now()}`
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2))
  await fsp.rename(tmp, file)
}

/** a library row of the child's from the pool: which Spotify thing it is ("album:<id>", "artist:<id>", …) */
export function identOf(row: Record<string, unknown>): string | null {
  if (row.type === 'rss' && typeof row.id === 'string' && row.id) return `podcast:${feedKey(row.id)}`
  if (row.type !== 'spotify') return null
  if (typeof row.playlistid === 'string' && row.playlistid) return `playlist:${row.playlistid}`
  if (typeof row.showid === 'string' && row.showid) return `show:${row.showid}`
  if (typeof row.id === 'string' && row.id) return `album:${row.id}`
  if (typeof row.artistid === 'string' && row.artistid) return `artist:${row.artistid}`
  return null
}

/** the library row for an album, a whole artist, a playlist or a podcast, put in by the child */
export function libraryRow(
  what: { kind: PoolKind; spotifyId: string; feedUrl?: string; name: string; artist: string; cover: string },
  category: LibraryCategory,
  poolId: string,
  now = new Date(),
): Record<string, unknown> {
  const base = { type: 'spotify', category, source: 'manual', kidAdded: true, addedAt: now.toISOString(), poolId }
  switch (what.kind) {
    case 'podcast':
      // (as the app's podcast search adds one: the feed, named by its title)
      return { ...base, type: 'rss', id: what.feedUrl, artist: what.name }
    case 'album':
      // (name and cover with it: the display shows it at once, without asking Spotify - see storedSpotifyAlbum)
      return { ...base, id: what.spotifyId, title: what.name, artist: what.artist || what.name, cover: what.cover }
    case 'artist':
      return { ...base, artistid: what.spotifyId, artist: what.name, artistcover: what.cover }
    case 'playlist':
      return { ...base, playlistid: what.spotifyId, title: what.name, cover: what.cover }
    case 'show':
      return { ...base, showid: what.spotifyId, artist: what.name, artistcover: what.cover }
  }
}

export class SearchPool {
  private readonly poolFile: string
  private readonly eventsFile: string
  // (one write at a time: the parents' app and the display may write at the same moment)
  private queue: Promise<unknown> = Promise.resolve()
  // (the artists' album lists: one artist after the other, in the background - see queueAlbums)
  private albumQueue: Promise<void> = Promise.resolve()
  private readonly queued = new Set<string>()

  constructor(private readonly deps: SearchPoolDeps) {
    this.poolFile = path.join(deps.configDir, 'search-pool.json')
    this.eventsFile = path.join(deps.configDir, 'search-pool-events.json')
  }

  // (the pool with the copies data.json has: the one before the last write, and one a day for 7 days - backup/)
  private writePool(list: PoolEntry[]): Promise<void> {
    backupBeforeWrite(this.poolFile)
    return writeJson(this.poolFile, list)
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  async entries(): Promise<PoolEntry[]> {
    const list = await readJson<unknown>(this.poolFile, [])
    return Array.isArray(list)
      ? (list as PoolEntry[]).filter(
          (e) =>
            e &&
            POOL_KINDS.includes(e.kind) &&
            (e.kind === 'podcast' ? isFeedUrl(e.feedUrl ?? '') : SPOTIFY_ID.test(e.spotifyId)),
        )
      : []
  }

  async add(input: {
    kind: PoolKind
    spotifyId: string
    feedUrl?: string
    name: string
    artist: string
    cover: string
  }): Promise<PoolEntry> {
    const { entry, isNew } = await this.serial(async () => {
      const list = await this.entries()
      const known = list.find((e) => poolIdent(e) === poolIdent(input))
      if (known) return { entry: known, isNew: false }
      const added: PoolEntry = {
        id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        ...input,
        addedAt: new Date().toISOString(),
      }
      await this.writePool( [...list, added])
      return { entry: added, isNew: true }
    })
    // (only for a new one: allowed twice in a row, Spotify was asked twice)
    if (isNew && entry.kind === 'artist') this.queueAlbums(entry.id)
    return entry
  }

  /** "Alle Freigaben löschen": the pool emptied (what the child put on the start page stays there) - how many went */
  async clear(): Promise<number> {
    return this.serial(async () => {
      const list = await this.entries()
      if (list.length) await this.writePool([])
      return list.length
    })
  }

  async remove(id: string): Promise<boolean> {
    return this.serial(async () => {
      const list = await this.entries()
      const rest = list.filter((e) => e.id !== id)
      if (rest.length === list.length) return false
      await this.writePool( rest)
      return true
    })
  }

  /** the spacing of the background requests (Sync-Einstellungen) in ms */
  private pageDelayMs(): number {
    const s = Number(this.deps.backgroundSeconds?.() ?? 15)
    return Number.isFinite(s) && s >= 0 ? s * 1000 : 15_000
  }

  /**
   * The album list of a pool artist, in the background: queued, one artist after the other, every further page and the
   * next artist only after the spacing of the Sync-Einstellungen. Ten big artists allowed in a few minutes asked 74
   * pages at once and Spotify blocked the app for 11 hours (22.11.). Nothing during a block.
   */
  queueAlbums(id: string): void {
    if (this.queued.has(id)) return
    this.queued.add(id)
    this.albumQueue = this.albumQueue.then(async () => {
      try {
        if (!spotifyBlock()) await this.refreshAlbums(id)
      } catch (err) {
        console.warn(
          `${new Date().toLocaleString()}: [search-pool] albums of ${id} not fetched: ${(err as Error)?.message ?? err}`,
        )
      } finally {
        this.queued.delete(id)
      }
      await pause(this.pageDelayMs())
    })
  }

  /** whether an artist's albums are queued or being fetched (the app shows "Alben werden geladen") */
  isQueued(id: string): boolean {
    return this.queued.has(id)
  }

  /** the albums of an artist of the pool from Spotify (kept by the Spotify service; not during a block) */
  async refreshAlbums(id: string): Promise<void> {
    const spotify = this.deps.spotify()
    if (!spotify || spotifyBlock()) return
    const entry = (await this.entries()).find((e) => e.id === id && e.kind === 'artist')
    if (!entry) return
    const albums = (await spotify.getAllArtistAlbums(entry.spotifyId, undefined, { pageDelayMs: this.pageDelayMs() }))
      .filter((a) => SPOTIFY_ID.test(a.id ?? ''))
      .map((a) => ({ id: a.id, name: text(a.name), cover: coverOf(a.images), release: text(a.release_date, 10) }))
    await this.serial(async () => {
      const list = await this.entries()
      const at = list.findIndex((e) => e.id === id)
      if (at < 0) return
      list[at] = { ...list[at], albums, albumsAt: new Date().toISOString() }
      await this.writePool( list)
    })
  }

  /** the artists whose albums are older than a day: asked again one after the other, in the background */
  refreshStale(list: PoolEntry[]): void {
    if (spotifyBlock()) return
    for (const e of list) {
      if (e.kind === 'artist' && (!e.albumsAt || Date.now() - Date.parse(e.albumsAt) > ALBUMS_MAX_AGE_MS)) {
        this.queueAlbums(e.id)
      }
    }
  }

  // ---------- the library: what the child put in ----------

  private async readLibrary(): Promise<Record<string, unknown>[] | null> {
    const data = await readJson<unknown>(this.deps.dataFile, null)
    return Array.isArray(data) ? (data as Record<string, unknown>[]) : null
  }

  /** the rows the child put in (newest first) */
  async own(): Promise<
    { ident: string; kind: string; name: string; artist: string; cover: string; category: string; addedAt: string }[]
  > {
    const data = (await this.readLibrary()) ?? []
    return data
      .filter((row) => row?.kidAdded === true)
      .map((row) => {
        const ident = identOf(row) ?? ''
        const kind = ident.split(':')[0]
        const name = text(kind === 'album' || kind === 'playlist' ? row.title : row.artist) || text(row.artist)
        return {
          ident,
          kind,
          name,
          artist: kind === 'album' ? text(row.artist) : '',
          cover: text(row.cover, 500) || text(row.artistcover, 500),
          category: text(row.category, 20),
          addedAt: text(row.addedAt, 40),
        }
      })
      .filter((r) => r.ident)
      .sort((a, b) => b.addedAt.localeCompare(a.addedAt))
  }

  /**
   * The child puts something of the pool into the library: the pool entry itself, or one album of a pool artist.
   * Answer: added, or already (it is in the library already - nothing written).
   */
  async addToLibrary(
    poolId: string,
    albumId: string | undefined,
    category: LibraryCategory,
  ): Promise<'added' | 'already' | 'unknown' | 'locked'> {
    const entry = (await this.entries()).find((e) => e.id === poolId)
    if (!entry) return 'unknown'
    let what: { kind: PoolKind; spotifyId: string; feedUrl?: string; name: string; artist: string; cover: string } =
      entry
    if (albumId) {
      const album = entry.kind === 'artist' ? entry.albums?.find((a) => a.id === albumId) : undefined
      if (!album) return 'unknown'
      what = { kind: 'album', spotifyId: album.id, name: album.name, artist: entry.name, cover: album.cover }
    }
    const row = libraryRow(what, category, entry.id)
    const ident = identOf(row)
    const result = await withLock(this.deps.dataLock, 'search pool add', async () => {
      const data = await this.readLibrary()
      if (!data) throw new Error('library unreadable')
      if (data.some((r) => identOf(r) === ident)) return 'already' as const
      data.push(row)
      data.forEach((r, i) => {
        if (r && typeof r === 'object') r.index = i
      })
      await this.deps.writeLibrary(data)
      return 'added' as const
    })
    if (result === 'added')
      await this.note({
        what: 'added',
        kind: what.kind,
        name: what.name,
        artist: what.kind === 'album' ? what.artist : '',
        category,
      })
    return result
  }

  /** the child takes out what it put in itself (only rows marked kidAdded) */
  async removeOwn(ident: string): Promise<'removed' | 'unknown' | 'locked'> {
    let removed: Record<string, unknown> | undefined
    const result = await withLock(this.deps.dataLock, 'search pool remove', async () => {
      const data = await this.readLibrary()
      if (!data) throw new Error('library unreadable')
      const at = data.findIndex((r) => r?.kidAdded === true && identOf(r) === ident)
      if (at < 0) return 'unknown' as const
      removed = data[at]
      data.splice(at, 1)
      data.forEach((r, i) => {
        if (r && typeof r === 'object') r.index = i
      })
      await this.deps.writeLibrary(data)
      return 'removed' as const
    })
    if (result === 'removed' && removed) {
      const kind = (ident.split(':')[0] as PoolEvent['kind']) ?? 'album'
      const name =
        text(kind === 'album' || kind === 'playlist' ? removed.title : removed.artist) || text(removed.artist)
      const category = (LIBRARY_CATEGORIES as readonly string[]).includes(String(removed.category))
        ? (removed.category as LibraryCategory)
        : 'music'
      await this.note({ what: 'removed', kind, name, artist: kind === 'album' ? text(removed.artist) : '', category })
    }
    return result
  }

  // ---------- what happened, for Home Assistant ----------

  async events(): Promise<PoolEvent[]> {
    const list = await readJson<unknown>(this.eventsFile, [])
    return Array.isArray(list) ? (list as PoolEvent[]) : []
  }

  private async note(event: Omit<PoolEvent, 'id' | 'at'>): Promise<void> {
    await this.serial(async () => {
      const list = await this.events()
      const id = (list[list.length - 1]?.id ?? 0) + 1
      await writeJson(this.eventsFile, [...list, { id, at: new Date().toISOString(), ...event }].slice(-EVENTS_KEPT))
    })
    console.log(
      `${new Date().toLocaleString()}: [search-pool] ${event.what} ${event.kind} "${event.name}" (${event.category})`,
    )
  }
}

const isCategory = (v: unknown): v is LibraryCategory => (LIBRARY_CATEGORIES as readonly string[]).includes(String(v))

export function registerSearchPoolRoutes(app: Express, deps: SearchPoolDeps): SearchPool {
  const pool = new SearchPool(deps)
  const fail = (res: Parameters<RequestHandler>[1], status: number, error: string) => res.status(status).json({ error })

  // ---------- the display ----------

  /** GET /api/search-pool - the pool for the display's search (artists with their albums) */
  app.get('/api/search-pool', localOrElternSession, async (_req, res) => {
    // (no request to Spotify from here: the display asks every 30 s and each time it comes back to the search - the
    // albums are refreshed by the timer below)
    res.json({ entries: await pool.entries() })
  })

  // the pool artists' albums older than a day: checked every 6 hours (first 10 minutes after the start), in the
  // background one after the other - not when the display looks at the pool
  const refresh = () => void pool.entries().then((list) => pool.refreshStale(list), () => undefined)
  setTimeout(refresh, 10 * 60_000).unref()
  setInterval(refresh, 6 * 3600_000).unref()

  /** GET /api/search-pool/own - what the child put into the library (it may take these out again) */
  app.get('/api/search-pool/own', localOrElternSession, async (_req, res) => {
    res.json({ entries: await pool.own() })
  })

  /** POST /api/search-pool/add-to-library {poolId, albumId?, category} - only the box itself (the kiosk) */
  app.post('/api/search-pool/add-to-library', localOnly, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const poolId = text(b.poolId, 40)
    const albumId = b.albumId === undefined ? undefined : text(b.albumId, 40)
    if (!poolId || (albumId !== undefined && !SPOTIFY_ID.test(albumId)) || !isCategory(b.category))
      return fail(res, 400, 'invalid request')
    try {
      const result = await pool.addToLibrary(poolId, albumId, b.category)
      if (result === 'unknown') return fail(res, 404, 'not in the search pool')
      if (result === 'locked') return fail(res, 409, 'library busy')
      res.json({ ok: true, result })
    } catch (err) {
      console.error(`${new Date().toLocaleString()}: [search-pool] add failed:`, err)
      fail(res, 500, 'could not add')
    }
  })

  /** POST /api/search-pool/remove-own {ident} - only rows the child put in itself; only the box itself */
  app.post('/api/search-pool/remove-own', localOnly, async (req, res) => {
    const ident = text(req.body?.ident, 600)
    if (!/^(album|artist|playlist|show):[A-Za-z0-9]{22}$/.test(ident) && !/^podcast:\S{4,500}$/.test(ident))
      return fail(res, 400, 'invalid request')
    try {
      const result = await pool.removeOwn(ident)
      if (result === 'unknown') return fail(res, 404, 'not one of the child')
      if (result === 'locked') return fail(res, 409, 'library busy')
      res.json({ ok: true })
    } catch (err) {
      console.error(`${new Date().toLocaleString()}: [search-pool] remove failed:`, err)
      fail(res, 500, 'could not remove')
    }
  })

  // ---------- the parents' app ----------

  /** GET /api/app/search-pool - the pool and what the child put in */
  app.get('/api/app/search-pool', deps.session, async (_req, res) => {
    // (loading: an artist whose albums wait in the background queue)
    const entries = (await pool.entries()).map((e) => (pool.isQueued(e.id) ? { ...e, loading: true } : e))
    res.json({ entries, own: await pool.own(), appEnabled: deps.appEnabled?.() === true })
  })

  /** POST /api/app/search-pool/clear - "Alle Freigaben löschen": the whole pool (the child's start page entries stay) */
  app.post('/api/app/search-pool/clear', deps.session, deps.csrf, async (_req, res) => {
    res.json({ ok: true, removed: await pool.clear() })
  })

  /**
   * POST /api/app/search-pool {kind, spotifyId | feedUrl (podcast), name, artist?, cover?} - allowed in the search, not
   * on the start page
   */
  app.post('/api/app/search-pool', deps.session, deps.csrf, async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>
    const kind = b.kind as PoolKind
    const spotifyId = kind === 'podcast' ? '' : text(b.spotifyId, 40)
    const feedUrl = kind === 'podcast' ? text(b.feedUrl, 500) : undefined
    const name = text(b.name, 200)
    if (!POOL_KINDS.includes(kind) || !name) return fail(res, 400, 'invalid request')
    if (kind === 'podcast' ? !isFeedUrl(feedUrl ?? '') : !SPOTIFY_ID.test(spotifyId))
      return fail(res, 400, 'invalid request')
    if (kind === 'playlist' && isSpotifyOwnPlaylist(spotifyId)) return fail(res, 422, 'spotify_own_playlist')
    const cover = text(b.cover, 500)
    if (cover && !/^https?:\/\//.test(cover)) return fail(res, 400, 'invalid cover')
    const entry = await pool.add({
      kind,
      spotifyId,
      ...(feedUrl ? { feedUrl } : {}),
      name,
      artist: text(b.artist, 200),
      cover,
    })
    res.json({ ok: true, entry })
  })

  /** POST /api/app/search-pool/remove {id} */
  app.post('/api/app/search-pool/remove', deps.session, deps.csrf, async (req, res) => {
    const id = text(req.body?.id, 40)
    if (!id) return fail(res, 400, 'invalid request')
    res.json({ ok: await pool.remove(id) })
  })

  /** POST /api/app/search-pool/remove-own {ident} - the parents take off the start page what the child put there */
  app.post('/api/app/search-pool/remove-own', deps.session, deps.csrf, async (req, res) => {
    const ident = text(req.body?.ident, 600)
    if (!/^(album|artist|playlist|show):[A-Za-z0-9]{22}$/.test(ident) && !/^podcast:\S{4,500}$/.test(ident))
      return fail(res, 400, 'invalid request')
    try {
      const result = await pool.removeOwn(ident)
      if (result === 'unknown') return fail(res, 404, 'not one of the child')
      if (result === 'locked') return fail(res, 409, 'library busy')
      res.json({ ok: true })
    } catch (err) {
      console.error(`${new Date().toLocaleString()}: [search-pool] remove (parents) failed:`, err)
      fail(res, 500, 'could not remove')
    }
  })

  return pool
}
