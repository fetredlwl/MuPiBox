// Radio for children in the display's search (search-radio.ts): only with the switches on, children's stations only,
// each term asked once a day, only a station the search handed out can be added - by the child, without approval - and
// the child may move it to another tab or take it out again ("Einträge verwalten").
import assert from 'node:assert'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import type { MupiboxConfig } from './models/mupibox-config.model'
import type { RadioHit } from './radio-search'
import { registerSearchPoolRoutes } from './search-pool'
import { registerSearchRadioRoutes } from './search-radio'

// invented stations
const station = (name: string, url: string, kids = true): RadioHit => ({
  name,
  url,
  image: 'https://example.invalid/r.png',
  country: 'DE',
  codec: 'MP3',
  bitrate: 128,
  tags: kids ? ['kinder'] : ['news'],
  kids,
})

let app: express.Express
let cfg: Record<string, unknown>
let asked: string[]
let now: number
let dataFile: string

const library = () => JSON.parse(readFileSync(dataFile, 'utf8')) as Record<string, unknown>[]

beforeEach(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-kids-radio-'))
  dataFile = path.join(dir, 'data.json')
  writeFileSync(dataFile, '[]')
  cfg = { mupibox: { displaySearch: true, displayRadio: true }, displayLanguage: 'de' }
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
  registerSearchRadioRoutes(app, {
    getMupiboxConfig: () => cfg as unknown as MupiboxConfig,
    pool,
    now: () => now,
    tips: async (lang) => {
      asked.push(`tips|${lang}`)
      return [
        station('Kinderwelle', 'https://example.invalid/kw.mp3'),
        station('Nachrichten', 'https://example.invalid/n.mp3', false),
      ]
    },
    search: async (term, lang) => {
      asked.push(`${lang}|${term}`)
      return [
        station('Fuchsradio', 'https://example.invalid/fuchs.mp3'),
        station('Börse', 'https://example.invalid/b.mp3', false),
      ]
    },
  })
})

describe('radio for children in the display search', () => {
  it('only with the display search and its own switch on (and the app’s radio search not off)', async () => {
    ;(cfg.mupibox as Record<string, unknown>).displayRadio = false
    await request(app).get('/api/search-radio?q=fuchs').expect(403)
    await request(app).get('/api/search-radio/tips').expect(403)
    ;(cfg.mupibox as Record<string, unknown>).displayRadio = true
    ;(cfg.mupibox as Record<string, unknown>).radioSearch = false
    await request(app).get('/api/search-radio?q=fuchs').expect(403)
    ;(cfg.mupibox as Record<string, unknown>).radioSearch = true
    ;(cfg.mupibox as Record<string, unknown>).displaySearch = false
    await request(app).get('/api/search-radio?q=fuchs').expect(403)
    assert.equal(asked.length, 0)
  })

  it('children’s stations only, each term once a day', async () => {
    const r = await request(app).get('/api/search-radio?q=Fuchs').expect(200)
    assert.deepEqual(
      r.body.stations.map((s: { name: string }) => s.name),
      ['Fuchsradio'],
    )
    await request(app).get('/api/search-radio?q=fuchs ').expect(200)
    assert.deepEqual(asked, ['de|fuchs'])
    now += 25 * 60 * 60 * 1000
    await request(app).get('/api/search-radio?q=fuchs').expect(200)
    assert.equal(asked.length, 2)
  })

  it('adds only a station it handed out, as the app adds one - the child’s own, to move and to take out', async () => {
    await request(app)
      .post('/api/search-radio/add')
      .send({ url: 'https://example.invalid/fuchs.mp3', category: 'other' })
      .expect(403)
    await request(app).get('/api/search-radio?q=fuchs').expect(200)
    await request(app)
      .post('/api/search-radio/add')
      .send({ url: 'https://example.invalid/b.mp3', category: 'other' })
      .expect(403)
    const add = await request(app)
      .post('/api/search-radio/add')
      .send({ url: 'https://example.invalid/fuchs.mp3', category: 'other' })
      .expect(200)
    assert.equal(add.body.result, 'added')
    const row = library()[0]
    assert.equal(row.type, 'radio')
    assert.equal(row.id, 'https://example.invalid/fuchs.mp3')
    assert.equal(row.title, 'Fuchsradio')
    assert.equal(row.kidAdded, true)
    const own = await request(app).get('/api/search-pool/own').expect(200)
    assert.deepEqual(
      own.body.entries.map((e: { ident: string; kind: string; name: string }) => [e.ident, e.kind, e.name]),
      [['radio:example.invalid/fuchs.mp3', 'radio', 'Fuchsradio']],
    )
    // "Einträge verwalten": another tab, then out
    const ident = 'radio:example.invalid/fuchs.mp3'
    const moved = await request(app).post('/api/search-pool/move-own').send({ ident, category: 'music' }).expect(200)
    assert.equal(moved.body.result, 'moved')
    assert.equal(library()[0].category, 'music')
    await request(app).post('/api/search-pool/move-own').send({ ident, category: 'nowhere' }).expect(400)
    await request(app).post('/api/search-pool/remove-own').send({ ident }).expect(200)
    assert.equal(library().length, 0)
    await request(app).post('/api/search-pool/move-own').send({ ident, category: 'music' }).expect(404)
  })

  it('tips before anything is typed: children’s stations, asked again after 6 hours', async () => {
    const r = await request(app).get('/api/search-radio/tips').expect(200)
    assert.deepEqual(
      r.body.stations.map((s: { name: string }) => s.name),
      ['Kinderwelle'],
    )
    await request(app).get('/api/search-radio/tips').expect(200)
    assert.deepEqual(asked, ['tips|de'])
    now += 7 * 60 * 60 * 1000
    await request(app).get('/api/search-radio/tips').expect(200)
    assert.equal(asked.length, 2)
  })

  it('moves only what the child put in itself', async () => {
    writeFileSync(
      dataFile,
      JSON.stringify([{ type: 'radio', id: 'https://example.invalid/eltern.mp3', title: 'Eltern', category: 'other' }]),
    )
    await request(app)
      .post('/api/search-pool/move-own')
      .send({ ident: 'radio:example.invalid/eltern.mp3', category: 'music' })
      .expect(404)
    assert.equal(library()[0].category, 'other')
  })
})
