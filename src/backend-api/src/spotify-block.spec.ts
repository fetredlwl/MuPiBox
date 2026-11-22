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
// the switch in the app (spotify_sync.split_quota_block)
let split = true
before(async () => {
  block = await import('./spotify-block')
  block.useQuotaSplit(() => split)
})
afterEach(() => {
  split = true
  block.clearSpotifyBlock('test over')
  fs.rmSync(FILE, { force: true })
})

const inFile = () =>
  JSON.parse(fs.readFileSync(FILE, 'utf8')) as { until: number; playerUntil?: number; reason: string }
const hours = (h: number) => Date.now() + h * 3600 * 1000
// (the file's time moves on: a second write in the same millisecond would look unchanged)
const writeFile = (content: unknown) => {
  fs.writeFileSync(FILE, JSON.stringify(content))
  const t = new Date(Date.now() + Math.random() * 100000)
  fs.utimesSync(FILE, t, t)
}

describe('spotify-block: a quota block of the catalog, switch on', () => {
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
    block.noteSpotifyBlock(
      until,
      'sync',
      '/x not asked: Spotify blocks for 41855 s more (429 (Spotify: wait 41855 s, QUOTA_EXCEEDED))',
    )
    assert.equal(block.playerUntilOf(block.spotifyBlock()), 0)
  })
})

describe('spotify-block: switch off (as MuPiBox has it)', () => {
  it('a quota block holds back the player too', () => {
    split = false
    const until = hours(11)
    block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
    assert.equal(block.playerUntilOf(block.spotifyBlock()), until)
    assert.equal(inFile().playerUntil, until)
  })

  it('the switch unreadable: as off', () => {
    block.useQuotaSplit(() => {
      throw new Error('no settings')
    })
    try {
      const until = hours(11)
      block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
      assert.equal(block.playerUntilOf(block.spotifyBlock()), until)
    } finally {
      block.useQuotaSplit(() => split)
    }
  })

  it('switched off during a quota block of the catalog: the player waits from then on', () => {
    const until = hours(11)
    block.noteSpotifyBlock(until, 'display', '429 (Spotify: wait 41855 s, QUOTA_EXCEEDED)')
    assert.equal(block.playerUntilOf(block.spotifyBlock()), 0)
    split = false
    block.holdPlayerToo()
    assert.equal(block.playerUntilOf(block.spotifyBlock()), until)
    assert.equal(inFile().playerUntil, until)
  })

  it('switched off without a block: nothing written', () => {
    block.holdPlayerToo()
    assert.equal(fs.existsSync(FILE), false)
  })
})

describe('spotify_sync.split_quota_block in the settings', () => {
  it('off unless set to true', async () => {
    const { loadSpotifySyncConfig } = await import('./spotify-sync/config-loader')
    type Cfg = Parameters<typeof loadSpotifySyncConfig>[0]
    assert.equal(loadSpotifySyncConfig({} as Cfg).split_quota_block, false)
    assert.equal(
      loadSpotifySyncConfig({ spotify_sync: { split_quota_block: 'yes' } } as unknown as Cfg).split_quota_block,
      false,
    )
    assert.equal(
      loadSpotifySyncConfig({ spotify_sync: { split_quota_block: true } } as unknown as Cfg).split_quota_block,
      true,
    )
  })
})

describe('the reason of a block the sync ran into', () => {
  it('keeps one "(told to the ...)"', async () => {
    const { oneToldTo, withoutToldTo } = await import('./spotify-sync/state-machine')
    const seen =
      "429 (Spotify: wait 41855 s) (told to the display's lists) (told to the sync) (told to the sync) (told to the sync)"
    assert.equal(oneToldTo(seen), "429 (Spotify: wait 41855 s) (told to the display's lists)")
    assert.equal(withoutToldTo(seen), '429 (Spotify: wait 41855 s)')
    assert.equal(
      oneToldTo('429 from /me/playlists (Spotify: wait 60 s)'),
      '429 from /me/playlists (Spotify: wait 60 s)',
    )
    assert.equal(
      oneToldTo('429 (Spotify: wait 5 s, QUOTA_EXCEEDED) (told to the sync)'),
      '429 (Spotify: wait 5 s, QUOTA_EXCEEDED) (told to the sync)',
    )
  })
})
