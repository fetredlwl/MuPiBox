import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, before, describe, it } from 'node:test'

// (a file of its own: the module reads SPOTIFY_BLOCK_FILE when it is loaded)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mupibox-block-'))
const FILE = path.join(dir, 'spotify-block.json')
process.env.SPOTIFY_BLOCK_FILE = FILE

type BlockModule = typeof import('./spotify-block')
let block: BlockModule
before(async () => {
  block = await import('./spotify-block')
})
afterEach(() => {
  block.clearSpotifyBlock('test over')
  fs.rmSync(FILE, { force: true })
})

const inFile = () => JSON.parse(fs.readFileSync(FILE, 'utf8')) as { until: number; playerUntil?: number; reason: string }
const hours = (h: number) => Date.now() + h * 3600 * 1000
// (the file's time moves on: a second write in the same millisecond would look unchanged)
const writeFile = (content: unknown) => {
  fs.writeFileSync(FILE, JSON.stringify(content))
  const t = new Date(Date.now() + Math.random() * 100000)
  fs.utimesSync(FILE, t, t)
}

describe('spotify-block: a quota block of the catalog', () => {
  it('holds back the catalog only - the player goes on', () => {
    const until = hours(11)
    block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
    const b = block.spotifyBlock()
    assert.equal(b?.until, until)
    assert.equal(block.playerUntilOf(b), 0)
    assert.equal(inFile().playerUntil, 0)
  })

  it('any other 429 holds back the player too', () => {
    const until = hours(1)
    block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 3600 s)')
    assert.equal(block.playerUntilOf(block.spotifyBlock()), until)
    assert.equal(inFile().playerUntil, until)
  })

  it('a file of an older version (no playerUntil) holds back all of it', () => {
    const until = hours(2)
    writeFile({ until, source: 'display', reason: '429', since: Date.now() })
    assert.equal(block.playerUntilOf(block.spotifyBlock()), until)
  })

  it('a short block of the player during a longer one of the catalog keeps both', () => {
    const catalog = hours(11)
    block.noteSpotifyBlock(catalog, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
    // the player notes its 429 itself (spotify-control.js): the catalog's end, its own playerUntil
    const player = Date.now() + 60_000
    writeFile({ ...inFile(), playerUntil: player })
    const b = block.spotifyBlock()
    assert.equal(b?.until, catalog)
    assert.equal(block.playerUntilOf(b), player)
    // a later note of the catalog does not take the player's wait away
    block.noteSpotifyBlock(hours(12), 'sync', '429 from /artists (Spotify: wait 43200 s, QUOTA_EXCEEDED)')
    assert.equal(block.playerUntilOf(block.spotifyBlock()), player)
    assert.equal(inFile().playerUntil, player)
  })

  it('a quota note after a block of all of it does not free the player', () => {
    const all = hours(1)
    block.noteSpotifyBlock(all, 'display', '429 (Spotify: wait 3600 s)')
    block.noteSpotifyBlock(hours(11), 'sync', '429 (Spotify: wait 39600 s, QUOTA_EXCEEDED)')
    const b = block.spotifyBlock()
    assert.equal(block.playerUntilOf(b), all)
    assert.ok((b?.until ?? 0) > all)
  })

  it('the sync noting the same block again (its reason carries the quota) changes nothing', () => {
    const until = hours(11)
    block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
    block.noteSpotifyBlock(until, 'sync', '/x not asked: Spotify blocks for 41855 s more (429 (Spotify: wait 41855 s, QUOTA_EXCEEDED))')
    assert.equal(block.playerUntilOf(block.spotifyBlock()), 0)
  })
})
