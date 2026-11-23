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
// (the versions of the account's playlists as Spotify gives them with /me/playlists - none: unknown)
let snaps: Map<string, string>
let snapsAt = 0

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
    return `snap${calls.length}`
  },
  remove: async (id, uris) => {
    calls.push(`remove ${id} ${uris.join(',')}`)
    songs.set(
      id,
      (songs.get(id) ?? []).filter((s) => !uris.includes(`spotify:track:${s.id}`)),
    )
    return `snap${calls.length}`
  },
  items: async (id) => {
    calls.push(`items ${id}`)
    return songs.get(id) ?? []
  },
  cover: async () => 'https://i.scdn.co/image/mosaic',
  unlist: async (id) => {
    calls.push(`unlist ${id}`)
  },
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
  snaps = new Map()
  day = Date.parse('2026-11-23T10:00:00')
  snapsAt = day
  cfg = {
    mupibox: {
      displaySearch: true,
      displayWishes: true,
      displayPlaylists: true,
      displayPlaylistCreate: true,
      displayTracks: true,
      playlistsPerDay: 2,
    },
    spotify: { tokenScopes: ['playlist-read-private', 'playlist-modify-private', 'user-library-modify'] },
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
    accountCovers: async () => new Map([[ACCOUNT_PL, 'https://i.scdn.co/image/account']]),
    accountSnapshots: async () => ({ at: snapsAt, snapshots: snaps }),
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

describe('deleting', () => {
  it('a playlist the child made goes from the start page, the search and its library - only with the switch on', async () => {
    const id = String(
      (await request(app).post('/api/search-playlists/create').send({ name: 'Weg', category: 'music' })).body.id,
    )
    assert.equal((await request(app).post('/api/search-playlists/delete').send({ id })).status, 403)
    ;(cfg.mupibox as Record<string, unknown>).displayPlaylistDelete = true
    assert.deepEqual((await request(app).get('/api/search-playlists')).body.deletable, [id])
    assert.equal((await request(app).post('/api/search-playlists/delete').send({ id })).status, 200)
    assert.ok(calls.includes(`unlist ${id}`))
    assert.ok(!library().some((x) => x.playlistid === id))
    assert.ok(!(await pool.entries()).some((e) => e.spotifyId === id))
    // (one it did not make: never)
    assert.equal((await request(app).post('/api/search-playlists/delete').send({ id: ALLOWED_PL })).status, 403)
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

  it('a playlist made by the child gets its picture from Spotify, into the library and the pool', async () => {
    const id = String(
      (await request(app).post('/api/search-playlists/create').send({ name: 'Bild', category: 'music' })).body.id,
    )
    assert.equal(library().find((x) => x.playlistid === id)?.cover, '')
    // (asked when the search shows its playlists - in the background)
    await request(app).get('/api/search-playlists')
    for (let i = 0; i < 40 && !library().find((x) => x.playlistid === id)?.cover; i++)
      await new Promise((r) => setTimeout(r, 50))
    assert.equal(library().find((x) => x.playlistid === id)?.cover, 'https://i.scdn.co/image/mosaic')
    assert.equal((await pool.entries()).find((e) => e.spotifyId === id)?.cover, 'https://i.scdn.co/image/mosaic')
  })

  it('the routine takes the pictures of the playlists of the child from one answer of Spotify, not those of the parents', async () => {
    const lib = library()
    lib.push({
      type: 'spotify',
      category: 'music',
      playlistid: ACCOUNT_PL,
      title: 'Kind',
      cover: '',
      kidAdded: true,
      index: lib.length,
    })
    lib.push({
      type: 'spotify',
      category: 'music',
      playlistid: ACCOUNT_PL,
      title: 'Eltern',
      cover: 'https://alt',
      index: lib.length,
    })
    writeFileSync(dataFile, JSON.stringify(lib))
    await playlists.refreshAllCovers()
    const rows = library().filter((x) => x.playlistid === ACCOUNT_PL)
    assert.deepEqual(
      rows.map((r) => r.cover),
      ['https://i.scdn.co/image/account', 'https://alt'],
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

  it('an album with an explicit song is not for children - asked once with its songs, kept', async () => {
    const r = await request(app).get('/api/wishes/album-check').query({ id: ALBUM })
    assert.deepEqual(r.body, { explicit: true })
    // (an album the box does not know: not asked)
    assert.equal((await request(app).get('/api/wishes/album-check').query({ id: 'C'.repeat(22) })).status, 403)
  })

  it('one the child can play goes into its playlist at once - once', async () => {
    const id = await target()
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    const r = await request(app).post('/api/wishes/track').send({ id: SONG, playlist: id })
    assert.equal(r.body.result, 'added')
    const again = await request(app).post('/api/wishes/track').send({ id: SONG, playlist: id })
    assert.equal(again.body.result, 'already')
    assert.equal(calls.filter((c) => c.startsWith('add')).length, 1)
    // (the ✓ at "In welche Playlist?": the playlists it is in)
    assert.deepEqual((await request(app).get('/api/search-playlists/containing').query({ id: SONG })).body.in, [id])
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

  it('a revoked song goes out of the playlists of the child again - unless its album is allowed otherwise', async () => {
    const id = await target()
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    await request(app).post('/api/wishes').send({ kind: 'track', id: OTHER_SONG, playlist: id })
    const open = (await request(app).get('/api/app/wishes')).body.open as { id: string }[]
    await request(app).post('/api/app/wishes/decide').send({ id: open[0].id, approve: true })
    assert.ok(songs.get(id)?.some((x) => x.id === OTHER_SONG))
    const r = await request(app).post('/api/app/wishes/revoke').send({ id: open[0].id })
    assert.deepEqual([r.body.removed, r.body.still], [['Ziel'], false])
    assert.ok(!songs.get(id)?.some((x) => x.id === OTHER_SONG))
    assert.equal(await playlists.allowed({ id: OTHER_SONG, name: '', artist: '', cover: '' }), false)
  })

  it('a revoked song stays where its album is allowed otherwise', async () => {
    const id = await target()
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    await request(app).post('/api/wishes').send({ kind: 'track', id: OTHER_SONG, playlist: id })
    const open = (await request(app).get('/api/app/wishes')).body.open as { id: string }[]
    await request(app).post('/api/app/wishes/decide').send({ id: open[0].id, approve: true })
    // (its album allowed for the search in the meantime)
    await pool.add({ kind: 'album', spotifyId: 'C'.repeat(22), name: 'Album', artist: 'Y', cover: '' })
    const r = await request(app).post('/api/app/wishes/revoke').send({ id: open[0].id })
    assert.deepEqual([r.body.removed, r.body.still], [[], true])
    assert.ok(songs.get(id)?.some((x) => x.id === OTHER_SONG))
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

  it('go into a playlist of the account allowed for the search, also when it is not on the start page', async () => {
    await pool.add({ kind: 'playlist', spotifyId: ACCOUNT_PL, name: 'Lieblingslieder', artist: '', cover: '' })
    const targets = (await request(app).get('/api/search-playlists')).body.targets as { id: string; category: string }[]
    assert.deepEqual(
      targets.map((t) => [t.id, t.category]),
      [[ACCOUNT_PL, '']],
    )
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    assert.equal(
      (await request(app).post('/api/wishes/track').send({ id: SONG, playlist: ACCOUNT_PL })).body.result,
      'added',
    )
  })

  it('the ✓ reads the songs of a playlist again only when Spotify has another version of it', async () => {
    const id = await target()
    songs.get(id)?.push({ id: SONG, name: 'Erlaubter Song', artist: 'X', cover: '' })
    snaps.set(id, 'v1')
    const reads = () => calls.filter((c) => c === `items ${id}`).length
    const tick = async () =>
      (await request(app).get('/api/search-playlists/containing').query({ id: SONG })).body.in as string[]
    assert.deepEqual(await tick(), [id])
    assert.equal(reads(), 1)
    // (hours later, the same version: nothing read)
    day += 3 * 3600_000
    assert.deepEqual(await tick(), [id])
    assert.equal(reads(), 1)
    // (changed in the Spotify app: another version - read again)
    songs.set(id, [])
    snaps.set(id, 'v2')
    snapsAt = day
    assert.deepEqual(await tick(), [])
    assert.equal(reads(), 2)
    // (put in by the box: read right before - then kept with the version Spotify gave back, the ✓ reads nothing)
    await request(app).get('/api/wishes/search').query({ q: 'song', offset: 0 })
    day += 1000
    assert.equal((await request(app).post('/api/wishes/track').send({ id: SONG, playlist: id })).body.result, 'added')
    assert.equal(reads(), 3)
    day += 1000
    assert.deepEqual(await tick(), [id])
    assert.equal(reads(), 3)
    // (kept on the SD card: a restart of the box reads nothing either)
    const kept = JSON.parse(readFileSync(path.join(dir, 'search-playlists-songs.json'), 'utf8'))
    assert.deepEqual(kept[id].ids, [SONG])
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
