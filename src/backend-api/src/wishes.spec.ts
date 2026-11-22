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

describe('wishes: what the box has is found, marked, not to wish', () => {
  it('an album there, every album of an artist there, the artist, a show there or a podcast of its name', async () => {
    const there = async (url: string) =>
      (await request(app).get(url).expect(200)).body.items.map((i: { kind: string; there: boolean }) => [
        i.kind,
        i.there,
      ])
    assert.deepEqual(await there('/api/wishes/search?q=peter'), [
      ['artist', false],
      ['album', false],
      ['show', false],
    ])
    writeFileSync(
      dataFile,
      JSON.stringify([
        { type: 'spotify', category: 'music', id: ALBUM, title: 'Löwenzahn Lieder' },
        { type: 'rss', category: 'audiobook', id: 'https://example.invalid/hz.xml', artist: 'Hörspielzeit' },
      ]),
    )
    assert.deepEqual(await there('/api/wishes/search?q=peter'), [
      ['artist', false],
      ['album', true],
      ['show', true],
    ])
    // not to wish: "there"
    const w = await request(app).post('/api/wishes').send({ kind: 'show', id: SHOW, category: 'audiobook' }).expect(200)
    assert.equal(w.body.result, 'there')
    // the whole artist on the box: it and its albums marked
    writeFileSync(dataFile, JSON.stringify([{ type: 'spotify', category: 'music', artistid: ARTIST }]))
    assert.deepEqual((await there('/api/wishes/search?q=peter'))[0], ['artist', true])
    const albums = await there(`/api/wishes/artist?id=${ARTIST}&offset=0`)
    assert.ok(albums.length === 10 && albums.every(([, t]: [string, boolean]) => t))
    // (all of it from the pages kept: Spotify asked once for the search, once for the artist)
    assert.equal(calls.length, 2)
  })
})

describe('wishes: the list in the app tidied up', () => {
  it('one decided wish or all of them out of the list; open ones stay, an approval stays in the pool', async () => {
    await request(app).get('/api/wishes/search?q=peter').expect(200)
    await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(200)
    await request(app).post('/api/wishes').send({ kind: 'artist', id: ARTIST, category: 'music' }).expect(200)
    await request(app).post('/api/wishes').send({ kind: 'show', id: SHOW, category: 'audiobook' }).expect(200)
    const app_ = () => request(app).get('/api/app/wishes').set('x-test-session', 'yes')
    const open = (await app_()).body.open as { id: string; kind: string }[]
    const id = (k: string) => open.find((w) => w.kind === k)?.id
    for (const [k, approve] of [
      ['album', true],
      ['artist', false],
    ] as const)
      await request(app)
        .post('/api/app/wishes/decide')
        .set('x-test-session', 'yes')
        .send({ id: id(k), approve })
        .expect(200)
    await request(app).post('/api/app/wishes/forget').send({ all: true }).expect(401)
    // an open one is not forgotten
    const keep = await request(app)
      .post('/api/app/wishes/forget')
      .set('x-test-session', 'yes')
      .send({ id: id('show') })
      .expect(200)
    assert.equal(keep.body.removed, 0)
    const one = await request(app)
      .post('/api/app/wishes/forget')
      .set('x-test-session', 'yes')
      .send({ id: id('artist') })
      .expect(200)
    assert.equal(one.body.removed, 1)
    const all = await request(app)
      .post('/api/app/wishes/forget')
      .set('x-test-session', 'yes')
      .send({ all: true })
      .expect(200)
    assert.equal(all.body.removed, 1)
    const after = (await app_()).body
    assert.equal(after.decided.length, 0)
    assert.equal(after.open.length, 1)
    assert.ok((await pool.entries()).some((e) => e.kind === 'album' && e.spotifyId === ALBUM))
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

  it('an approval is kept: in the pool - taken out by the child, it fetches it back itself; not wished again', async () => {
    await request(app).get('/api/wishes/search?q=peter').expect(200)
    await request(app).post('/api/wishes').send({ kind: 'album', id: ALBUM, category: 'music' }).expect(200)
    const [w] = (await request(app).get('/api/app/wishes').set('x-test-session', 'yes')).body.open
    await request(app)
      .post('/api/app/wishes/decide')
      .set('x-test-session', 'yes')
      .send({ id: w.id, approve: true })
      .expect(200)
    const entry = (await pool.entries()).find((e) => e.kind === 'album' && e.spotifyId === ALBUM)
    assert.ok(entry, 'approved: in the search pool')
    // the child takes it off the start page ...
    await request(app)
      .post('/api/search-pool/remove-own')
      .send({ ident: `album:${ALBUM}` })
      .expect(200)
    assert.equal(JSON.parse(readFileSync(dataFile, 'utf8')).length, 0)
    // ... a wish of it is not made (it may fetch it itself) ...
    const again = await request(app)
      .post('/api/wishes')
      .send({ kind: 'album', id: ALBUM, category: 'music' })
      .expect(200)
    assert.equal(again.body.result, 'allowed')
    assert.equal((await request(app).get('/api/app/wishes').set('x-test-session', 'yes')).body.open.length, 0)
    // ... and it puts it back from the pool, under another tab
    await request(app)
      .post('/api/search-pool/add-to-library')
      .send({ poolId: entry.id, category: 'audiobook' })
      .expect(200)
    const rows = JSON.parse(readFileSync(dataFile, 'utf8'))
    assert.equal(rows.length, 1)
    assert.equal(rows[0].category, 'audiobook')
    assert.equal(rows[0].kidAdded, true)
  })

  it('revoked: out of the pool and off the start page, the child may wish it again', async () => {
    await request(app).get('/api/wishes/search?q=peter').expect(200)
    await request(app).post('/api/wishes').send({ kind: 'artist', id: ARTIST, category: 'audiobook' }).expect(200)
    const [w] = (await request(app).get('/api/app/wishes').set('x-test-session', 'yes')).body.open
    await request(app)
      .post('/api/app/wishes/decide')
      .set('x-test-session', 'yes')
      .send({ id: w.id, approve: true })
      .expect(200)
    const before = (await pool.events()).length
    await request(app).post('/api/app/wishes/revoke').send({ id: w.id }).expect(401)
    await request(app).post('/api/app/wishes/revoke').set('x-test-session', 'yes').send({ id: w.id }).expect(200)
    assert.equal(JSON.parse(readFileSync(dataFile, 'utf8')).length, 0)
    assert.equal((await pool.entries()).length, 0)
    // (the parents did it: Home Assistant is not told of a removal)
    assert.equal((await pool.events()).length, before)
    const list = await request(app).get('/api/app/wishes').set('x-test-session', 'yes').expect(200)
    assert.equal(list.body.decided[0].status, 'revoked')
    await request(app).post('/api/app/wishes/revoke').set('x-test-session', 'yes').send({ id: w.id }).expect(404)
    const again = await request(app)
      .post('/api/wishes')
      .send({ kind: 'artist', id: ARTIST, category: 'audiobook' })
      .expect(200)
    assert.equal(again.body.result, 'wished')
  })

  it('approvals made before the pool kept them: put into it once', async () => {
    writeFileSync(
      path.join(dir, 'wishes.json'),
      JSON.stringify([
        {
          id: 'w_old',
          at: '2026-11-22T09:00:00Z',
          kind: 'show',
          spotifyId: SHOW,
          name: 'Hörspielzeit',
          artist: 'Sender',
          cover: '',
          category: 'audiobook',
          status: 'approved',
        },
      ]),
    )
    const wishes = W.registerWishesRoutes(express(), {
      configDir: dir,
      cacheDir: path.join(dir, 'cache'),
      pool,
      getMupiboxConfig: () => cfg,
      session: (_req, _res, next) => next(),
      csrf: (_req, _res, next) => next(),
    })
    await wishes.rememberApproved()
    assert.deepEqual(
      (await pool.entries()).map((e) => [e.kind, e.spotifyId]),
      [['show', SHOW]],
    )
    // (taken out of the pool in the app afterwards: not put back)
    await pool.clear()
    await wishes.rememberApproved()
    assert.equal((await pool.entries()).length, 0)
  })
})
