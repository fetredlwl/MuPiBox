// (fork "wishes") Playlists in the display's search (konzept-playlists.md):
// - "Playlists": the playlists the parents allowed for the search (the pool's, "Nur in der Suche" in "Meine Playlists")
//   - the child puts them on the start page as anything of the pool;
// - "Neue Playlist": the child makes a playlist in its own Spotify account - always private - and puts it on the start
//   page under a tab of its choice (at most so many a day, set in the app);
// - single songs of the Spotify search go into a playlist of the child's own account that is on the start page: at once
//   when the child can play the song already (its album or its whole artist is on the box or allowed, or it was
//   approved before), else as a wish the parents decide (wishes.ts);
// - the child takes songs out of a playlist it put on the start page itself.
//
// Switched on in the app (Bedienung › Suche): "Playlists in der Suche" (mupibox.displayPlaylists), "Kind darf Playlists
// anlegen" (displayPlaylistCreate, with playlistsPerDay), "Einzelne Songs aus Spotify" (displayTracks, with the wishes
// on). Making and changing playlists needs the right playlist-modify-private: asked at the login only with one of the
// last two on (eltern/oauth.ts). Off: nothing here answers but "off", the box is as before.

import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { Express, RequestHandler } from 'express'
import { backupBeforeWrite } from './file-backup'
import { localOnly } from './request-guard'
import { LIBRARY_CATEGORIES, type OnBox, type PoolEntry, type SearchPool } from './search-pool'

type Category = (typeof LIBRARY_CATEGORIES)[number]

/** what the box asks of Spotify for the playlists (the child's account) - search-playlists-api in server.ts */
export interface PlaylistsApi {
  /** a new private playlist in the child's account */
  create(name: string): Promise<{ id: string }>
  /** songs into a playlist (at its end) */
  add(playlistId: string, uris: string[]): Promise<void>
  /** songs out of a playlist */
  remove(playlistId: string, uris: string[]): Promise<void>
  /** the songs of a playlist of the account (200 at most) */
  items(playlistId: string): Promise<PlaylistSong[]>
}

export interface PlaylistSong {
  id: string
  name: string
  artist: string
  cover: string
}

/** a song found on Spotify (wishes.ts hands it out with the search pages) */
export interface TrackRef {
  id: string
  name: string
  artist: string
  cover: string
  albumId?: string
  artistId?: string
}

/** a playlist of the child's own account on the start page: where a song may go */
export interface TargetPlaylist {
  id: string
  name: string
  cover: string
  category: string
  /** put there by the child itself: it may take songs out of it */
  kidAdded: boolean
}

interface ApprovedTrack {
  id: string
  name: string
  artist: string
  at: string
}

interface State {
  created: { at: string; day: string; id: string; name: string }[]
  tracks: ApprovedTrack[]
}

export interface SearchPlaylistsDeps {
  configDir: string
  pool: SearchPool
  getMupiboxConfig: () => Record<string, unknown> | undefined
  /** Spotify for the child's account; undefined: no Spotify login on the box */
  api: () => PlaylistsApi | undefined
  now?: () => number
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
const CREATED_KEPT = 200
const APPROVED_KEPT = 2000
export const PLAYLIST_WRITE_SCOPE = 'playlist-modify-private'

const mupibox = (cfg: Record<string, unknown> | undefined) => (cfg?.mupibox ?? {}) as Record<string, unknown>
export const playlistsOn = (cfg: Record<string, unknown> | undefined): boolean =>
  mupibox(cfg).displaySearch === true && mupibox(cfg).displayPlaylists === true
/** the right to change the child's playlists was given at the last login */
export const writeScope = (cfg: Record<string, unknown> | undefined): boolean => {
  const scopes = (cfg?.spotify as Record<string, unknown> | undefined)?.tokenScopes
  return Array.isArray(scopes) && scopes.includes(PLAYLIST_WRITE_SCOPE)
}
export const createOn = (cfg: Record<string, unknown> | undefined): boolean =>
  playlistsOn(cfg) && mupibox(cfg).displayPlaylistCreate === true && writeScope(cfg)
/** single songs in the Spotify search (the wishes on too) */
export const tracksOn = (cfg: Record<string, unknown> | undefined): boolean =>
  mupibox(cfg).displaySearch === true &&
  mupibox(cfg).displayWishes === true &&
  mupibox(cfg).displayTracks === true &&
  writeScope(cfg)
export const perDay = (cfg: Record<string, unknown> | undefined): number => {
  const n = Number(mupibox(cfg).playlistsPerDay)
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : 5
}

/**
 * Whether the child can play the song already (konzept-playlists.md, decision 2): its album or its whole artist is on
 * the box or allowed in the search, or the song was approved before.
 */
export function trackAllowed(t: TrackRef, box: OnBox, pool: PoolEntry[], approved: Set<string>): boolean {
  if (approved.has(t.id)) return true
  if (t.albumId && box.idents.has(`album:${t.albumId}`)) return true
  if (t.artistId && box.idents.has(`artist:${t.artistId}`)) return true
  return pool.some(
    (e) =>
      (e.kind === 'album' && !!t.albumId && e.spotifyId === t.albumId) ||
      (e.kind === 'artist' &&
        ((!!t.artistId && e.spotifyId === t.artistId) || (!!t.albumId && !!e.albums?.some((a) => a.id === t.albumId)))),
  )
}

/** a playlist's name as the child typed it: printable, one line, 1 to 40 characters */
export function playlistName(v: unknown): string {
  if (typeof v !== 'string') return ''
  return v
    .replace(/[\p{C}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

const dayOf = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export class SearchPlaylists {
  private readonly file: string
  private readonly now: () => number
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: SearchPlaylistsDeps) {
    this.file = path.join(deps.configDir, 'search-playlists.json')
    this.now = deps.now ?? Date.now
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work)
    this.queue = run.catch(() => undefined)
    return run
  }

  private async state(): Promise<State> {
    try {
      const s = JSON.parse(await fsp.readFile(this.file, 'utf8')) as Partial<State>
      return {
        created: Array.isArray(s.created) ? s.created : [],
        tracks: Array.isArray(s.tracks) ? s.tracks : [],
      }
    } catch {
      return { created: [], tracks: [] }
    }
  }

  private async save(s: State): Promise<void> {
    // (with the copies data.json has: before the last write, and one a day for 7 days - backup/)
    backupBeforeWrite(this.file)
    const tmp = `${this.file}.tmp.${process.pid}.${Date.now()}`
    await fsp.writeFile(tmp, JSON.stringify(s, null, 1))
    await fsp.rename(tmp, this.file)
  }

  private api(): PlaylistsApi {
    const api = this.deps.api()
    if (!api) throw Object.assign(new Error('no Spotify'), { status: 503 })
    return api
  }

  /** the playlists of the child's account on the start page (songs may go into them) */
  targets(): Promise<TargetPlaylist[]> {
    return this.deps.pool.ownPlaylists()
  }

  /** how many playlists the child may still make today */
  async left(): Promise<number> {
    const today = dayOf(this.now())
    const made = (await this.state()).created.filter((c) => c.day === today).length
    return Math.max(0, perDay(this.deps.getMupiboxConfig()) - made)
  }

  /** the songs approved before (their ids) */
  async approved(): Promise<Set<string>> {
    return new Set((await this.state()).tracks.map((t) => t.id))
  }

  async allowed(t: TrackRef): Promise<boolean> {
    return trackAllowed(t, await this.deps.pool.onBox(), await this.deps.pool.entries(), await this.approved())
  }

  /**
   * "Neue Playlist": a private playlist in the child's account, on the start page under the tab it chose. The same name
   * twice on one day: the one of before (nothing made). Answer: created, already (the same name today), limit (none left
   * today).
   */
  async create(
    name: string,
    category: Category,
  ): Promise<{ result: 'created' | 'already' | 'limit' | 'locked'; id?: string }> {
    return this.serial(async () => {
      const s = await this.state()
      const today = dayOf(this.now())
      const same = s.created.find((c) => c.day === today && c.name.toLowerCase() === name.toLowerCase())
      if (same) return { result: 'already' as const, id: same.id }
      if (s.created.filter((c) => c.day === today).length >= perDay(this.deps.getMupiboxConfig()))
        return { result: 'limit' as const }
      const { id } = await this.api().create(name)
      if (!SPOTIFY_ID.test(id)) throw new Error('Spotify gave no playlist')
      // (noted before the library: a failed write there does not make it twice when the child tries again)
      s.created = [...s.created, { at: new Date(this.now()).toISOString(), day: today, id, name }].slice(-CREATED_KEPT)
      await this.save(s)
      const r = await this.deps.pool.addCreatedPlaylist({ spotifyId: id, name, cover: '' }, category)
      return { result: r === 'locked' ? ('locked' as const) : ('created' as const), id }
    })
  }

  /**
   * A song into a playlist of the child's own on the start page. Answer: added, already (it is in it), no_target (not
   * such a playlist).
   */
  async put(t: TrackRef, playlistId: string, told = true): Promise<'added' | 'already' | 'no_target'> {
    const target = (await this.targets()).find((p) => p.id === playlistId)
    if (!target) return 'no_target'
    const api = this.api()
    if ((await api.items(playlistId)).some((s) => s.id === t.id)) return 'already'
    await api.add(playlistId, [`spotify:track:${t.id}`])
    if (told)
      await this.deps.pool.announce({
        what: 'added',
        kind: 'track',
        name: t.name,
        artist: t.artist,
        category: (target.category as Category) || 'music',
        playlist: target.name,
      })
    return 'added'
  }

  /** a song the parents approved: into the playlist the child chose, and remembered (next time at once) */
  async approve(t: TrackRef, playlistId: string): Promise<'added' | 'already' | 'no_target'> {
    const r = await this.put(t, playlistId, false)
    if (r === 'no_target') return r
    await this.serial(async () => {
      const s = await this.state()
      if (!s.tracks.some((x) => x.id === t.id))
        s.tracks = [
          ...s.tracks,
          { id: t.id, name: t.name, artist: t.artist, at: new Date(this.now()).toISOString() },
        ].slice(-APPROVED_KEPT)
      await this.save(s)
    })
    return r
  }

  /** an approval of a song taken back: not at once any more (it stays in the playlist it went into) */
  async forget(trackId: string): Promise<void> {
    await this.serial(async () => {
      const s = await this.state()
      const rest = s.tracks.filter((t) => t.id !== trackId)
      if (rest.length !== s.tracks.length) await this.save({ ...s, tracks: rest })
    })
  }

  /** the songs of a playlist the child put on the start page itself (it may take them out) */
  async songs(playlistId: string): Promise<PlaylistSong[] | 'not_own'> {
    const target = (await this.targets()).find((p) => p.id === playlistId && p.kidAdded)
    if (!target) return 'not_own'
    return this.api().items(playlistId)
  }

  /** a song out of a playlist the child put on the start page itself */
  async takeOut(playlistId: string, song: { id: string; name: string }): Promise<'removed' | 'not_own'> {
    const target = (await this.targets()).find((p) => p.id === playlistId && p.kidAdded)
    if (!target) return 'not_own'
    await this.api().remove(playlistId, [`spotify:track:${song.id}`])
    await this.deps.pool.announce({
      what: 'removed',
      kind: 'track',
      name: song.name,
      artist: '',
      category: (target.category as Category) || 'music',
      playlist: target.name,
    })
    return 'removed'
  }
}

const isCategory = (v: unknown): v is Category => (LIBRARY_CATEGORIES as readonly string[]).includes(String(v))

export function registerSearchPlaylistsRoutes(app: Express, deps: SearchPlaylistsDeps): SearchPlaylists {
  const playlists = new SearchPlaylists(deps)
  const fail = (res: Parameters<RequestHandler>[1], status: number, error: string) =>
    void res.status(status).json({ error })
  const failed = (res: Parameters<RequestHandler>[1], err: unknown, what: string) => {
    if ((err as { status?: number })?.status === 503) return fail(res, 503, 'spotify_unavailable')
    const detail = (err as { detail?: { kind?: string } })?.detail
    if (detail?.kind === 'rate-limit') return fail(res, 503, 'spotify_blocked')
    console.error(`${new Date().toLocaleString()}: [search-playlists] ${what}:`, err)
    fail(res, 502, 'spotify_failed')
  }
  const cfg = () => deps.getMupiboxConfig()

  /**
   * GET /api/search-playlists - for the display: whether the tile "Playlists" shows, whether the child may make one and
   * how many it may still make today, and the playlists of its own account on the start page
   */
  app.get('/api/search-playlists', localOnly, async (_req, res) => {
    const on = playlistsOn(cfg())
    const tracks = tracksOn(cfg())
    if (!on && !tracks) return void res.json({ on: false, create: false, tracks: false, left: 0, targets: [] })
    res.json({
      on,
      create: createOn(cfg()),
      tracks,
      left: createOn(cfg()) ? await playlists.left() : 0,
      targets: await playlists.targets(),
    })
  })

  /** POST /api/search-playlists/create {name, category} - "Neue Playlist" (private, in the child's account) */
  app.post('/api/search-playlists/create', localOnly, async (req, res) => {
    if (!createOn(cfg())) return fail(res, 403, 'off')
    const name = playlistName(req.body?.name)
    if (!name || !isCategory(req.body?.category)) return fail(res, 400, 'invalid_request')
    try {
      const r = await playlists.create(name, req.body.category)
      if (r.result === 'limit') return fail(res, 429, 'limit')
      if (r.result === 'locked') return fail(res, 409, 'library_busy')
      res.json({ ok: true, ...r })
    } catch (err) {
      failed(res, err, 'create')
    }
  })

  /** GET /api/search-playlists/songs?id= - the songs of a playlist the child put on the start page itself */
  app.get('/api/search-playlists/songs', localOnly, async (req, res) => {
    if (!playlistsOn(cfg()) && !tracksOn(cfg())) return fail(res, 403, 'off')
    if (!writeScope(cfg())) return fail(res, 403, 'no_right')
    const id = String(req.query.id ?? '')
    if (!SPOTIFY_ID.test(id)) return fail(res, 400, 'invalid_request')
    try {
      const r = await playlists.songs(id)
      if (r === 'not_own') return fail(res, 403, 'not_own')
      res.json({ songs: r })
    } catch (err) {
      failed(res, err, 'songs')
    }
  })

  /** POST /api/search-playlists/take-out {playlistId, id, name} - a song out of one of the child's own playlists */
  app.post('/api/search-playlists/take-out', localOnly, async (req, res) => {
    if (!playlistsOn(cfg()) && !tracksOn(cfg())) return fail(res, 403, 'off')
    if (!writeScope(cfg())) return fail(res, 403, 'no_right')
    const playlistId = String(req.body?.playlistId ?? '')
    const id = String(req.body?.id ?? '')
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 200) : ''
    if (!SPOTIFY_ID.test(playlistId) || !SPOTIFY_ID.test(id)) return fail(res, 400, 'invalid_request')
    try {
      const r = await playlists.takeOut(playlistId, { id, name })
      if (r === 'not_own') return fail(res, 403, 'not_own')
      res.json({ ok: true })
    } catch (err) {
      failed(res, err, 'take out')
    }
  })

  return playlists
}
