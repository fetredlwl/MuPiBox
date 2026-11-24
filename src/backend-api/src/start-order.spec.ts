// The start page sorted by the child (start-order.ts): only with the switch on, per tab, forgotten again with "A–Z".
import assert from 'node:assert'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, it } from 'node:test'
import express from 'express'
import request from 'supertest'
import { registerStartOrderRoutes } from './start-order'

let dir: string
let cfg: Record<string, unknown>
let app: express.Express

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'mupibox-start-order-test-'))
  cfg = { mupibox: { displayStartSort: true } }
  app = express()
  app.use(express.json())
  registerStartOrderRoutes(app, { configDir: dir, getMupiboxConfig: () => cfg })
})

describe('start order', () => {
  it('keeps the order of a tab, and forgets it again (A to Z)', async () => {
    assert.deepEqual((await request(app).get('/api/start-order')).body, { on: true, order: {} })
    await request(app)
      .post('/api/start-order')
      .send({ category: 'music', keys: ['artist:B', 'artist:A', 'spotify:x'] })
      .expect(200)
    await request(app).post('/api/start-order').send({ category: 'audiobook', keys: ['artist:C'] }).expect(200)
    const kept = JSON.parse(readFileSync(path.join(dir, 'start-order.json'), 'utf8'))
    assert.deepEqual(kept.music, ['artist:B', 'artist:A', 'spotify:x'])
    await request(app).post('/api/start-order/reset').send({ category: 'music' }).expect(200)
    assert.deepEqual((await request(app).get('/api/start-order')).body.order, { audiobook: ['artist:C'] })
  })

  it('changes nothing with the switch off or with what is not an order', async () => {
    await request(app).post('/api/start-order').send({ category: 'film', keys: [] }).expect(400)
    await request(app).post('/api/start-order').send({ category: 'music', keys: [1] }).expect(400)
    cfg = { mupibox: {} }
    await request(app).post('/api/start-order').send({ category: 'music', keys: ['artist:A'] }).expect(403)
    await request(app).post('/api/start-order/reset').send({ category: 'music' }).expect(403)
    assert.deepEqual((await request(app).get('/api/start-order')).body, { on: false, order: {} })
  })
})
