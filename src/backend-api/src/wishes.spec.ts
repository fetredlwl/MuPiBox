// Wishes from Spotify (wishes.ts): few requests (each page once a day, also after a restart; nothing during a block;
// an artist's kept list without any), a wish only of what was shown, the parents' decision.
import assert from 'node:assert'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { before, beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'

// (a block file of its own: spotify-block.ts reads SPOTIFY_BLOCK_FILE when it is loaded)
const blockDir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-wish-block-'))
const BLOCK_FILE = path.join(blockDir, 'spotify-block.json')
process.env.SPOTIFY_BLOCK_FILE = BLOCK_FILE

type WishesModule = typeof import('./wishes')
type PoolModule = typeof import('./search-pool')
type BlockModule = typeof import('./spotify-block')
let W: WishesModule
let P: PoolModule
let B: BlockModule
before(async () => {
  W = await import('./wishes')
  P = await import('./search-pool')
  B = await import('./spotify-block')
})

// invented Spotify ids and names
const id = (c: string) => c.repeat(22)
const ARTIST = id('A')
const ALBUM = id('B')
const SHOW = id('S')

let dir: string
let dataFile: string
let cfg: Record<string, unknown>
let calls: string[]
let now: number
let kept: { id: string; name: string; cover: string }[] | undefined
let app: express.Express
let pool: InstanceType<PoolModule['SearchPool']>

function make(): express.Express {
  const a = express()
  a.use(express.json())
  pool = P.registerSearchPoolRoutes(a, {
    configDir: dir,
    dataFile,
    dataLock: path.join(dir, '.lock'),
    writeLibrary: async (data) => writeFileSync(dataFile, JSON.stringify(data)),
    spotify: () => undefined,
    session: (req, res, next) => (req.headers['x-test-session'] === 'yes' ? next() : res.status(401).end()),
    csrf: (_req, _res, next) => next(),
  })
  W.registerWishesRoutes(a, {
    configDir: dir,
    cacheDir: path.join(dir, 'cache'),
    pool,
    getMupiboxConfig: () => cfg,
    now: () => now,
    searchPage: async (q, offset) => {
      calls.push(`search ${q} ${offset}`)
      return {
        albums: [{ id: ALBUM, name: 'Löwenzahn Lieder', artist: 'Peter', cover: 'https://example.invalid/b.jpg' }],
        artists: [{ id: ARTIST, name: 'Peter Lustig', cover: '' }],
        shows: [{ id: SHOW, name: 'Hörspielzeit', artist: 'Sender', cover: '' }],
        more: offset === 0,
      }
    },
    artistPage: async (artistId, offset) => {
      calls.push(`artist ${artistId} ${offset}`)
      const all = Array.from({ length: 23 }, (_, i) => ({
        id: id(String.fromCharCode(97 + i)),
        name: `Folge ${i + 1}`,
        cover: '',
      }))
      return { items: all.slice(offset, offset + 10), total: all.length }
    },
    keptAlbums: () => kept,
    session: (req, res, next) => (req.headers['x-test-session'] === 'yes' ? next() : res.status(401).end()),
    csrf: (_req, _res, next) => next(),
  })
  return a
}

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-wishes-'))
  mkdirSync(path.join(dir, 'cache'))
  dataFile = path.join(dir, 'data.json')
  writeFileSync(dataFile, '[]')
  cfg = { mupibox: { displaySearch: true, displayWishes: true } }
  calls = []
  now = Date.parse('2026-11-22T10:00:00Z')
  kept = undefined
  B.clearSpotifyBlock('test')
  app = make()
})

describe('wishes: few requests to Spotify', () => {
  it('nothing for the display with the switch off (or the search off)', async () => {
    ;(cfg.mupibox as Record<string, unknown>).displayWishes = false
    await request(app).get('/api/wishes/search?q=peter').expect(403)
    ;(cfg.mupibox as Record<string, unknown>).displayWishes = true
    ;(cfg.mupibox as Record<string, unknown>).displaySearch = false
    await request(app).get('/api/wishes/search?q=peter').expect(403)
    await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(403)
    assert.equal(calls.length, 0)
  })

  it('a search page once a day - also after a restart; the next page only when asked for', async () => {
    const r = await request(app).get('/api/wishes/search?q=Peter&offset=0').expect(200)
    assert.deepEqual(
      r.body.items.map((i: { kind: string }) => i.kind),
      ['artist', 'album', 'show'],
    )
    assert.equal(r.body.more, true)
    await request(app).get('/api/wishes/search?q=peter ').expect(200)
    // (a restart: the pages kept on the SD card)
    app = make()
    const again = await request(app).get('/api/wishes/search?q=peter&offset=0').expect(200)
    assert.equal(again.body.kept, true)
    assert.deepEqual(calls, ['search Peter 0'])
    await request(app).get('/api/wishes/search?q=peter&offset=10').expect(200)
    assert.equal(calls.length, 2)
    now += 25 * 60 * 60 * 1000
    await request(app).get('/api/wishes/search?q=peter&offset=0').expect(200)
    assert.equal(calls.length, 3)
  })

  it('nothing asked during a Spotify block', async () => {
    B.noteSpotifyBlock(Date.now() + 60_000, 'test', '429 (test, QUOTA_EXCEEDED)')
    const r = await request(app).get('/api/wishes/search?q=peter').expect(503)
    assert.equal(r.body.error, 'spotify_blocked')
    assert.equal(calls.length, 0)
  })

  it("an artist's albums: its kept list without a request, else pages of 10 once a day", async () => {
    kept = Array.from({ length: 12 }, (_, i) => ({
      id: id(String.fromCharCode(65 + i)),
      name: `Album ${i}`,
      cover: '',
    }))
    const k = await request(app).get(`/api/wishes/artist?id=${ARTIST}&offset=0`).expect(200)
    assert.equal(k.body.items.length, 10)
    assert.equal(k.body.more, true)
    const k2 = await request(app).get(`/api/wishes/artist?id=${ARTIST}&offset=10`).expect(200)
    assert.equal(k2.body.items.length, 2)
    assert.equal(calls.length, 0)
    kept = undefined
    const OTHER = id('Z')
    const p1 = await request(app).get(`/api/wishes/artist?id=${OTHER}&offset=0`).expect(200)
    assert.equal(p1.body.items.length, 10)
    assert.equal(p1.body.more, true)
    await request(app).get(`/api/wishes/artist?id=${OTHER}&offset=0`).expect(200)
    assert.deepEqual(calls, [`artist ${OTHER} 0`])
    await request(app).get(`/api/wishes/artist?id=${OTHER}&offset=7`).expect(400)
  })
})

describe('wishes: the child wishes, the parents decide', () => {
  it('only what was shown; once while open; not what is on the box', async () => {
    await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(403)
    await request(app).get('/api/wishes/search?q=peter').expect(200)
    const w = await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(200)
    assert.equal(w.body.result, 'wished')
    const twice = await request(app)
      .post('/api/wishes')
      .send({ kind: 'album', id: ALBUM, category: 'audiobook' })
      .expect(200)
    assert.equal(twice.body.result, 'already')
    // (Home Assistant is told)
    const events = await pool.events()
    assert.equal(events[events.length - 1].what, 'wish')
    assert.equal(events[events.length - 1].name, 'Löwenzahn Lieder')
    // (the display marks it)
    const mine = await request(app).get('/api/wishes/mine').expect(200)
    assert.deepEqual(mine.body.wishes, [{ kind: 'album', id: ALBUM }])
    writeFileSync(
      dataFile,
      JSON.stringify([{ type: 'spotify', category: 'audiobook', showid: SHOW, artist: 'Hörspielzeit' }]),
    )
    const there = await request(app)
      .post('/api/wishes')
      .send({ kind: 'show', id: SHOW, category: 'audiobook' })
      .expect(200)
    assert.equal(there.body.result, 'there')
    assert.equal(calls.length, 1)
  })

  it('approved: on the start page under the child’s tab, as its own; refused: not', async () => {
    await request(app).get('/api/wishes/search?q=peter').expect(200)
    await request(app).post('/api/wishes').send({ kind: 'artist', id: ARTIST, category: 'audiobook' }).expect(200)
    await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(200)
    await request(app).get('/api/app/wishes').expect(401)
    const list = await request(app).get('/api/app/wishes').set('x-test-session', 'yes').expect(200)
    assert.equal(list.body.open.length, 2)
    const artistWish = list.body.open.find((w: { kind: string }) => w.kind === 'artist')
    const albumWish = list.body.open.find((w: { kind: string }) => w.kind === 'album')
    await request(app)
      .post('/api/app/wishes/decide')
      .set('x-test-session', 'yes')
      .send({ id: artistWish.id, approve: true })
      .expect(200)
    await request(app)
      .post('/api/app/wishes/decide')
      .set('x-test-session', 'yes')
      .send({ id: albumWish.id, approve: false })
      .expect(200)
    await request(app)
      .post('/api/app/wishes/decide')
      .set('x-test-session', 'yes')
      .send({ id: albumWish.id, approve: true })
      .expect(404)
    const rows = JSON.parse(readFileSync(dataFile, 'utf8'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].artistid, ARTIST)
    assert.equal(rows[0].category, 'audiobook')
    assert.equal(rows[0].kidAdded, true)
    const after = await request(app).get('/api/app/wishes').set('x-test-session', 'yes').expect(200)
    assert.equal(after.body.open.length, 0)
    assert.deepEqual(after.body.decided.map((w: { status: string }) => w.status).sort(), ['approved', 'rejected'])
    // (approving asks Spotify nothing)
    assert.equal(calls.length, 1)
  })
})
