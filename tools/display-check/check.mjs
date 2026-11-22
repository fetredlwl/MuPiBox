// Display check of the fork "wishes": the search on the box display, tried as a parent tries it - with the child's
// eyes. Built display (www) + the real backend (from src, development mode) on invented data, Chrome at the box's
// sizes. Each rule is one the parents found by hand (22.11.2026); the build stops when one is broken.
//
//   R1  a note about Spotify only when it changes something for the child (Spotify does not play) - never for a block
//       of the catalog the box plays through ("Kontingente trennen"), and never taking room on the page (a popup)
//   R2  from the search into an artist or album: the search bar and keyboard are gone; back comes to the search as
//       it was (same text, same hits), without asking anything again
//   R3  the artist and album pages look like the start page's (album list header, covers) and nothing scrolls
//   R4  one way back on each page (no second "close" doing the same)
//   R5  the texts come from the display's translations (English box: no German on the page)
//
// Usage: node check.mjs <www dir> [--shots <dir>]   (needs Chrome; port 8200 and 4300 free)
// Exit code 0: all rules kept; 1: a rule broken (listed); 2: could not run.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const www = path.resolve(process.argv[2] ?? path.join(repo, 'src', 'deploy', 'www'))
const shotsAt = process.argv.indexOf('--shots')
const shots = shotsAt > 0 ? path.resolve(process.argv[shotsAt + 1]) : null
const STATIC_PORT = 4300
const API = 'http://localhost:8200/api'
const CHROME = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && fs.existsSync(p))

const failures = []
const passed = []
function rule(id, ok, what) {
  ;(ok ? passed : failures).push(`${id} ${what}`)
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${id} ${what}`)
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
const firstLine = (err) => String(err?.message ?? err).split(/\r?\n/)[0]

// ---------- invented test data (never anything of a real box) ----------
const A = (c) => c.repeat(22)
const now = new Date().toISOString()
const pool = [
  {
    id: 'p_artist',
    kind: 'artist',
    spotifyId: A('A'),
    name: 'Fritzi Funkel',
    artist: '',
    cover: '',
    addedAt: now,
    albumsAt: now,
    albums: [
      { id: A('B'), name: 'Tanz mit Fritzi', cover: '', release: '2021-01-01' },
      { id: A('C'), name: 'Fritzi am Meer', cover: '', release: '2022-01-01' },
      { id: A('D'), name: 'Fritzi und der Mond', cover: '', release: '2023-01-01' },
    ],
  },
  {
    id: 'p_album',
    kind: 'album',
    spotifyId: A('E'),
    name: 'Fridolin Pfeffer',
    artist: 'Fridolin',
    cover: '',
    addedAt: now,
  },
  {
    id: 'p_pod',
    kind: 'podcast',
    spotifyId: '',
    feedUrl: 'https://example.invalid/frosch.xml',
    name: 'Frosch-Funk',
    artist: 'Frosch',
    cover: '',
    addedAt: now,
  },
]
const library = [
  {
    type: 'radio',
    category: 'other',
    id: 'http://127.0.0.1:9/teststream',
    title: 'Testradio Eins',
    artist: 'Testradio',
    index: 0,
  },
]

function makeConfigDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mupibox-display-check-'))
  const cfg = path.join(dir, 'config')
  fs.mkdirSync(cfg)
  fs.mkdirSync(path.join(dir, 'cache'))
  fs.copyFileSync(path.join(repo, 'config', 'templates', 'www.json'), path.join(cfg, 'config.json'))
  const box = JSON.parse(fs.readFileSync(path.join(repo, 'config', 'templates', 'mupiboxconfig.json'), 'utf8'))
  box.mupibox = { ...box.mupibox, displaySearch: true, hiddenCategories: [] }
  // (R5: an English box - a German text on the page is one not taken from the translations)
  box.displayLanguage = 'en'
  box.spotify_sync = { ...(box.spotify_sync ?? {}), split_quota_block: true }
  fs.writeFileSync(path.join(cfg, 'mupiboxconfig.json'), JSON.stringify(box, null, 2))
  fs.writeFileSync(path.join(cfg, 'data.json'), JSON.stringify(library, null, 2))
  fs.writeFileSync(path.join(cfg, 'search-pool.json'), JSON.stringify(pool, null, 2))
  return dir
}

// (short: the backend keeps a block in memory until its end - a removed file does not end it; the check waits for it)
const BLOCK_MS = 15_000
let blockEnds = 0
function setBlock(dir, kind) {
  const file = path.join(dir, 'cache', 'spotify-block.json')
  if (kind === 'none') return fs.rmSync(file, { force: true })
  const until = Date.now() + BLOCK_MS
  blockEnds = Math.max(blockEnds, until)
  fs.writeFileSync(
    file,
    JSON.stringify({
      until,
      source: 'check',
      reason: `display check ${kind}, QUOTA_EXCEEDED`,
      since: Date.now(),
      playerUntil: kind === 'player' ? until : 0,
    }),
  )
  // (a later time: the backend reads the file again when its time changed)
  const t = new Date(Date.now() + 1000 * Math.random() + 1000)
  fs.utimesSync(file, t, t)
}

// ---------- the built display, served as the box serves it (unknown paths: index.html) ----------
function serveWww() {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }
  const server = http.createServer((req, res) => {
    // (the built display asks its own address for /api, as on the box: passed on to the backend)
    if ((req.url ?? '').startsWith('/api/')) {
      const out = http.request(
        {
          host: 'localhost',
          port: 8200,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: 'localhost:8200' },
        },
        (r) => {
          res.writeHead(r.statusCode ?? 502, r.headers)
          r.pipe(res)
        },
      )
      out.on('error', () => {
        res.writeHead(502)
        res.end()
      })
      req.pipe(out)
      return
    }
    const url = decodeURIComponent((req.url ?? '/').split('?')[0])
    let file = path.join(www, url)
    if (!file.startsWith(www) || !fs.existsSync(file) || fs.statSync(file).isDirectory())
      file = path.join(www, 'index.html')
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => server.listen(STATIC_PORT, () => resolve(server)))
}

async function startBackend(dir) {
  const tsx = path.join(repo, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const server = path.join(repo, 'src', 'backend-api', 'src', 'server.ts')
  const proc = spawn(process.execPath, [tsx, server], {
    cwd: dir,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  proc.stdout.on('data', (d) => (log += d))
  proc.stderr.on('data', (d) => (log += d))
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${API}/search-pool`)
      if (r.ok) return proc
    } catch {
      // not up yet
    }
    if (proc.exitCode !== null) break
    await wait(500)
  }
  await stopBackend(proc)
  throw new Error(`backend did not start:\n${log.slice(-2000)}`)
}

async function stopBackend(proc) {
  if (!proc || proc.exitCode !== null) return
  if (process.platform === 'win32') {
    await new Promise((resolve) =>
      spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }).on('exit', resolve),
    )
  } else {
    proc.kill('SIGTERM')
  }
  await wait(500)
}

// ---------- in the page ----------
// the page on top (Ionic keeps the ones behind in the DOM, hidden)
const TOP = `(() => [...document.querySelectorAll('ion-router-outlet > .ion-page')].filter((p) => !p.classList.contains('ion-page-hidden')).pop())()`

async function visibleCount(page, selector) {
  return page.evaluate(
    (top, sel) => {
      const root = eval(top) ?? document
      return [...root.querySelectorAll(sel)].filter((el) => {
        const r = el.getBoundingClientRect()
        const st = getComputedStyle(el)
        return (
          r.width > 0 &&
          r.height > 0 &&
          st.visibility !== 'hidden' &&
          st.display !== 'none' &&
          r.bottom > 0 &&
          r.top < innerHeight
        )
      }).length
    },
    TOP,
    selector,
  )
}

async function anywhereVisible(page, selector) {
  return page.evaluate(
    (sel) =>
      [...document.querySelectorAll(sel)].some((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
      }),
    selector,
  )
}

/** whether the page on top scrolls (its content higher than the screen), and whether something lies below the screen */
async function overflow(page) {
  return page.evaluate(async (top) => {
    const p = eval(top)
    const content = p?.querySelector('ion-content')
    const el = content?.getScrollElement ? await content.getScrollElement() : null
    const scrolls = el ? el.scrollHeight > el.clientHeight + 1 : false
    const below = [...(p?.querySelectorAll('button, img') ?? [])].some((b) => {
      const r = b.getBoundingClientRect()
      return r.height > 0 && r.bottom > innerHeight + 1
    })
    return { scrolls, below }
  }, TOP)
}

async function topTag(page) {
  return page.evaluate((top) => eval(top)?.tagName.toLowerCase() ?? '', TOP)
}

async function clickText(page, selector, text) {
  const ok = await page.evaluate(
    (top, sel, t) => {
      const el = [...(eval(top) ?? document).querySelectorAll(sel)].find((e) => e.textContent.includes(t))
      el?.click()
      return !!el
    },
    TOP,
    selector,
    text,
  )
  await wait(900)
  return ok
}

async function type(page, letters) {
  for (const k of letters) {
    await page.click(`app-search [data-skbtn="${k}"]`)
    await wait(120)
  }
  await wait(500)
}

/** the cover in front of an album list (coverflow: the active slide, km themes: the front card) */
async function clickFrontCover(page) {
  const box = await page.evaluate((top) => {
    const p = eval(top)
    const cands = [
      ...p.querySelectorAll('.km-stage-item, swiper-slide.swiper-slide-active ion-card, swiper-slide ion-card'),
    ]
    const vis = cands
      .map((e) => ({ e, r: e.getBoundingClientRect(), z: Number(getComputedStyle(e).zIndex) || 0 }))
      .filter((x) => x.r.width > 0 && x.r.left >= 0 && x.r.right <= innerWidth)
    vis.sort((a, b) => b.z - a.z)
    const r = vis[0]?.r
    return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null
  }, TOP)
  if (!box) return false
  await page.mouse.click(box.x, box.y)
  await wait(1000)
  return true
}

async function shot(page, name) {
  if (shots) await page.screenshot({ path: path.join(shots, `${name}.png`) })
}

// ---------- the run ----------
async function run(browser, dir, size) {
  const tag = `${size.width}x${size.height}`
  const page = await browser.newPage()
  await page.setViewport({ ...size, deviceScaleFactor: 1 })
  const asked = []
  page.on('request', (r) => asked.push(r.url()))

  setBlock(dir, 'none')
  await page.goto(`http://localhost:${STATIC_PORT}/search`, { waitUntil: 'networkidle2' })
  await wait(2500)
  await type(page, ['F', 'R', 'I'])
  const hitsBefore = await visibleCount(page, '.srch-hit')
  await shot(page, `${tag}-1-treffer`)
  rule('R1', !(await anywhereVisible(page, '.mupi-spotify-pause')), `${tag}: no Spotify note without a block`)
  rule(
    'R5',
    (
      await page.evaluate(
        () => document.querySelector('app-search .srch-placeholder, app-search .srch-text')?.textContent ?? '',
      )
    ).length > 0,
    `${tag}: search field drawn`,
  )

  // into the artist, an album, the tabs and back - a step that cannot be made breaks the rule and ends this part
  try {
    await navigation(page, tag, hitsBefore, asked)
  } catch (err) {
    rule('R2', false, `${tag}: the way through the search stopped (${firstLine(err)})`)
  }

  try {
    await blocks(page, tag, dir)
  } catch (err) {
    rule('R1', false, `${tag}: the block checks stopped (${firstLine(err)})`)
  }
  setBlock(dir, 'none')
  // (the next run starts without a block)
  await wait(Math.max(0, blockEnds - Date.now() + 1500))
  await page.close()
}

async function navigation(page, tag, hitsBefore, asked) {
  const atArtist = await clickText(page, '.srch-hit', 'Fritzi Funkel')
  rule('R2', atArtist && (await topTag(page)) === 'app-search-artist', `${tag}: a pool artist opens a page of its own`)
  if ((await topTag(page)) !== 'app-search-artist') throw new Error('no artist page')
  await shot(page, `${tag}-2-kuenstler`)
  rule(
    'R2',
    !(await anywhereVisible(page, 'app-search:not(.ion-page-hidden) .srch-field')) &&
      !(await anywhereVisible(page, 'app-search:not(.ion-page-hidden) .simple-keyboard')),
    `${tag}: artist page without search bar and keyboard`,
  )
  rule(
    'R3',
    (await visibleCount(page, 'ion-header.medialist-header')) === 1,
    `${tag}: artist page has the album list's header`,
  )
  rule('R3', (await visibleCount(page, 'mupi-swiper')) === 1, `${tag}: artist page shows the covers as the album list`)
  rule('R4', (await visibleCount(page, '[data-mupi-back]')) === 1, `${tag}: artist page has one way back`)
  rule('R3', !(await overflow(page)).scrolls, `${tag}: artist page does not scroll`)

  // into an album
  const atAlbum = await clickFrontCover(page)
  rule('R2', atAlbum && (await topTag(page)) === 'app-search-album', `${tag}: an album of the artist opens its page`)
  if ((await topTag(page)) !== 'app-search-album') throw new Error('no album page')
  await shot(page, `${tag}-3-album`)
  const o = await overflow(page)
  rule('R3', !o.scrolls && !o.below, `${tag}: album page fits the screen (no scrolling)`)
  rule(
    'R4',
    (await visibleCount(page, '[data-mupi-back]')) === 1 &&
      (await visibleCount(page, '[aria-label="Schließen"], [aria-label="Close"]')) === 0,
    `${tag}: album page has one way back, no second close`,
  )
  const words = await page.evaluate((top) => eval(top)?.innerText ?? '', TOP)
  rule(
    'R5',
    words.includes('To the start page') && !/Abspielen|Auf die Startseite|Wohin/.test(words),
    `${tag}: album page in the box's language`,
  )

  // the tabs
  await clickText(page, '.sa-btn', 'To the start page')
  await shot(page, `${tag}-4-reiter`)
  const o2 = await overflow(page)
  rule('R3', !o2.scrolls && !o2.below && (await visibleCount(page, '.sa-btn')) >= 2, `${tag}: the tabs fit the screen`)
  await page.click('app-search-album [data-mupi-back]')
  await wait(500)
  rule(
    'R4',
    (await topTag(page)) === 'app-search-album' && (await visibleCount(page, '.sa-main')) === 1,
    `${tag}: back from the tabs to the buttons, on the same page`,
  )

  // back to the search, as it was, nothing asked again
  const askedBefore = asked.length
  await page.click('app-search-album [data-mupi-back]')
  await wait(900)
  rule('R2', (await topTag(page)) === 'app-search-artist', `${tag}: back from the album to the artist`)
  await page.click('app-search-artist [data-mupi-back]')
  await wait(1200)
  const text = await page.evaluate(() => document.querySelector('app-search .srch-text')?.textContent ?? '')
  rule(
    'R2',
    (await topTag(page)) === 'app-search' &&
      text.trim() === 'FRI' &&
      (await visibleCount(page, '.srch-hit')) === hitsBefore,
    `${tag}: back to the search with the same text and hits`,
  )
  // (no list of the library read again, nothing of Spotify - the shell's own polls of every page, the screen, the
  // listening time, the pairing, go on as always; the pool and the block status are the box's own files)
  const again = asked
    .slice(askedBefore)
    .filter((u) =>
      /api\.spotify\.com|\/api\/(spotify\/|library|nas\/|data|rssfeed|home|media|artist|album|playlist|show)/.test(u),
    )
  rule(
    'R2',
    again.length === 0,
    `${tag}: nothing read again on the way back${again.length ? ` (${again.join(', ')})` : ''}`,
  )
}

/** the block as the backend reports it to the display (the check's own precondition) */
async function reported() {
  try {
    return await (await fetch(`${API}/spotify-block`)).json()
  } catch {
    return null
  }
}

async function blocks(page, tag, dir) {
  // a block of the catalog only, Spotify plays on: the child sees nothing
  setBlock(dir, 'catalog')
  await wait(300)
  const cat = await reported()
  rule(
    'R0',
    cat?.catalog === true && cat?.player === false,
    `${tag}: the backend reports the catalog block (${JSON.stringify(cat)})`,
  )
  await page.goto(`http://localhost:${STATIC_PORT}/search`, { waitUntil: 'networkidle2' })
  await wait(2500)
  await type(page, ['F', 'R', 'I'])
  await wait(1500)
  rule(
    'R1',
    !(await anywhereVisible(page, '.mupi-spotify-pause')) && (await visibleCount(page, '.srch-off')) === 0,
    `${tag}: catalog block with separate quotas - no note, nothing grey`,
  )

  // Spotify does not play: a popup (no room taken), Spotify hits grey, a tap tells why
  setBlock(dir, 'player')
  await wait(300)
  const pl = await reported()
  rule('R0', pl?.player === true, `${tag}: the backend reports the player block (${JSON.stringify(pl)})`)
  const contentTop = await page.evaluate(
    () => document.querySelector('app-search .srch-hits')?.getBoundingClientRect().top ?? 0,
  )
  await page.goto(`http://localhost:${STATIC_PORT}/search`, { waitUntil: 'networkidle2' })
  await wait(2500)
  rule(
    'R1',
    await anywhereVisible(page, '.mupi-spotify-pause-toast'),
    `${tag}: player blocked - a popup when the search opens`,
  )
  await type(page, ['F', 'R', 'I'])
  await wait(800)
  await shot(page, `${tag}-5-gesperrt`)
  rule('R1', (await visibleCount(page, '.srch-off')) > 0, `${tag}: player blocked - Spotify hits grey`)
  const topNow = await page.evaluate(
    () => document.querySelector('app-search .srch-hits')?.getBoundingClientRect().top ?? 0,
  )
  rule('R1', Math.abs(topNow - contentTop) < 2, `${tag}: the note takes no room on the page`)
}

async function main() {
  if (!fs.existsSync(path.join(www, 'index.html'))) {
    console.error(`no built display in ${www}`)
    process.exit(2)
  }
  if (!CHROME) {
    console.error('no Chrome found (set CHROME_PATH)')
    process.exit(2)
  }
  if (shots) fs.mkdirSync(shots, { recursive: true })
  const dir = makeConfigDir()
  const staticServer = await serveWww()
  let backend
  let browser
  try {
    backend = await startBackend(dir)
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check'],
    })
    for (const size of [
      { width: 1024, height: 600 },
      { width: 800, height: 480 },
    ])
      await run(browser, dir, size)
  } catch (err) {
    console.error(`display check could not run: ${err?.message ?? err}`)
    process.exitCode = 2
  } finally {
    await browser?.close()
    await stopBackend(backend)
    staticServer.close()
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    } catch {
      // (a file still held by Windows: the system's temp folder clears it)
    }
  }
  if (process.exitCode === 2) return
  console.log(`\n${passed.length} kept, ${failures.length} broken`)
  if (failures.length) {
    console.log(failures.map((f) => `  - ${f}`).join('\n'))
    process.exitCode = 1
  }
}

await main()
