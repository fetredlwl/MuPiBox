// The search pool (search-pool.ts): what the parents allow for the display's search, what the child puts into the
// library from it and takes out again (only its own), the events for Home Assistant, and the routes' guards.
import assert from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import { identOf, libraryRow, registerSearchPoolRoutes, type SearchPool, type SearchPoolDeps } from './search-pool'

const ARTIST = 'A'.repeat(22)
const ALBUM_1 = 'B'.repeat(22)
const ALBUM_2 = 'C'.repeat(22)
const PLAYLIST = 'D'.repeat(22)

let dir: string
let dataFile: string
let deps: SearchPoolDeps
let pool: SearchPool
let app: express.Express
let spotifyCalls = 0

const library = () => JSON.parse(readFileSync(dataFile, 'utf8')) as Record<string, unknown>[]

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-pool-test-'))
  dataFile = path.join(dir, 'data.json')
  // a library with one row of the parents
  writeFileSync(
    dataFile,
    JSON.stringify([
      { type: 'spotify', category: 'audiobook', id: 'Z'.repeat(22), title: 'Eltern', artist: 'X', index: 0 },
    ]),
  )
  spotifyCalls = 0
  deps = {
    configDir: dir,
    dataFile,
    dataLock: path.join(dir, '.data.lock'),
    writeLibrary: async (data) => writeFileSync(dataFile, JSON.stringify(data)),
    spotify: () => ({
      getAllArtistAlbums: async () => {
        spotifyCalls++
        return [
          {
            id: ALBUM_1,
            name: 'Erstes Album',
            images: [{ url: 'https://i.scdn.co/image/big' }, { url: 'https://i.scdn.co/image/mid' }],
            release_date: '2020-01-01',
          },
          { id: ALBUM_2, name: 'Zweites Album', images: [], release_date: '2021-05-05' },
        ]
      },
    }),
    // (the parents' session: a header in the tests)
    session: (req, res, next) =>
      req.headers['x-test-session'] === 'yes' ? next() : res.status(401).json({ error: 'unauthenticated' }),
    csrf: (_req, _res, next) => next(),
  }
  app = express()
  app.use(express.json())
  pool = registerSearchPoolRoutes(app, deps)
})

const settle = () => new Promise((r) => setTimeout(r, 50))

describe('libraryRow / identOf', () => {
  it('makes a shown album row with name and cover, marked as the child’s', () => {
    const row = libraryRow(
      { kind: 'album', spotifyId: ALBUM_1, name: 'Erstes Album', artist: 'Lena', cover: 'https://c' },
      'music',
      'p_1',
    )
    assert.equal(row.type, 'spotify')
    assert.equal(row.id, ALBUM_1)
    assert.equal(row.title, 'Erstes Album')
    assert.equal(row.artist, 'Lena')
    assert.equal(row.category, 'music')
    assert.equal(row.kidAdded, true)
    assert.equal(row.source, 'manual')
    assert.equal(identOf(row), `album:${ALBUM_1}`)
  })

  it('tells artists, playlists and podcasts apart', () => {
    const base = { name: 'N', artist: '', cover: '' }
    assert.equal(identOf(libraryRow({ kind: 'artist', spotifyId: ARTIST, ...base }, 'music', 'p')), `artist:${ARTIST}`)
    assert.equal(
      identOf(libraryRow({ kind: 'playlist', spotifyId: PLAYLIST, ...base }, 'music', 'p')),
      `playlist:${PLAYLIST}`,
    )
    assert.equal(identOf(libraryRow({ kind: 'show', spotifyId: PLAYLIST, ...base }, 'other', 'p')), `show:${PLAYLIST}`)
    assert.equal(identOf({ type: 'radio', id: 'x' }), null)
  })
})

describe('the pool', () => {
  it('keeps an artist once and fetches its albums', async () => {
    const a = await pool.add({ kind: 'artist', spotifyId: ARTIST, name: 'Lena', artist: '', cover: '' })
    const again = await pool.add({ kind: 'artist', spotifyId: ARTIST, name: 'Lena', artist: '', cover: '' })
    assert.equal(a.id, again.id)
    await settle()
    const [entry] = await pool.entries()
    assert.equal(entry.albums?.length, 2)
    assert.equal(entry.albums?.[0].cover, 'https://i.scdn.co/image/mid')
    assert.equal(spotifyCalls, 1)
    // (the library is not touched by the pool itself)
    assert.equal(library().length, 1)
  })

  it('puts an album of a pool artist into the library under the chosen tab, once', async () => {
    const a = await pool.add({ kind: 'artist', spotifyId: ARTIST, name: 'Lena', artist: '', cover: '' })
    await settle()
    assert.equal(await pool.addToLibrary(a.id, ALBUM_2, 'music'), 'added')
    assert.equal(await pool.addToLibrary(a.id, ALBUM_2, 'audiobook'), 'already')
    const rows = library()
    assert.equal(rows.length, 2)
    assert.equal(rows[1].id, ALBUM_2)
    assert.equal(rows[1].artist, 'Lena')
    assert.equal(rows[1].category, 'music')
    assert.equal(rows[1].index, 1)
    const events = await pool.events()
    assert.equal(events.length, 1)
    assert.deepEqual(
      [events[0].what, events[0].kind, events[0].name, events[0].category],
      ['added', 'album', 'Zweites Album', 'music'],
    )
  })

  it('refuses an album that is not one of the pool artist', async () => {
    const a = await pool.add({ kind: 'artist', spotifyId: ARTIST, name: 'Lena', artist: '', cover: '' })
    await settle()
    assert.equal(await pool.addToLibrary(a.id, PLAYLIST, 'music'), 'unknown')
    assert.equal(await pool.addToLibrary('p_nope', undefined, 'music'), 'unknown')
  })

  it('lets the child take out only what it put in', async () => {
    const p = await pool.add({ kind: 'playlist', spotifyId: PLAYLIST, name: 'Lieder', artist: '', cover: '' })
    assert.equal(await pool.addToLibrary(p.id, undefined, 'music'), 'added')
    const own = await pool.own()
    assert.deepEqual(
      own.map((o) => [o.ident, o.name, o.category]),
      [[`playlist:${PLAYLIST}`, 'Lieder', 'music']],
    )
    // the parents' row: not the child's
    assert.equal(await pool.removeOwn(`album:${'Z'.repeat(22)}`), 'unknown')
    assert.equal(await pool.removeOwn(`playlist:${PLAYLIST}`), 'removed')
    assert.equal(library().length, 1)
    assert.equal((await pool.events()).map((e) => e.what).join(','), 'added,removed')
  })
})

describe('the routes', () => {
  it('parents: add and list need a session', async () => {
    await request(app).post('/api/app/search-pool').send({ kind: 'album', spotifyId: ALBUM_1, name: 'X' }).expect(401)
    await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({ kind: 'album', spotifyId: 'short', name: 'X' })
      .expect(400)
    await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({ kind: 'album', spotifyId: ALBUM_1, name: 'Erstes Album', artist: 'Lena', cover: 'https://c' })
      .expect(200)
    const list = await request(app).get('/api/app/search-pool').set('x-test-session', 'yes').expect(200)
    assert.equal(list.body.entries.length, 1)
  })

  it('display: reads the pool and adds from it on the box itself', async () => {
    const entry = await pool.add({
      kind: 'album',
      spotifyId: ALBUM_1,
      name: 'Erstes Album',
      artist: 'Lena',
      cover: 'https://c',
    })
    const got = await request(app).get('/api/search-pool').expect(200)
    assert.equal(got.body.entries[0].name, 'Erstes Album')
    await request(app).post('/api/search-pool/add-to-library').send({ poolId: entry.id, category: 'nas' }).expect(400)
    const added = await request(app)
      .post('/api/search-pool/add-to-library')
      .send({ poolId: entry.id, category: 'music' })
      .expect(200)
    assert.equal(added.body.result, 'added')
    await request(app)
      .post('/api/search-pool/remove-own')
      .send({ ident: `album:${ALBUM_1}` })
      .expect(200)
    await request(app)
      .post('/api/search-pool/remove-own')
      .send({ ident: `album:${ALBUM_1}` })
      .expect(404)
  })

  it('parents: take off the start page what the child put there (only that, with a session)', async () => {
    const p = await pool.add({ kind: 'album', spotifyId: ALBUM_1, name: 'Erstes Album', artist: 'Lena', cover: '' })
    assert.equal(await pool.addToLibrary(p.id, undefined, 'music'), 'added')
    await request(app)
      .post('/api/app/search-pool/remove-own')
      .send({ ident: `album:${ALBUM_1}` })
      .expect(401)
    // (the parents' own row stays: not the child's)
    await request(app)
      .post('/api/app/search-pool/remove-own')
      .set('x-test-session', 'yes')
      .send({ ident: `album:${'Z'.repeat(22)}` })
      .expect(404)
    await request(app)
      .post('/api/app/search-pool/remove-own')
      .set('x-test-session', 'yes')
      .send({ ident: `album:${ALBUM_1}` })
      .expect(200)
    assert.equal(library().length, 1)
    assert.equal((await pool.own()).length, 0)
  })

  it("refuses Spotify's own playlists (they do not play on the box)", async () => {
    const res = await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({ kind: 'playlist', spotifyId: '37i9dQZF1E35dROyEj8PNG', name: 'This Is …' })
      .expect(422)
    assert.equal(res.body.error, 'spotify_own_playlist')
    assert.equal((await pool.entries()).length, 0)
    await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({ kind: 'playlist', spotifyId: PLAYLIST, name: 'Eigene' })
      .expect(200)
  })

  it('podcasts: a feed in the pool becomes an RSS row as the app adds one, and comes out again', async () => {
    await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({ kind: 'podcast', feedUrl: 'not a url', name: 'Kakadu' })
      .expect(400)
    const res = await request(app)
      .post('/api/app/search-pool')
      .set('x-test-session', 'yes')
      .send({
        kind: 'podcast',
        feedUrl: 'https://example.org/kakadu/feed.xml',
        name: 'Kakadu',
        cover: 'https://example.org/k.jpg',
      })
      .expect(200)
    // (the same feed with http: the same entry)
    const again = await pool.add({
      kind: 'podcast',
      spotifyId: '',
      feedUrl: 'http://example.org/kakadu/feed.xml',
      name: 'Kakadu',
      artist: '',
      cover: '',
    })
    assert.equal(again.id, res.body.entry.id)
    const added = await request(app)
      .post('/api/search-pool/add-to-library')
      .send({ poolId: res.body.entry.id, category: 'other' })
      .expect(200)
    assert.equal(added.body.result, 'added')
    const row = library()[1]
    assert.deepEqual(
      [row.type, row.id, row.artist, row.category, row.kidAdded],
      ['rss', 'https://example.org/kakadu/feed.xml', 'Kakadu', 'other', true],
    )
    const own = await pool.own()
    assert.deepEqual(
      own.map((o) => [o.ident, o.name]),
      [['podcast:example.org/kakadu/feed.xml', 'Kakadu']],
    )
    await request(app).post('/api/search-pool/remove-own').send({ ident: own[0].ident }).expect(200)
    assert.equal(library().length, 1)
    assert.deepEqual(
      (await pool.events()).map((e) => [e.what, e.kind]),
      [
        ['added', 'podcast'],
        ['removed', 'podcast'],
      ],
    )
  })
})
