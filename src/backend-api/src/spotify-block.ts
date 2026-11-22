// Spotify blocking this box's Spotify app ("too many requests", 429 with a Retry-After of up to many hours): one
// block for everything that asks Spotify's Web API - the display's lists (services/spotify-api.service.ts) and the
// Smart-Sync (spotify-sync/state-machine.ts) use the same Spotify app, and each request during a block only keeps it
// going. Kept on the SD card (cache/spotify-block.json, written only when Spotify sets a block): it outlasts a restart
// of the box too - kept in RAM before, the box asked Spotify again right after booting and was blocked anew.
// It ends with its time (nothing asks Spotify before - the first answer after it is the sign). Another Spotify app
// (Client ID) entered in the app lets the box ask again at once - Spotify may block that one too (seen 03.10.: the
// block seems to hold for the account), then its answer sets the block anew.
//
// Fork "wishes": Spotify counts the requests of a development-mode app in quota buckets of their own (its quota modes
// page, undated; which endpoint is in which bucket it does not say). Seen on 22.11.2026: during a quota block from the
// artists' album lists (429, "QUOTA_EXCEEDED", 41855 s), /me/player still answered. Such a block - a QUOTA_EXCEEDED to a
// catalog request of this server - holds back the catalog only (playerUntil 0): the box goes on playing, pausing and
// skipping through the player, with the lists it keeps; the app's searches, artist pages and the Smart-Sync wait. Any
// other 429 (the 30-second rate limit counts all the app's requests) holds back the player too, as does every 429 the
// player is answered with (it notes playerUntil itself). A file of an older version has no playerUntil: all of it waits.

import * as fs from 'node:fs'
import * as path from 'node:path'

// (SPOTIFY_BLOCK_FILE: the tests' own file - the player takes the same variable)
const BLOCK_FILE = process.env.SPOTIFY_BLOCK_FILE || path.join(process.cwd(), 'cache', 'spotify-block.json')
// (where the block was kept before: taken over once)
const OLD_BLOCK_FILE = '/tmp/.spotify_block.json'

export interface SpotifyBlock {
  /** until when (ms since 1970) */
  until: number
  /** who was told: 'display' (the lists of the box) or 'sync' */
  source: string
  /** Spotify's answer, e.g. "429 from /artists/…/albums (Spotify: wait 55076 s)" */
  reason: string
  /** when Spotify said so (ms) */
  since: number
  /** until when the player's requests (playback, its state, the devices) wait too - 0: the catalog only; missing (a
   *  file of an older version): until */
  playerUntil?: number
}

/** Spotify's quota of the catalog used up: its 429 names it so (in the reason the box keeps of it). */
export const QUOTA_EXCEEDED = 'QUOTA_EXCEEDED'
const isQuota = (text: string) => text.includes(QUOTA_EXCEEDED)

/** Until when the player waits too (0: not at all). */
export function playerUntilOf(block: SpotifyBlock | null): number {
  if (!block) return 0
  return typeof block.playerUntil === 'number' ? Math.min(block.playerUntil, block.until) : block.until
}

// two notes of a block made one: the later end, and the player's later end
function merged(a: SpotifyBlock | null, b: SpotifyBlock | null): SpotifyBlock | null {
  if (!a) return b && { ...b, playerUntil: playerUntilOf(b) }
  if (!b) return { ...a, playerUntil: playerUntilOf(a) }
  const longer = b.until > a.until ? b : a
  return { ...longer, playerUntil: Math.max(playerUntilOf(a), playerUntilOf(b)) }
}

let current: SpotifyBlock | null = null
let loaded = false
// the file's time when it was read or written here: written by someone else since (the player notes a 429 of its own
// there) - read again
let fileMtime = -1
function fileTime(): number {
  try {
    return fs.statSync(BLOCK_FILE).mtimeMs
  } catch {
    return -1
  }
}

function readFile(file: string): SpotifyBlock | null {
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as SpotifyBlock
    return kept && typeof kept.until === 'number' && kept.until > Date.now() ? kept : null
  } catch {
    return null
  }
}

function write(): void {
  try {
    if (current) {
      fs.mkdirSync(path.dirname(BLOCK_FILE), { recursive: true })
      const tmp = `${BLOCK_FILE}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(current))
      fs.renameSync(tmp, BLOCK_FILE)
    } else {
      fs.rmSync(BLOCK_FILE, { force: true })
    }
    fileMtime = fileTime()
  } catch {
    // only for this run of the server then
  }
}

function load(): void {
  if (loaded) {
    const t = fileTime()
    if (t === fileMtime) return
    fileMtime = t
    // (the player notes its own 429s there - also one shorter than the catalog's block, which only moves playerUntil)
    const kept = readFile(BLOCK_FILE)
    if (kept) current = merged(current, kept)
    return
  }
  loaded = true
  fileMtime = fileTime()
  current = readFile(BLOCK_FILE)
  const old = readFile(OLD_BLOCK_FILE)
  if (old && (!current || old.until > current.until)) current = old
  // (kept here now; a block whose time is over is removed)
  write()
  try {
    fs.rmSync(OLD_BLOCK_FILE, { force: true })
  } catch {
    // gone already
  }
}

/** Spotify blocks until `until` (ms): kept unless a block that lasts longer is known already. */
export function noteSpotifyBlock(until: number, source: string, reason: string): void {
  load()
  if (!(until > Date.now())) return
  // (a QUOTA_EXCEEDED of the catalog holds back the catalog only - see above)
  const note: SpotifyBlock = { until, source, reason, since: Date.now(), playerUntil: isQuota(reason) ? 0 : until }
  const next = merged(current, note) as SpotifyBlock
  if (current && next.until === current.until && playerUntilOf(next) === playerUntilOf(current)) return
  current = next
  write()
}

/** The block in force, or null (one whose time is over is removed). */
export function spotifyBlock(): SpotifyBlock | null {
  load()
  if (current && current.until <= Date.now()) {
    current = null
    write()
  }
  return current
}

const clearedListeners: Array<() => void> = []
/** Told when a block is lifted before its time (the Smart-Sync's scheduler waits for it otherwise). */
export function onSpotifyBlockCleared(listener: () => void): void {
  clearedListeners.push(listener)
}

/** The block is over before its time: Spotify answered again, or another Spotify app was entered. */
export function clearSpotifyBlock(why: string): void {
  load()
  if (!current) return
  console.log(`${new Date().toLocaleString()}: [Spotify] block until ${new Date(current.until).toLocaleString()} lifted: ${why}`)
  current = null
  write()
  for (const listener of clearedListeners) {
    try {
      listener()
    } catch {
      // a listener's trouble is its own
    }
  }
}
