// Playlists in the display's search (search-playlists.ts): the switches, a new playlist of the child (private, at most so
// many a day), songs into a playlist of its own (at once when it can play them already, else a wish the parents
// approve), songs taken out - all with an invented Spotify (nothing leaves the test).
import assert from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import {
  type PlaylistSong,
  type PlaylistsApi,
  playlistName,
  registerSearchPlaylistsRoutes,
  type SearchPlaylists,
  trackAllowed,
} from './search-playlists'
import { registerSearchPoolRoutes, type SearchPool } from './search-pool'
import { registerWishesRoutes } from './wishes'

const ALBUM = 'B'.repeat(22)
const ARTIST = 'A'.repeat(22)
const SONG = 'S'.repeat(22)
const OTHER_SONG = 'T'.repeat(22)
const ALLOWED_PL = 'P'.repeat(22)
// (a playlist of the account the parents put on the start page themselves - no mark of its own)
const ACCOUNT_PL = 'Q'.repeat(22)

let dir: string
let dataFile: string
let cfg: Record<string, unknown>
let pool: SearchPool
let playlists: SearchPlaylists
let app: express.Express
let calls: string[]
let songs: Map<string, PlaylistSong[]>
let day = 0

const library = () => JSON.parse(readFileSync(dataFile, 'utf8')) as Record<string, unknown>[]

const api: PlaylistsApi = {
  create: async (name) => {
    calls.push(`create ${name}`)
    const id = `N${calls.length}`.padEnd(22, 'x')
    songs.set(id, [])
    return { id }
  },
  add: async (id, uris) => {
    calls.push(`add ${id} ${uris.join(',')}`)
    for (const uri of uris) songs.get(id)?.push({ id: uri.split(':').pop() ?? '', name: uri, artist: '', cover: '' })
  },
  remove: async (id, uris) => {
    calls.push(`remove ${id} ${uris.join(',')}`)
    songs.set(
      id,
      (songs.get(id) ?? []).filter((s) => !uris.includes(`spotify:track:${s.id}`)),
    )
  },
  items: async (id) => songs.get(id) ?? [],
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-playlists-test-'))
  dataFile = path.join(dir, 'data.json')
  writeFileSync(
    dataFile,
    JSON.stringify([{ type: 'spotify', category: 'music', id: ALBUM, title: 'Album', artist: 'X', index: 0 }]),
  )
  calls = []
  songs = new Map()
  day = Date.parse('2026-11-23T10:00:00')
  cfg = {
    mupibox: {
      displaySearch: true,
      displayWishes: true,
      displayPlaylists: true,
      displayPlaylistCreate: true,
      displayTracks: true,
      playlistsPerDay: 2,
    },
    spotify: { tokenScopes: ['playlist-read-private', 'playlist-modify-private'] },
  }
  app = express()
  app.use(express.json())
  const session = (_req: express.Request, _res: express.Response, next: express.NextFunction) => next()
  pool = registerSearchPoolRoutes(app, {
    configDir: dir,
    dataFile,
    dataLock: path.join(dir, '.data.lock'),
    writeLibrary: async (data) => writeFileSync(dataFile, JSON.stringify(data)),
    spotify: () => undefined,
    session,
    csrf: session,
  })
  playlists = registerSearchPlaylistsRoutes(app, {
    configDir: dir,
    pool,
    getMupiboxConfig: () => cfg,
    api: () => api,
    accountPlaylists: async () => new Set([ACCOUNT_PL]),
    now: () => day,
  })
  registerWishesRoutes(app, {
    configDir: dir,
    cacheDir: path.join(dir, 'cache'),
    pool,
    getMupiboxConfig: () => cfg,
    searchPage: async (_q, _offset, tracks) => ({
      albums: [],
      artists: [],
      shows: [],
      tracks: tracks
        ? [
            { id: SONG, name: 'Erlaubter Song', artist: 'X', cover: '', albumId: ALBUM, artistId: ARTIST },
            {
              id: OTHER_SONG,
              name: 'Neuer Song',
              artist: 'Y',
              cover: '',
              albumId: 'C'.repeat(22),
              artistId: 'D'.repeat(22),
            },
            { id: 'E'.repeat(22), name: 'Grober Song', artist: 'Z', cover: '', explicit: true },
          ]
        : [],
      more: false,
    }),
    albumTracks: async () => ({
      artistId: ARTIST,
      cover: '',
      tracks: [
        { id: SONG, name: 'Erlaubter Song', artist: 'X' },
        { id: 'F'.repeat(22), name: 'Grob', artist: 'X', explicit: true },
      ],
    }),
    playlists,
    tracksOn: () => true,
    session,
    csrf: session,
  })
})

describe('trackAllowed / playlistName', () => {
  it('allows a song whose album or whole artist is on the box or allowed, or that was approved', () => {
    const box = { idents: new Set([`album:${ALBUM}`]), names: new Set<string>() }
    assert.equal(trackAllowed({ id: SONG, name: '', artist: '', cover: '', albumId: ALBUM }, box, [], new Set()), true)
    assert.equal(
      trackAllowed({ id: SONG, name: '', artist: '', cover: '', albumId: 'C'.repeat(22) }, box, [], new Set()),
      false,
    )
    const pool = [{ id: 'p', kind: 'artist' as const, spotifyId: ARTIST, name: '', artist: '', cover: '', addedAt: '' }]
    assert.equal(
      trackAllowed({ id: SONG, name: '', artist: '', cover: '', artistId: ARTIST }, box, pool, new Set()),
      true,
    )
    assert.equal(trackAllowed({ id: SONG, name: '', artist: '', cover: '' }, box, [], new Set([SONG])), true)
  })

  it('takes a name of one line, 40 characters at most', () => {
    assert.equal(playlistName('  Meine\n  Lieder  '), 'Meine Lieder')
    assert.equal(playlistName('x'.repeat(60)).length, 40)
    assert.equal(playlistName(5), '')
  })
})

describe('a new playlist', () => {
  it('is made private in the child account and put on the start page under the tab', async () => {
    const r = await request(app).post('/api/search-playlists/create').send({ name: 'Meine Lieder', category: 'music' })
    assert.equal(r.status, 200)
    assert.deepEqual(calls, ['create Meine Lieder'])
    const row = library().find((x) => x.playlistid === r.body.id)
    assert.equal(row?.kidAdded, true)
    assert.equal(row?.own, true)
    assert.equal(row?.category, 'music')
    const events = await pool.events()
    assert.equal(events[events.length - 1]?.what, 'created')
  })

  it('is made once for the same name on a day, and no more than allowed a day', async () => {
    await request(app).post('/api/search-playlists/create').send({ name: 'Eins', category: 'music' })
    const again = await request(app).post('/api/search-playlists/create').send({ name: 'eins', category: 'music' })
    assert.equal(again.body.result, 'already')
    await request(app).post('/api/search-playlists/create').send({ name: 'Zwei', category: 'music' })
    const third = await request(app).post('/api/search-playlists/create').send({ name: 'Drei', category: 'music' })
    assert.equal(third.status, 429)
    assert.equal(calls.length, 2)
    // (the next day: again)
    day += 24 * 3600_000
    const next = await request(app).post('/api/search-playlists/create').send({ name: 'Drei', category: 'music' })
    assert.equal(next.status, 200)
  })

  it('is not made with the switch off or without the right to change playlists', async () => {
    ;(cfg.mupibox as Record<string, unknown>).displayPlaylistCreate = false
    assert.equal(
      (await request(app).post('/api/search-playlists/create').send({ name: 'X', category: 'music' })).status,
      403,
    )
    ;(cfg.mupibox as Record<string, unknown>).displayPlaylistCreate = true
    cfg.spotify = { tokenScopes: ['playlist-read-private'] }
    assert.equal(
      (await request(app).post('/api/search-playlists/create').send({ name: 'X', category: 'music' })).status,
      403,
    )
    assert.deepEqual(calls, [])
  })
})

describe('songs', () => {
  const target = async () => {
    const r = await request(app).post('/api/search-playlists/create').send({ name: 'Ziel', category: 'music' })
    return String(r.body.id)
  }

  it('come in the Spotify search without the explicit ones, the playable one marked', async () => {
    const r = await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    const tracks = (r.body.items as { kind: string; id: string; allowed?: boolean }[]).filter((i) => i.kind === 'track')
    assert.deepEqual(
      tracks.map((t) => [t.id, t.allowed]),
      [
        [SONG, true],
        [OTHER_SONG, false],
      ],
    )
  })

  it('stand in front of the first page; an album the box knows gives its songs, explicit ones never', async () => {
    const r = await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    assert.equal((r.body.items as { kind: string }[])[0]?.kind, 'track')
    const album = await request(app).get('/api/wishes/album').query({ id: ALBUM })
    assert.deepEqual(
      (album.body.items as { id: string; allowed?: boolean }[]).map((i) => [i.id, i.allowed]),
      [[SONG, true]],
    )
    // (an album the box does not know: not asked)
    assert.equal(
      (
        await request(app)
          .get('/api/wishes/album')
          .query({ id: 'C'.repeat(22) })
      ).status,
      403,
    )
  })

  it('one the child can play goes into its playlist at once - once', async () => {
    const id = await target()
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    const r = await request(app).post('/api/wishes/track').send({ id: SONG, playlist: id })
    assert.equal(r.body.result, 'added')
    const again = await request(app).post('/api/wishes/track').send({ id: SONG, playlist: id })
    assert.equal(again.body.result, 'already')
    assert.equal(calls.filter((c) => c.startsWith('add')).length, 1)
  })

  it('one it cannot play yet is wished for the playlist; approved, it goes in and is allowed from then on', async () => {
    const id = await target()
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    assert.equal((await request(app).post('/api/wishes/track').send({ id: OTHER_SONG, playlist: id })).status, 403)
    const w = await request(app).post('/api/wishes').send({ kind: 'track', id: OTHER_SONG, playlist: id })
    assert.equal(w.body.result, 'wished')
    const open = (await request(app).get('/api/app/wishes')).body.open as { id: string; target?: { id: string } }[]
    assert.equal(open[0]?.target?.id, id)
    const d = await request(app).post('/api/app/wishes/decide').send({ id: open[0].id, approve: true })
    assert.equal(d.body.result, 'approved')
    assert.ok(calls.includes(`add ${id} spotify:track:${OTHER_SONG}`))
    assert.equal(await playlists.allowed({ id: OTHER_SONG, name: '', artist: '', cover: '' }), true)
    // (nothing on the start page for a song)
    assert.equal(library().filter((x) => x.kidAdded).length, 1)
  })

  it('go into a playlist of the account the parents put on the start page, as Spotify knows it', async () => {
    const lib = library()
    lib.push({ type: 'spotify', category: 'music', playlistid: ACCOUNT_PL, title: 'Mixtape', index: lib.length })
    writeFileSync(dataFile, JSON.stringify(lib))
    const targets = (await request(app).get('/api/search-playlists')).body.targets as { id: string }[]
    assert.ok(targets.some((t) => t.id === ACCOUNT_PL))
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    assert.equal(
      (await request(app).post('/api/wishes/track').send({ id: SONG, playlist: ACCOUNT_PL })).body.result,
      'added',
    )
    // (but no songs taken out of it by the child: the parents put it there)
    assert.equal((await request(app).get('/api/search-playlists/songs').query({ id: ACCOUNT_PL })).status, 403)
  })

  it('cannot go into a playlist that is not one of the child account on the start page', async () => {
    await pool.add({ kind: 'playlist', spotifyId: ALLOWED_PL, name: 'Gefolgt', artist: '', cover: '', own: false })
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    const r = await request(app).post('/api/wishes/track').send({ id: SONG, playlist: ALLOWED_PL })
    assert.equal(r.status, 409)
  })

  it('are taken out of a playlist the child put on the start page itself only', async () => {
    const id = await target()
    songs.get(id)?.push({ id: SONG, name: 'Erlaubter Song', artist: 'X', cover: '' })
    const list = await request(app).get('/api/search-playlists/songs').query({ id })
    assert.equal(list.body.songs.length, 1)
    const out = await request(app)
      .post('/api/search-playlists/take-out')
      .send({ playlistId: id, id: SONG, name: 'Erlaubter Song' })
    assert.equal(out.status, 200)
    assert.equal(songs.get(id)?.length, 0)
    // (a playlist of the parents' on the start page: not the child's to change)
    const lib = library()
    lib.push({
      type: 'spotify',
      category: 'music',
      playlistid: ALLOWED_PL,
      title: 'Eltern',
      own: true,
      index: lib.length,
    })
    writeFileSync(dataFile, JSON.stringify(lib))
    assert.equal((await request(app).get('/api/search-playlists/songs').query({ id: ALLOWED_PL })).status, 403)
  })

  it('stay off with the switches off: the display gets nothing to show', async () => {
    cfg.mupibox = { displaySearch: true, displayWishes: true }
    const r = await request(app).get('/api/search-playlists')
    assert.equal(r.body.on, false)
    assert.equal(r.body.tracks, false)
    assert.equal((await request(app).get('/api/search-playlists/songs').query({ id: ALLOWED_PL })).status, 403)
  })
})
