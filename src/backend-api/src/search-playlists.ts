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
  /** songs into a playlist (at its end); answer: the playlist's new version (Spotify's snapshot_id), if it gave one */
  add(playlistId: string, uris: string[]): Promise<string | undefined>
  /** songs out of a playlist; answer as add */
  remove(playlistId: string, uris: string[]): Promise<string | undefined>
  /** the songs of a playlist of the account (200 at most) */
  items(playlistId: string): Promise<PlaylistSong[]>
  /** a playlist's picture as Spotify has it now ('' none yet) */
  cover(playlistId: string): Promise<string>
  /** out of the account's library (Spotify has no deleting: its owner just does not follow it any more) */
  unlist(playlistId: string): Promise<void>
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
  /** the start page's tab; '' - only allowed for the search, not on the start page */
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
  /**
   * the ids of the playlists the account owns or collaborates on (Spotify's /me/playlists, kept a while) - a playlist the
   * parents put on the start page themselves has no mark of its own
   */
  accountPlaylists?: () => Promise<Set<string>>
  /** the pictures of the account's playlists as Spotify has them now (one request for all - /me/playlists) */
  accountCovers?: () => Promise<Map<string, string>>
  /**
   * the versions of the account's playlists (Spotify's snapshot_id, from the same /me/playlists answer, kept a while) and
   * when they were read - a song list kept with the same version is still right (the ✓ asks nobody then)
   */
  accountSnapshots?: () => Promise<AccountSnapshots>
  now?: () => number
}

/**
 * the account's playlists as Spotify gave them (/me/playlists): when asked, their ids and versions; complete: all of them
 * (not cut off after the pages asked) - only then is one missing gone
 */
export interface AccountSnapshots {
  at: number
  snapshots: Map<string, string>
  ids?: Set<string>
  complete?: boolean
}

/** the songs of a playlist (their ids, in order) as Spotify had them in one version of it */
interface KeptSongs {
  snapshot: string
  ids: string[]
  at: number
}

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/
// Spotify's picture of a playlist: a mosaic of the covers of its first four songs, made a moment after a change
const MOSAIC_SONGS = 4
const MOSAIC_DELAY_MS = 60_000
// playlists gone from Spotify looked for at most once an hour (the search's list; the routine besides)
const PRUNE_EVERY_MS = 3600_000
// the routine for all pictures: every 6 hours, the first 10 minutes after the start
const COVERS_EVERY_MS = 6 * 3600_000
const COVERS_FIRST_MS = 10 * 60_000
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
/** "Kind darf eigene Playlists löschen" - and the right to take them out of the child's Spotify library */
export const LIBRARY_WRITE_SCOPE = 'user-library-modify'
export const deleteOn = (cfg: Record<string, unknown> | undefined): boolean => {
  const scopes = (cfg?.spotify as Record<string, unknown> | undefined)?.tokenScopes
  return (
    createOn(cfg) &&
    mupibox(cfg).displayPlaylistDelete === true &&
    Array.isArray(scopes) &&
    scopes.includes(LIBRARY_WRITE_SCOPE)
  )
}
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
  // the songs of the child's playlists as read last - for the ✓ at "In welche Playlist?": kept with the playlist's
  // version (search-playlists-songs.json, read anew only when Spotify has another); without a version 2 minutes
  private readonly songsKept = new Map<string, { at: number; ids: string[] }>()
  private readonly indexFile: string
  private index?: Record<string, KeptSongs>
  private indexQueue: Promise<unknown> = Promise.resolve()
  // when a playlist's picture was asked last (one without a picture: at most every 10 minutes)
  private readonly coverAsked = new Map<string, number>()
  private prunedAt = 0

  constructor(private readonly deps: SearchPlaylistsDeps) {
    this.file = path.join(deps.configDir, 'search-playlists.json')
    this.indexFile = path.join(deps.configDir, 'search-playlists-songs.json')
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
  async targets(): Promise<TargetPlaylist[]> {
    const rows = await this.deps.pool.ownPlaylists()
    // the account's playlists allowed for the search but not on the start page: songs may go there too
    const onPage = new Set(rows.map((r) => r.id))
    const pooled = (await this.deps.pool.entries())
      .filter((e) => e.kind === 'playlist' && SPOTIFY_ID.test(e.spotifyId) && !onPage.has(e.spotifyId))
      .map((e) => ({ id: e.spotifyId, name: e.name, cover: e.cover, category: '', kidAdded: false, own: e.own === true }))
    const all = [...rows, ...pooled]
    // (only asked when there is one without the mark; no answer - no login, a block: the marked ones only)
    const account = all.some((r) => !r.own) ? await this.deps.accountPlaylists?.().catch(() => undefined) : undefined
    const targets = all.filter((r) => r.own || account?.has(r.id)).map(({ own: _own, ...r }) => r)
    // (one without a picture - made by the child, empty then: asked again in the background, at most every 10 minutes)
    for (const t of targets) if (!t.cover) this.refreshCover(t.id, false)
    return targets
  }

  /**
   * A playlist's picture from Spotify into the library and the pool. Spotify makes the mosaic a moment after a song
   * went in or out: asked after a minute then (later); otherwise at most every 10 minutes per playlist.
   */
  refreshCover(playlistId: string, later: boolean): void {
    const run = async () => {
      if (!later) {
        const last = this.coverAsked.get(playlistId) ?? 0
        if (this.now() - last < 600_000) return
      }
      this.coverAsked.set(playlistId, this.now())
      const url = await this.deps
        .api()
        ?.cover(playlistId)
        .catch(() => '')
      if (url) await this.deps.pool.setPlaylistCover(playlistId, url).catch(() => undefined)
    }
    if (later) setTimeout(() => void run(), MOSAIC_DELAY_MS).unref?.()
    else void run()
  }

  /** the playlists the child made itself (only these it may delete) */
  async made(): Promise<string[]> {
    return [...new Set((await this.state()).created.map((c) => c.id))]
  }

  /**
   * "Ganz löschen": a playlist the child made itself off the start page, out of the search and out of its Spotify
   * library (Spotify keeps it, unfollowed - it is not shown to the child any more). Answer: deleted, not_made.
   */
  async remove(playlistId: string): Promise<'deleted' | 'not_made' | 'locked'> {
    if (!(await this.made()).includes(playlistId)) return 'not_made'
    await this.api().unlist(playlistId)
    await this.keepSongs(playlistId, undefined)
    const ident = `playlist:${playlistId}`
    const off = await this.deps.pool.removeOwn(ident)
    await this.deps.pool.removeByIdent(ident)
    return off === 'locked' ? 'locked' : 'deleted'
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
    const before = await this.songIds(playlistId, true)
    if (before.includes(t.id)) return 'already'
    const snapshot = await this.api().add(playlistId, [`spotify:track:${t.id}`])
    await this.keepSongs(playlistId, [...before, t.id], snapshot)
    // (its picture: Spotify's mosaic of the first songs' covers - a song at the end changes it only while there are few)
    if (before.length < MOSAIC_SONGS) this.refreshCover(playlistId, true)
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

  private async songIndex(): Promise<Record<string, KeptSongs>> {
    if (!this.index) {
      try {
        const read = JSON.parse(await fsp.readFile(this.indexFile, 'utf8')) as Record<string, KeptSongs>
        this.index = {}
        for (const [id, k] of Object.entries(read ?? {}))
          if (SPOTIFY_ID.test(id) && typeof k?.snapshot === 'string' && Array.isArray(k.ids) && typeof k.at === 'number')
            this.index[id] = { snapshot: k.snapshot, ids: k.ids.filter((x) => typeof x === 'string'), at: k.at }
      } catch {
        this.index = {}
      }
    }
    return this.index
  }

  /**
   * a playlist's songs as they are now: kept with its version (snapshot) - none: kept 2 minutes only; undefined:
   * forgotten (read anew next time)
   */
  private async keepSongs(playlistId: string, ids: string[] | undefined, snapshot?: string): Promise<void> {
    const index = await this.songIndex()
    if (ids) this.songsKept.set(playlistId, { at: this.now(), ids })
    else this.songsKept.delete(playlistId)
    const had = playlistId in index
    if (ids && snapshot) index[playlistId] = { snapshot, ids, at: this.now() }
    else if (had) delete index[playlistId]
    else return
    // (a cache, not in the backup: lost, the songs are read anew)
    const run = this.indexQueue.then(async () => {
      const tmp = `${this.indexFile}.tmp.${process.pid}.${Date.now()}`
      await fsp.writeFile(tmp, JSON.stringify(index))
      await fsp.rename(tmp, this.indexFile)
    })
    this.indexQueue = run.catch(() => undefined)
    await run.catch(() => undefined)
  }

  /**
   * The songs of a playlist (their ids, in order): as kept while Spotify has the same version of it (asked with the
   * account's playlists, one request for all, kept a while) - or the box changed it itself since that answer. Only
   * another version - a song put in or out in the Spotify app - reads the songs anew. fresh: read now (before a song
   * goes in: the account's answer may be minutes old, and a song twice in it is no good)
   */
  private async songIds(playlistId: string, fresh = false): Promise<string[]> {
    const account = await this.deps.accountSnapshots?.().catch(() => undefined)
    const snapshot = account?.snapshots.get(playlistId)
    const kept = (await this.songIndex())[playlistId]
    if (!fresh && account && snapshot && kept && (kept.snapshot === snapshot || kept.at > account.at)) return kept.ids
    if (!fresh && !snapshot) {
      const have = this.songsKept.get(playlistId)
      if (have && this.now() - have.at < 120_000) return have.ids
    }
    const ids = (await this.api().items(playlistId)).map((s) => s.id)
    await this.keepSongs(playlistId, ids, snapshot)
    return ids
  }

  /** the child's playlists the song is in already (the ✓ at "In welche Playlist?") */
  async containing(trackId: string): Promise<string[]> {
    const out: string[] = []
    for (const p of await this.targets()) if ((await this.songIds(p.id)).includes(trackId)) out.push(p.id)
    return out
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

  /**
   * An approval of a song taken back: out of the playlist it went into (target) and out of the child's own playlists -
   * unless another approval lets the child play it still (its album or its whole artist on the box or allowed). Answer:
   * the playlists it was taken out of; still: it stays allowed.
   */
  async revoke(t: TrackRef, target?: string): Promise<{ removed: string[]; still: boolean }> {
    const approved = await this.approved()
    approved.delete(t.id)
    const still = trackAllowed(t, await this.deps.pool.onBox(), await this.deps.pool.entries(), approved)
    const removed: string[] = []
    if (!still) {
      for (const p of await this.targets()) {
        // (the parents' own playlists only where the approval put it - what they put there themselves stays)
        if (!p.kidAdded && p.id !== target) continue
        const ids = await this.songIds(p.id)
        if (!ids.includes(t.id)) continue
        const snapshot = await this.api().remove(p.id, [`spotify:track:${t.id}`])
        await this.keepSongs(
          p.id,
          ids.filter((x) => x !== t.id),
          snapshot,
        )
        this.refreshCover(p.id, true)
        removed.push(p.name)
      }
    }
    await this.forget(t.id)
    return { removed, still }
  }

  /** the approval of a song forgotten (it is not allowed at once any more) */
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
    const songs = await this.api().items(playlistId)
    // (read anyway: kept for the ✓ with the version Spotify has now)
    const account = await this.deps.accountSnapshots?.().catch(() => undefined)
    await this.keepSongs(
      playlistId,
      songs.map((s) => s.id),
      account?.snapshots.get(playlistId),
    )
    return songs
  }

  /**
   * The routine: the pictures of the account's playlists on the start page (the child's and its own) as Spotify has them
   * now - also what was changed in the Spotify app. One request for all of them.
   */
  /**
   * The account's own playlists gone from Spotify (deleted in the Spotify app, or on another device): out of the search
   * (the pool) and off the start page where the child put them - they play nothing any more. Only from a complete
   * answer of Spotify, and only what was there before that answer (one made a minute ago is not in it yet). Answer: the
   * ids taken out.
   */
  async pruneGone(force = false): Promise<string[]> {
    if (!force && this.now() - this.prunedAt < PRUNE_EVERY_MS) return []
    this.prunedAt = this.now()
    const account = await this.deps.accountSnapshots?.().catch(() => undefined)
    const ids = account?.ids
    if (!account?.complete || !ids) return []
    const before = (at: string | undefined) => {
      const t = Date.parse(at ?? '')
      return Number.isFinite(t) && t < account.at
    }
    const entries = await this.deps.pool.entries()
    const rows = await this.deps.pool.ownPlaylists()
    // (still in the search or on the start page - one taken out before is not looked at again)
    const shown = new Set([...entries.filter((e) => e.kind === 'playlist').map((e) => e.spotifyId), ...rows.map((r) => r.id)])
    const gone = new Set<string>()
    for (const e of entries)
      if (e.kind === 'playlist' && e.own === true && !ids.has(e.spotifyId) && before(e.addedAt)) gone.add(e.spotifyId)
    for (const c of (await this.state()).created)
      if (shown.has(c.id) && !ids.has(c.id) && before(c.at)) gone.add(c.id)
    for (const id of gone) {
      const ident = `playlist:${id}`
      // (off the start page only where the child put it - what the parents put there, they take off themselves)
      if (rows.some((r) => r.id === id && r.kidAdded))
        await this.deps.pool.removeOwn(ident, false).catch(() => undefined)
      await this.deps.pool.removeByIdent(ident).catch(() => undefined)
      await this.keepSongs(id, undefined)
    }
    return [...gone]
  }

  async refreshAllCovers(): Promise<void> {
    const covers = await this.deps.accountCovers?.().catch(() => undefined)
    if (!covers) return
    for (const p of await this.deps.pool.ownPlaylists()) {
      const url = covers.get(p.id)
      if (url && url !== p.cover) await this.deps.pool.setPlaylistCover(p.id, url).catch(() => undefined)
    }
  }

  /** a song out of a playlist the child put on the start page itself */
  async takeOut(playlistId: string, song: { id: string; name: string }): Promise<'removed' | 'not_own'> {
    const target = (await this.targets()).find((p) => p.id === playlistId && p.kidAdded)
    if (!target) return 'not_own'
    // (its picture changes when one of the first songs goes - they make the mosaic)
    const ids = await this.songIds(playlistId)
    const at = ids.indexOf(song.id)
    const snapshot = await this.api().remove(playlistId, [`spotify:track:${song.id}`])
    await this.keepSongs(
      playlistId,
      ids.filter((x) => x !== song.id),
      snapshot,
    )
    if (at >= 0 && at < MOSAIC_SONGS) this.refreshCover(playlistId, true)
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
    // (a playlist deleted in the Spotify app: out of the search before the list is shown - at most once an hour)
    await playlists.pruneGone().catch(() => undefined)
    res.json({
      on,
      create: createOn(cfg()),
      tracks,
      left: createOn(cfg()) ? await playlists.left() : 0,
      targets: await playlists.targets(),
      // (the ones the child may delete: those it made itself, with "Kind darf eigene Playlists löschen" on)
      deletable: deleteOn(cfg()) ? await playlists.made() : [],
    })
  })

  /** POST /api/search-playlists/delete {id} - "Ganz löschen" of a playlist the child made itself */
  app.post('/api/search-playlists/delete', localOnly, async (req, res) => {
    if (!deleteOn(cfg())) return fail(res, 403, 'off')
    const id = String(req.body?.id ?? '')
    if (!SPOTIFY_ID.test(id)) return fail(res, 400, 'invalid_request')
    try {
      const r = await playlists.remove(id)
      if (r === 'not_made') return fail(res, 403, 'not_made')
      if (r === 'locked') return fail(res, 409, 'library_busy')
      res.json({ ok: true })
    } catch (err) {
      failed(res, err, 'delete')
    }
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

  /** GET /api/search-playlists/containing?id= - the child's playlists on the start page a song is in already */
  app.get('/api/search-playlists/containing', localOnly, async (req, res) => {
    if (!tracksOn(cfg())) return fail(res, 403, 'off')
    const id = String(req.query.id ?? '')
    if (!SPOTIFY_ID.test(id)) return fail(res, 400, 'invalid_request')
    try {
      res.json({ in: await playlists.containing(id) })
    } catch (err) {
      failed(res, err, 'containing')
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

  // the pictures of the child's playlists: a routine every 6 hours (only with the playlists' switches on)
  const covers = () => {
    if (playlistsOn(cfg()) || tracksOn(cfg())) {
      void playlists.refreshAllCovers()
      void playlists.pruneGone(true).catch(() => undefined)
    }
  }
  setTimeout(covers, COVERS_FIRST_MS).unref?.()
  setInterval(covers, COVERS_EVERY_MS).unref?.()

  return playlists
}
