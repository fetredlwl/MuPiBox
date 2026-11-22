// Podcasts for children in the display's search (search-podcasts.ts): only with the switches on, children's shows
// only, each term asked once a day, and only a show the search handed out can be added - by the child, without approval.
import assert from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import type { MupiboxConfig } from './models/mupibox-config.model'
import type { PodcastHit } from './podcast-search'
import { registerSearchPodcastsRoutes } from './search-podcasts'
import { registerSearchPoolRoutes } from './search-pool'

// invented shows
const hit = (title: string, feed: string, kids = true, explicit = false): PodcastHit => ({
  title,
  author: 'Testsender',
  feedUrl: feed,
  image: 'https://example.invalid/c.jpg',
  genre: 'Kids',
  episodes: 12,
  country: 'DE',
  kids,
  explicit,
})

let app: express.Express
let cfg: Record<string, unknown>
let asked: string[]
let now: number
let dataFile: string

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-kids-pod-'))
  dataFile = path.join(dir, 'data.json')
  writeFileSync(dataFile, '[]')
  cfg = { mupibox: { displaySearch: true, displayPodcasts: true }, displayLanguage: 'de' }
  asked = []
  now = Date.parse('2026-11-22T10:00:00Z')
  app = express()
  app.use(express.json())
  const pool = registerSearchPoolRoutes(app, {
    configDir: dir,
    dataFile,
    dataLock: path.join(dir, '.lock'),
    writeLibrary: async (data) => writeFileSync(dataFile, JSON.stringify(data)),
    spotify: () => undefined,
    session: (_req, res) => void res.status(401).end(),
    csrf: (_req, _res, next) => next(),
  })
  registerSearchPodcastsRoutes(app, {
    getMupiboxConfig: () => cfg as unknown as MupiboxConfig,
    pool,
    now: () => now,
    tips: async (lang) => {
      asked.push(`tips|${lang}`)
      return [hit('Tipp Tiger', 'https://example.invalid/tiger.xml'), hit('Erwachsenentipp', 'https://example.invalid/e.xml', false)]
    },
    search: async (term, lang) => {
      asked.push(`${lang}|${term}`)
      return [
        hit('Fuchs und Frosch', 'https://example.invalid/fuchs.xml'),
        hit('Erwachsenenkram', 'https://example.invalid/x.xml', false),
        hit('Derbes', 'https://example.invalid/d.xml', true, true),
      ]
    },
  })
})

describe('podcasts for children in the display search', () => {
  it('only with the display search and its own switch on', async () => {
    ;(cfg.mupibox as Record<string, unknown>).displayPodcasts = false
    await request(app).get('/api/search-podcasts?q=fuchs').expect(403)
    ;(cfg.mupibox as Record<string, unknown>).displayPodcasts = true
    ;(cfg.mupibox as Record<string, unknown>).displaySearch = false
    await request(app).get('/api/search-podcasts?q=fuchs').expect(403)
    ;(cfg.mupibox as Record<string, unknown>).displaySearch = true
    ;(cfg.mupibox as Record<string, unknown>).podcastSearch = false
    await request(app).get('/api/search-podcasts?q=fuchs').expect(403)
    assert.equal(asked.length, 0)
  })

  it('hands out children’s shows only, not explicit ones', async () => {
    const r = await request(app).get('/api/search-podcasts?q=fuchs').expect(200)
    assert.deepEqual(
      r.body.shows.map((s: { title: string }) => s.title),
      ['Fuchs und Frosch'],
    )
  })

  it('asks a term once a day (the same term in other letters too)', async () => {
    await request(app).get('/api/search-podcasts?q=Fuchs').expect(200)
    const again = await request(app).get('/api/search-podcasts?q=fuchs ').expect(200)
    assert.equal(again.body.kept, true)
    assert.deepEqual(asked, ['de|fuchs'])
    now += 25 * 60 * 60 * 1000
    await request(app).get('/api/search-podcasts?q=fuchs').expect(200)
    assert.equal(asked.length, 2)
  })

  it('adds only a show the search handed out, as the child’s own, once', async () => {
    await request(app)
      .post('/api/search-podcasts/add')
      .send({ feedUrl: 'https://example.invalid/fuchs.xml', category: 'audiobook' })
      .expect(403)
    await request(app).get('/api/search-podcasts?q=fuchs').expect(200)
    await request(app)
      .post('/api/search-podcasts/add')
      .send({ feedUrl: 'https://example.invalid/x.xml', category: 'audiobook' })
      .expect(403)
    await request(app)
      .post('/api/search-podcasts/add')
      .send({ feedUrl: 'https://example.invalid/fuchs.xml', category: 'nas' })
      .expect(400)
    const r = await request(app)
      .post('/api/search-podcasts/add')
      .send({ feedUrl: 'https://example.invalid/fuchs.xml', category: 'audiobook' })
      .expect(200)
    assert.equal(r.body.result, 'added')
    const row = JSON.parse(readFileSync(dataFile, 'utf8'))[0]
    assert.equal(row.type, 'rss')
    assert.equal(row.id, 'https://example.invalid/fuchs.xml')
    assert.equal(row.artist, 'Fuchs und Frosch')
    assert.equal(row.category, 'audiobook')
    assert.equal(row.kidAdded, true)
    const twice = await request(app)
      .post('/api/search-podcasts/add')
      .send({ feedUrl: 'https://example.invalid/fuchs.xml', category: 'music' })
      .expect(200)
    assert.equal(twice.body.result, 'already')
    // (the child sees it under "Von dir geholt" and can take it out again)
    const own = await request(app).get('/api/search-pool/own').expect(200)
    assert.equal(own.body.entries.length, 1)
  })

  it('tips before anything is typed: children’s shows, asked again after 6 hours, addable', async () => {
    const r = await request(app).get('/api/search-podcasts/tips').expect(200)
    assert.deepEqual(
      r.body.shows.map((s: { title: string }) => s.title),
      ['Tipp Tiger'],
    )
    await request(app).get('/api/search-podcasts/tips').expect(200)
    assert.deepEqual(asked, ['tips|de'])
    now += 7 * 60 * 60 * 1000
    await request(app).get('/api/search-podcasts/tips').expect(200)
    assert.equal(asked.length, 2)
    const add = await request(app).post('/api/search-podcasts/add').send({ feedUrl: 'https://example.invalid/tiger.xml', category: 'other' }).expect(200)
    assert.equal(add.body.result, 'added')
    ;(cfg.mupibox as Record<string, unknown>).displayPodcasts = false
    await request(app).get('/api/search-podcasts/tips').expect(403)
  })
})
