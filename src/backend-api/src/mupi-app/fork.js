// (fork "wishes") The app's part of the fork - kept out of app.js (splitti's file), so that his updates merge with few
// conflicts: the pages "Wünsche", "Für die Suche freigegeben" and "Suche am Display", the switch "Kind darf die
// Startseite sortieren", the sync's spacing of background requests and its quota switch, the search pool ("Nur in der
// Suche") of the app's Spotify search, the start page's note of open wishes and the fork's rows on the update page.
// app.js imports what its search sheets need from here and calls installFork once, with what of it this file uses.
// The texts are German, as in app.js - translated in i18n/fork/<lang>.json.
import { icon } from './icons.js'

// (app.js's - set by installFork before the first page is drawn)
let API, SYNC_API, state, lib, disp, search, CONTROLLERS
let $,
  api,
  esc,
  toast,
  ask,
  norm,
  renderPage,
  libChanged,
  navRow,
  connectSpotify,
  saveDisplayOptions,
  drawSearch,
  drawSpotifyMine,
  locale

/** once, from app.js: what of it this file uses, and the fork's pages and switches into its CONTROLLERS */
export function installFork(host) {
  ;({
    API,
    SYNC_API,
    state,
    lib,
    disp,
    search,
    CONTROLLERS,
    $,
    api,
    esc,
    toast,
    ask,
    norm,
    renderPage,
    libChanged,
    navRow,
    connectSpotify,
    saveDisplayOptions,
    drawSearch,
    drawSpotifyMine,
    locale,
  } = host)
  Object.assign(CONTROLLERS, {
    wuensche: { load: loadWishes, top: wishesTop, sections: () => [], mount: mountWishes },
    // the search pool and what the child fetched itself - search field, pages, "Entfernen"
    suchfreigaben: {
      load: loadPool,
      top: releasesTop,
      sections: () => [],
      mount: (root, page) => wirePoolControls(root, page),
    },
    // the search's switches (searchSections) - saved as on "Bedienung am Display"
    suchedisplay: {
      load: (page) => CONTROLLERS.bedienung.load(page),
      sections: () => searchSections(),
      change: (key, v, page) => CONTROLLERS.bedienung.change(key, v, page),
      mount(root) {
        root.querySelector('[data-sp-connect]')?.addEventListener('click', () => connectSpotify())
      },
    },
  })
  wrapBedienung(CONTROLLERS.bedienung)
  wrapSyncOptions(CONTROLLERS.syncopt)
}

// "Bedienung am Display": the fork's switches loaded with splitti's, its sections before "Haltezeiten", its keys saved
// here - the others by splitti's change
function wrapBedienung(c) {
  const { load, sections, change } = c
  c.load = async function (page) {
    await load.call(this, page)
    setControlValues()
  }
  c.sections = function (page) {
    const secs = sections.call(this, page)
    const at = secs.findIndex((s) => s.title === 'Haltezeiten')
    secs.splice(at >= 0 ? at : Math.min(1, secs.length), 0, ...bedienungSections())
    return secs
  }
  c.change = async function (key, v, page) {
    const r = await changeControl(key, v, page)
    return r === NOT_MINE ? change.call(this, key, v, page) : r
  }
}

// "Sync-Einstellungen": the spacing of the background requests and the quota switch after the sync interval (their
// values: loadSyncConfig in app.js)
function wrapSyncOptions(c) {
  const { sections, change } = c
  c.sections = function (page) {
    const secs = sections.call(this, page)
    const at = secs.findIndex((s) => s.items.some((it) => it.key === 'syncInt'))
    secs.splice(at >= 0 ? at + 1 : secs.length, 0, ...syncSections())
    return secs
  }
  // (saved at once, each in its own box - "Speichern" is the sync's button, in another box)
  c.change = async function (key, v, page) {
    if (key !== 'bgSec' && key !== 'quotaSplit') return change?.call(this, key, v, page)
    return changeSync(key, v)
  }
}

/* The start page's note and the library's tiles */

/** the note on the start page: wishes of the child wait for the parents */
export async function forkNotices() {
  const wishes = await api(`${API}/wishes`)
  const openWishes = wishes.ok ? (wishes.body?.open?.length ?? 0) : 0
  return openWishes
    ? [
        [
          'bulb',
          openWishes === 1 ? 'Ein Wunsch wartet' : `${openWishes} Wünsche warten`,
          'Antippen, um sie freizugeben oder abzulehnen.',
          'wuensche',
        ],
      ]
    : []
}

/** with the library: what the tiles "Wünsche" and "Für die Suche freigegeben" show */
export async function forkLoadLib(lib) {
  const [wishes, pool] = await Promise.all([api(`${API}/wishes`), api(`${API}/search-pool`)])
  // (the tile "Wünsche" - when they are on or some are open)
  lib.wishes = wishes.ok ? { on: wishes.body?.on === true, open: wishes.body?.open?.length ?? 0 } : null
  // (the tile "Für die Suche freigegeben": when something is in it, the wishes are on or "Nur in der Suche" is shown)
  lib.releases = pool.ok
    ? { n: pool.body?.entries?.length ?? 0, own: pool.body?.own?.length ?? 0, shown: pool.body?.appEnabled === true }
    : null
}

/** the library's tiles of the fork: [page, icon, title, sub] */
export function forkLibTiles(lib) {
  return [
    ...(lib.wishes && (lib.wishes.on || lib.wishes.open)
      ? [['wuensche', 'bulb', 'Wünsche', lib.wishes.open ? `${lib.wishes.open} offen` : 'Keine offenen']]
      : []),
    ...(lib.releases && (lib.releases.n || lib.releases.own || lib.releases.shown || lib.wishes?.on)
      ? [
          [
            'suchfreigaben',
            'search',
            'Für die Suche freigegeben',
            `${lib.releases.n} freigegeben · ${lib.releases.own} vom Kind geholt`,
          ],
        ]
      : []),
  ]
}

/* The search pool ("Nur in der Suche") in the app's search: its keys, its buttons, in and out */

// The search pool ("Nur in der Suche", backend search-pool.ts): allowed for the display's search, not on its start
// page - "kind:spotifyId" -> the pool entry's id (to take it out again)
// (a podcast by its feed, without http(s):// - as the backend's poolIdent)
export const poolKey = (e) =>
  e.kind === 'podcast' ? `podcast:${String(e.feedUrl ?? '').replace(/^https?:\/\//i, '')}` : `${e.kind}:${e.spotifyId}`
// (off under Bedienung › Suche - "Nur in der Suche" in der App: nothing of it is shown, the pool is kept)
export async function poolKeys() {
  const r = await api(`${API}/search-pool`)
  search.poolOn = r.ok && r.body?.appEnabled === true
  return new Map((search.poolOn ? (r.body?.entries ?? []) : []).map((e) => [poolKey(e), e.id]))
}

// Out of the search again (what the child put on the start page from it stays there - the parents take that out in
// the library, as any entry)
export async function removeFromPool(key, name) {
  const id = search.pool.get(key)
  if (!id) return false
  const r = await api(`${API}/search-pool/remove`, { method: 'POST', body: { id } })
  if (!r.ok) {
    toast('Das hat nicht geklappt', 'info')
    return false
  }
  search.pool.delete(key)
  drawSearch()
  drawSpotifyMine()
  toast(`Aus der Suche genommen: ${name}`)
  return true
}

// The pool's button in a sheet or on the artist page: "Nur in der Suche", or - in it already - "Aus der Suche nehmen"
export const poolButton = (inPool, attr) =>
  `<button class="btn" ${attr}="${inPool ? 'remove' : 'add'}">${icon(inPool ? 'close' : 'search', 18)}${esc(inPool ? 'Aus der Suche nehmen' : 'Nur in der Suche')}</button>`

// (a playlist Spotify made itself - "This Is …", mixes: Spotify does not hand it to the box, it would not play)
export const isSpotifyOwnPlaylist = (id) => /^37i9dQZF/.test(String(id ?? ''))

export async function addToPool(item) {
  const r = await api(`${API}/search-pool`, { method: 'POST', body: item })
  if (!r.ok) {
    toast(
      r.body?.error === 'spotify_own_playlist'
        ? 'Diese Playlist ist von Spotify selbst – sie spielt auf der Box nicht'
        : 'Das hat nicht geklappt',
      'info',
    )
    return false
  }
  search.pool.set(poolKey(item), r.body?.entry?.id)
  drawSearch()
  drawSpotifyMine()
  // (an artist: its albums come in the background, one page after the other - see Sync-Einstellungen)
  toast(
    item.kind === 'artist'
      ? `In der Suche: ${item.name} – die Alben lädt die Box im Hintergrund nach`
      : `In der Suche: ${item.name}`,
  )
  return true
}

export const POOL_HELP =
  '„Nur in der Suche“: nicht auf der Startseite. Das Kind findet es mit der Suche am Display, kann es abspielen und selbst unter einen Reiter holen.'

/* Bibliothek › Wünsche, Bibliothek › Für die Suche freigegeben */

// (fork "wishes") Wünsche: what the child wished from Spotify on the display (backend wishes.ts) - approved, it goes on
// the start page under the tab the child chose; Home Assistant links here (#/wuensche)
const wishesState = { on: false, open: [], decided: [], archived: [] }
const WISH_KIND = { album: 'Album', artist: 'Künstler', show: 'Podcast', track: 'Song' }
const WISH_CAT = { audiobook: 'Hörspiele', music: 'Musik', other: 'Radio & Podcasts' }
// (the lists grow - a search field over all of them, pages as in "Für die Suche freigegeben", the size remembered here)
const wishView = { q: '', size: null, page: { open: 0, decided: 0, archived: 0 } }
function wishPageSize() {
  if (wishView.size === null) {
    let saved = 10
    try {
      saved = Number(localStorage.getItem('mupi-wish-page-size') ?? 10)
    } catch {
      // (private mode: the default)
    }
    wishView.size = POOL_PAGE_SIZES.includes(saved) ? saved : 10
  }
  return wishView.size
}

async function loadWishes() {
  const r = await api(`${API}/wishes`)
  if (!r.ok) throw new Error(`wishes ${r.status}`)
  Object.assign(wishesState, {
    on: r.body?.on === true,
    open: r.body?.open ?? [],
    decided: r.body?.decided ?? [],
    archived: r.body?.archived ?? [],
  })
}

function wishesTop() {
  const size = wishPageSize()
  const { open, decided, archived } = wishesState
  const many = open.length + decided.length + archived.length > 5
  const rejected = decided.some((w) => w.status === 'rejected')
  return [
    `<p class="page-intro">${esc('Was das Kind in der Suche am Display bei Spotify gefunden und sich gewünscht hat. Freigegeben kommt es auf die Startseite – unter den Reiter, den das Kind gewählt hat. Die Freigabe bleibt: Das Kind kann es selbst entfernen und über die Suche wieder holen, bis du sie widerrufst.')}</p>`,
    ...(wishesState.on
      ? []
      : [
          `<p class="help">${esc('Wünsche sind ausgeschaltet: Display & Bedienung › Suche am Display › „Wünsche aus Spotify“.')}</p>`,
        ]),
    ...(many
      ? [
          `<section class="card wide"><div class="search">${icon('search')}<input class="input" id="wish-q" type="search" placeholder="${esc('In den Wünschen suchen')}" autocomplete="off" value="${esc(wishView.q)}"></div>
      <div class="field" style="margin:0"><label>${esc('Pro Seite')}</label><div class="seg" id="wish-size">${POOL_PAGE_SIZES.map((n) => `<button aria-pressed="${n === size}" data-v="${n}">${n || 'Alle'}</button>`).join('')}</div></div></section>`,
        ]
      : []),
    `<section class="card wide"><h2>${esc('Offene Wünsche')}</h2><div class="rows" id="wish-open-rows"></div><div id="wish-open-pager"></div>${
      open.length > 1
        ? `<div class="btns"><button class="btn primary" id="wish-approve-all">${icon('check', 18)}${esc('Alle freigeben')}</button></div>`
        : ''
    }</section>`,
    ...(decided.length
      ? [
          `<section class="card wide"><h2>${esc('Entschieden')}</h2><div class="rows" id="wish-decided-rows"></div><div id="wish-decided-pager"></div>
          <p class="help">${esc('Aus der Liste entfernen: Freigaben kommen ins Archiv und lassen sich dort weiter widerrufen, Abgelehnte werden gelöscht. Zu Beginn jedes Quartals räumt die Box die Liste selbst so auf.')}</p>
          <div class="btns">${rejected ? `<button class="btn" id="wish-forget-rejected">${icon('close', 18)}${esc('Abgelehnte löschen')}</button>` : ''}<button class="btn" id="wish-forget-all">${icon('close', 18)}${esc('Liste leeren')}</button></div></section>`,
        ]
      : []),
    ...(archived.length
      ? [
          `<section class="card wide"><h2>${esc('Archiv')}</h2><p class="help" style="margin:0">${esc('Ältere Freigaben. Sie gelten weiter – widerrufen geht auch hier.')}</p><div class="rows" id="wish-archived-rows"></div><div id="wish-archived-pager"></div></section>`,
        ]
      : []),
  ]
}

// one page of a wish list (filtered by the search field) and its pager
function wishPage(list, which) {
  const size = wishPageSize()
  const pages = size ? Math.max(1, Math.ceil(list.length / size)) : 1
  wishView.page[which] = Math.min(Math.max(0, wishView.page[which]), pages - 1)
  const at = wishView.page[which]
  const shown = size ? list.slice(at * size, at * size + size) : list
  const pager =
    pages > 1
      ? `<div class="btns" style="align-items:center"><button class="btn" data-wpg="${which}:-1"${at === 0 ? ' disabled' : ''}>${icon('back', 18)}${esc('Zurück')}</button><span class="help" style="margin:0 8px">${esc(`Seite ${at + 1} von ${pages} · ${list.length} Einträge`)}</span><button class="btn" data-wpg="${which}:1"${at >= pages - 1 ? ' disabled' : ''}>${esc('Weiter')}${icon('chevron', 18)}</button></div>`
      : ''
  return { shown, pager }
}

function drawWishLists(root, page) {
  const thumb = (img) =>
    `<span class="lib-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}${icon('music', 18)}</span>`
  const when = (iso) => (iso ? new Date(iso).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' }) : '')
  const row = (w, buttons) =>
    `<div class="entry lib-row">${thumb(w.cover)}<span class="lbl"><b translate="no">${esc(w.name)}</b><small><span translate="no">${esc(w.artist || '')}</span>${w.artist ? ' · ' : ''}${esc(WISH_KIND[w.kind] ?? w.kind)} · ${esc(w.target ? `in Playlist „${w.target.name}“` : (WISH_CAT[w.category] ?? w.category))} · ${esc(when(w.at))}</small></span>${buttons}</div>`
  const q = norm(wishView.q.trim())
  const hit = (w) => !q || [w.name, w.artist, w.target?.name].some((t) => norm(String(t ?? '')).includes(q))
  const none = (empty) => `<p class="help" style="margin:0">${esc(q ? 'Nichts gefunden.' : empty)}</p>`
  const draw = (which, list, buttons, empty) => {
    const el = $(`#wish-${which}-rows`, root)
    if (!el) return
    const { shown, pager } = wishPage(list.filter(hit), which)
    el.innerHTML = shown.map((w) => row(w, buttons(w))).join('') || none(empty)
    $(`#wish-${which}-pager`, root).innerHTML = pager
  }
  draw(
    'open',
    wishesState.open,
    (w) =>
      `<span class="btns" style="flex-wrap:nowrap"><button class="btn" data-wish-no="${esc(w.id)}">${esc('Ablehnen')}</button><button class="btn primary" data-wish-yes="${esc(w.id)}">${icon('check', 18)}${esc('Freigeben')}</button></span>`,
    'Keine offenen Wünsche.',
  )
  draw(
    'decided',
    wishesState.decided,
    (w) =>
      `<span class="btns" style="flex-wrap:nowrap;align-items:center">${
        w.status === 'approved'
          ? `<span class="in-lib">${esc('Freigegeben')}</span><button class="btn" data-wish-revoke="${esc(w.id)}">${esc('Widerrufen')}</button>`
          : `<span class="in-lib">${esc(w.status === 'revoked' ? 'Zurückgenommen' : 'Abgelehnt')}</span>`
      }<button class="icon-btn" data-wish-forget="${esc(w.id)}" title="${esc('Aus der Liste entfernen')}" aria-label="${esc('Aus der Liste entfernen')}">${icon('close', 18)}</button></span>`,
    'Noch leer.',
  )
  draw(
    'archived',
    wishesState.archived,
    (w) =>
      `<span class="btns" style="flex-wrap:nowrap;align-items:center"><span class="in-lib">${esc('Freigegeben')}</span><button class="btn" data-wish-revoke="${esc(w.id)}">${esc('Widerrufen')}</button></span>`,
    'Noch leer.',
  )
  for (const img of root.querySelectorAll('.lib-thumb img'))
    img.addEventListener('error', () => img.remove(), { once: true })
  for (const b of root.querySelectorAll('[data-wpg]'))
    b.onclick = () => {
      const [which, step] = b.dataset.wpg.split(':')
      wishView.page[which] += Number(step)
      drawWishLists(root, page)
    }
  mountWishRows(root, page)
}

function mountWishes(root, page) {
  const q = $('#wish-q', root)
  if (q)
    q.oninput = () => {
      wishView.q = q.value
      wishView.page = { open: 0, decided: 0, archived: 0 }
      drawWishLists(root, page)
    }
  for (const b of root.querySelectorAll('#wish-size [data-v]'))
    b.onclick = () => {
      wishView.size = Number(b.dataset.v)
      try {
        localStorage.setItem('mupi-wish-page-size', String(wishView.size))
      } catch {
        // (private mode: for now only)
      }
      for (const x of root.querySelectorAll('#wish-size [data-v]')) x.setAttribute('aria-pressed', String(x === b))
      wishView.page = { open: 0, decided: 0, archived: 0 }
      drawWishLists(root, page)
    }
  const reload = async () => {
    await loadWishes()
    renderPage(page, false)
  }
  const approveAll = $('#wish-approve-all', root)
  if (approveAll)
    approveAll.onclick = async () => {
      const n = wishesState.open.length
      if (
        !(await ask(
          'Alle freigeben?',
          `Alle ${n} offenen Wünsche werden freigegeben – Songs kommen in die gewünschte Playlist, alles andere auf die Startseite unter den gewählten Reiter.`,
          'Alle freigeben',
        ))
      )
        return
      approveAll.disabled = true
      const r = await api(`${API}/wishes/approve-all`, { method: 'POST', body: {} })
      if (!r.ok) {
        approveAll.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      toast(
        r.body?.failed
          ? `${r.body.approved} freigegeben, ${r.body.failed} nicht – sie bleiben offen`
          : `${r.body?.approved ?? 0} freigegeben`,
      )
      libChanged()
      lib.items = null
      await reload()
    }
  // decided wishes out of the list (approvals into the archive)
  const forgetMany = async (b, body, title, text, yes, done) => {
    if (!(await ask(title, text, yes))) return
    b.disabled = true
    const r = await api(`${API}/wishes/forget`, { method: 'POST', body })
    if (!r.ok) {
      b.disabled = false
      return toast('Das hat nicht geklappt', 'info')
    }
    toast(done)
    await reload()
  }
  const rejected = $('#wish-forget-rejected', root)
  if (rejected)
    rejected.onclick = () =>
      forgetMany(
        rejected,
        { rejected: true },
        'Abgelehnte löschen?',
        'Die abgelehnten Wünsche verschwinden aus der Liste. Das Kind kann sie sich wieder wünschen.',
        'Löschen',
        'Abgelehnte gelöscht',
      )
  const all = $('#wish-forget-all', root)
  if (all)
    all.onclick = () =>
      forgetMany(
        all,
        { all: true },
        'Liste leeren?',
        'Die entschiedenen Wünsche verschwinden aus der Liste – Freigaben kommen ins Archiv und gelten weiter. Offene Wünsche bleiben.',
        'Leeren',
        'Liste geleert',
      )
  drawWishLists(root, page)
}

// the buttons of the rows (drawn again with each page of a list)
function mountWishRows(root, page) {
  const reload = async () => {
    await loadWishes()
    renderPage(page, false)
  }
  const decide = async (b, approve) => {
    const w = wishesState.open.find((x) => x.id === (approve ? b.dataset.wishYes : b.dataset.wishNo))
    if (!w) return
    b.disabled = true
    const r = await api(`${API}/wishes/decide`, { method: 'POST', body: { id: w.id, approve } })
    if (!r.ok) {
      b.disabled = false
      // ((fork "wishes") a song: its playlist is no longer on the start page - nothing changed)
      if (r.body?.error === 'no_target')
        return toast(
          `Die Playlist „${w.target?.name ?? ''}“ ist nicht mehr auf der Startseite – erst wieder dorthin holen oder ablehnen`,
          'info',
        )
      return toast('Das hat nicht geklappt', 'info')
    }
    toast(
      approve
        ? w.kind === 'track'
          ? `Freigegeben: ${w.name} – ist jetzt in „${w.target?.name ?? ''}“`
          : `Freigegeben: ${w.name} – steht unter ${WISH_CAT[w.category] ?? w.category}`
        : `Abgelehnt: ${w.name}`,
    )
    if (approve) libChanged()
    lib.items = null
    await reload()
  }
  for (const b of root.querySelectorAll('[data-wish-yes]')) b.onclick = () => decide(b, true)
  for (const b of root.querySelectorAll('[data-wish-no]')) b.onclick = () => decide(b, false)
  // one decided wish out of the list (an approval into the archive)
  for (const b of root.querySelectorAll('[data-wish-forget]'))
    b.onclick = async () => {
      b.disabled = true
      const r = await api(`${API}/wishes/forget`, { method: 'POST', body: { id: b.dataset.wishForget } })
      if (!r.ok) {
        b.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      await reload()
    }
  // an approval taken back (in the list or in the archive): out of the search, off the start page
  for (const b of root.querySelectorAll('[data-wish-revoke]'))
    b.onclick = async () => {
      const w = [...wishesState.decided, ...wishesState.archived].find((x) => x.id === b.dataset.wishRevoke)
      if (!w) return
      if (
        !(await ask(
          'Freigabe widerrufen?',
          w.kind === 'track'
            ? `„${w.name}“ verschwindet aus den Playlists des Kindes – außer sein Album oder der ganze Künstler ist freigegeben. Das Kind kann es sich danach wieder wünschen.`
            : `„${w.name}“ verschwindet aus der Suche am Display und von der Startseite. Das Kind kann es sich danach wieder wünschen.`,
          'Widerrufen',
        ))
      )
        return
      b.disabled = true
      const r = await api(`${API}/wishes/revoke`, { method: 'POST', body: { id: w.id } })
      if (!r.ok) {
        b.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      // ((fork "wishes") a song: where it was taken out of, or that another approval keeps it)
      toast(
        w.kind === 'track' && r.body?.still
          ? `Zurückgenommen: ${w.name} – bleibt, weil Album oder Künstler freigegeben ist`
          : w.kind === 'track' && r.body?.removed?.length
            ? `Zurückgenommen: ${w.name} – aus „${r.body.removed.join('“, „')}“ genommen`
            : `Zurückgenommen: ${w.name}`,
      )
      libChanged()
      lib.items = null
      await reload()
    }
}

// The search pool ("Nur in der Suche") under Bedienung › Suche: what is allowed, with "Entfernen", and what the child
// put on the start page from it (the parents take those out in the library, as any entry)
const POOL_KIND = { artist: 'Künstler', album: 'Album', playlist: 'Playlist', show: 'Podcast', podcast: 'Podcast' }
const POOL_CAT = { audiobook: 'Hörspiele', music: 'Musik', other: 'Radio & Podcasts' }
// The two lists can get long (many artists): a search field, pages of 5 / 10 / 20 / 50 or all (remembered on this
// device) and paging - drawn into their boxes by drawPoolLists, the rest of the page stays (the field keeps its focus)
const POOL_PAGE_SIZES = [5, 10, 20, 50, 0]
const poolView = { q: '', size: null, page: { entries: 0, own: 0 } }
function poolPageSize() {
  if (poolView.size === null) {
    let saved = 10
    try {
      saved = Number(localStorage.getItem('mupi-pool-page-size') ?? 10)
    } catch {
      // (private mode: the default)
    }
    poolView.size = POOL_PAGE_SIZES.includes(saved) ? saved : 10
  }
  return poolView.size
}

/** the pool and what the child fetched itself (Bibliothek › Für die Suche freigegeben) */
async function loadPool() {
  const pool = await api(`${API}/search-pool`)
  disp.pool = pool.ok ? pool.body : { entries: [], own: [] }
}

function releasesTop() {
  return [
    `<p class="page-intro">${esc('Was das Kind in der Suche am Display finden und selbst auf die Startseite holen darf, und was es schon geholt hat.')}</p>`,
    `<section class="card wide">${poolListHtml()}</section>`,
  ]
}

function poolListHtml() {
  const p = disp.pool ?? { entries: [], own: [] }
  const size = poolPageSize()
  const many = (p.entries?.length ?? 0) + (p.own?.length ?? 0) > 5
  return `<div class="field"><label>${esc('Vorrat der Suche')}</label>
      <p class="help" style="margin:0">${esc(p.appEnabled ? 'Hinzufügen: Bibliothek › Auf Spotify suchen › „Nur in der Suche“. Nichts davon steht auf der Startseite.' : 'Nichts davon steht auf der Startseite.')} ${esc('Freigegebene Wünsche kommen auch hierher.')}</p>
      ${
        many
          ? `<div class="search">${icon('search')}<input class="input" id="pool-q" type="search" placeholder="${esc('Im Vorrat suchen')}" autocomplete="off" value="${esc(poolView.q)}"></div>
      <div class="field" style="margin:0"><label>${esc('Pro Seite')}</label><div class="seg" id="pool-size">${POOL_PAGE_SIZES.map((n) => `<button aria-pressed="${n === size}" data-v="${n}">${n || 'Alle'}</button>`).join('')}</div></div>`
          : ''
      }
      <div class="rows" id="pool-rows"></div><div id="pool-pager"></div>
      ${(p.entries?.length ?? 0) ? `<div class="btns"><button class="btn danger" id="pool-clear">${icon('close', 18)}${esc('Alle Freigaben löschen')}</button></div>` : ''}</div>
    ${(p.own ?? []).length ? `<div class="field"><label>${esc('Vom Kind auf die Startseite geholt')}</label><p class="help" style="margin:0">${esc('Das Kind kann diese am Display wieder entfernen, du hier. Was im Vorrat ist, bleibt dort – das Kind kann es wieder holen.')}</p><div class="rows" id="own-rows"></div><div id="own-pager"></div></div>` : ''}`
}

// one page of a list (filtered by the search field) and its pager; page: the list's page in poolView
function poolPage(list, which) {
  const size = poolPageSize()
  const pages = size ? Math.max(1, Math.ceil(list.length / size)) : 1
  poolView.page[which] = Math.min(Math.max(0, poolView.page[which]), pages - 1)
  const at = poolView.page[which]
  const shown = size ? list.slice(at * size, at * size + size) : list
  const pager =
    pages > 1
      ? `<div class="btns" style="align-items:center"><button class="btn" data-pg="${which}:-1"${at === 0 ? ' disabled' : ''}>${icon('back', 18)}${esc('Zurück')}</button><span class="help" style="margin:0 8px">${esc(`Seite ${at + 1} von ${pages} · ${list.length} Einträge`)}</span><button class="btn" data-pg="${which}:1"${at >= pages - 1 ? ' disabled' : ''}>${esc('Weiter')}${icon('chevron', 18)}</button></div>`
      : ''
  return { shown, pager }
}

function drawPoolLists(root, page) {
  const p = disp.pool ?? { entries: [], own: [] }
  const q = norm(poolView.q.trim())
  const hit = (...texts) => !q || texts.some((t) => norm(String(t ?? '')).includes(q))
  const thumb = (img) =>
    `<span class="lib-thumb">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : ''}${icon('music', 18)}</span>`
  const entries = [...(p.entries ?? [])]
    .filter((e) => hit(e.name, e.artist))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'de', { numeric: true }))
  const own = (p.own ?? []).filter((o) => hit(o.name, o.artist))
  const rowsEl = $('#pool-rows', root)
  if (rowsEl) {
    const { shown, pager } = poolPage(entries, 'entries')
    rowsEl.innerHTML =
      shown
        .map((e) => {
          const sub = [
            POOL_KIND[e.kind] ?? e.kind,
            e.artist,
            e.kind === 'artist'
              ? e.loading
                ? e.albums
                  ? `${e.albums.length} Alben · wird aufgefrischt`
                  : 'Alben werden im Hintergrund geladen'
                : e.albums
                  ? `${e.albums.length} Alben`
                  : 'Alben noch nicht geladen'
              : '',
          ]
            .filter(Boolean)
            .join(' · ')
          return `<div class="entry lib-row">${thumb(e.cover)}<span class="lbl"><b translate="no">${esc(e.name)}</b><small translate="no">${esc(sub)}</small></span><button class="btn" data-pool-rm="${esc(e.id)}">${esc('Entfernen')}</button></div>`
        })
        .join('') || `<p class="help" style="margin:0">${esc(q ? 'Nichts gefunden.' : 'Noch leer.')}</p>`
    $('#pool-pager', root).innerHTML = pager
  }
  const ownEl = $('#own-rows', root)
  if (ownEl) {
    const { shown, pager } = poolPage(own, 'own')
    ownEl.innerHTML =
      shown
        .map((o) => {
          const when = o.addedAt ? new Date(o.addedAt).toLocaleDateString(locale(), { dateStyle: 'short' }) : ''
          const sub = [POOL_KIND[o.kind] ?? o.kind, o.artist, POOL_CAT[o.category] ?? o.category, when]
            .filter(Boolean)
            .join(' · ')
          return `<div class="entry lib-row">${thumb(o.cover)}<span class="lbl"><b translate="no">${esc(o.name)}</b><small translate="no">${esc(sub)}</small></span><button class="btn" data-own-rm="${esc(o.ident)}" data-own-name="${esc(o.name)}">${esc('Entfernen')}</button></div>`
        })
        .join('') || `<p class="help" style="margin:0">${esc('Nichts gefunden.')}</p>`
    $('#own-pager', root).innerHTML = pager
  }
  for (const img of root.querySelectorAll('#pool-rows img, #own-rows img'))
    img.addEventListener('error', () => img.remove(), { once: true })
  for (const b of root.querySelectorAll('[data-pg]'))
    b.onclick = () => {
      const [which, step] = b.dataset.pg.split(':')
      poolView.page[which] += Number(step)
      drawPoolLists(root, page)
    }
  // "Entfernen" of the pool
  for (const b of root.querySelectorAll('[data-pool-rm]'))
    b.onclick = async () => {
      b.disabled = true
      const r = await api(`${API}/search-pool/remove`, { method: 'POST', body: { id: b.dataset.poolRm } })
      if (!r.ok) {
        b.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      toast('Aus der Suche entfernt')
      await loadPool()
      renderPage(page, false)
    }
  // what the child put on the start page: off it again (a library entry - asked first)
  for (const b of root.querySelectorAll('[data-own-rm]'))
    b.onclick = async () => {
      const name = b.dataset.ownName || 'Eintrag'
      if (
        !(await ask(
          `„${name}“ entfernen?`,
          'Der Eintrag verschwindet von der Startseite der Box. Ist er im Vorrat, kann das Kind ihn über die Suche wieder holen.',
          'Entfernen',
        ))
      )
        return
      b.disabled = true
      const r = await api(`${API}/search-pool/remove-own`, { method: 'POST', body: { ident: b.dataset.ownRm } })
      if (!r.ok) {
        b.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      toast(`Von der Startseite entfernt: ${name}`)
      libChanged()
      await loadPool()
      renderPage(page, false)
    }
}

// the search field and "pro Seite": wired once per drawing of the page
function wirePoolControls(root, page) {
  const q = $('#pool-q', root)
  if (q)
    q.oninput = () => {
      poolView.q = q.value
      poolView.page = { entries: 0, own: 0 }
      drawPoolLists(root, page)
    }
  // "Alle Freigaben löschen": the whole pool, asked first (what the child put on the start page stays)
  const clear = $('#pool-clear', root)
  if (clear)
    clear.onclick = async () => {
      const n = disp.pool?.entries?.length ?? 0
      if (
        !(await ask(
          'Alle Freigaben löschen?',
          `${n} Einträge verschwinden aus der Suche am Display. Was das Kind schon auf die Startseite geholt hat, bleibt dort.`,
          'Alle löschen',
        ))
      )
        return
      clear.disabled = true
      const r = await api(`${API}/search-pool/clear`, { method: 'POST' })
      if (!r.ok) {
        clear.disabled = false
        return toast('Das hat nicht geklappt', 'info')
      }
      toast('Alle Freigaben gelöscht')
      await loadPool()
      renderPage(page, false)
    }
  const seg = $('#pool-size', root)
  if (seg)
    seg.onclick = (e) => {
      const b = e.target.closest('button')
      if (!b) return
      poolView.size = Number(b.dataset.v)
      poolView.page = { entries: 0, own: 0 }
      try {
        localStorage.setItem('mupi-pool-page-size', String(poolView.size))
      } catch {
        // (private mode: for this visit only)
      }
      for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b))
      drawPoolLists(root, page)
    }
  drawPoolLists(root, page)
}

/* Display & Bedienung › Suche am Display, and the start page's switch under "Bedienung am Display" */

// (fork "wishes") "Suche am Display": everything the child may do in the display's search, in one place - the magnifier,
// what Spotify brings (wishes, songs, playlists; the right to change the child's private playlists asked where it is
// switched on), podcasts and radio for children. Was a section of "Bedienung am Display".
function searchSections() {
  const on = !!state.values.get('dispSearch')
  const writes =
    !!state.values.get('dispTracks') || (!!state.values.get('dispPlaylists') && !!state.values.get('dispPlCreate'))
  const right = !!state.values.get('plScope')
  return [
    {
      title: 'Suche',
      items: [
        {
          type: 'toggle',
          key: 'dispSearch',
          label: 'Suche auf dem Display',
          help: 'Eine Lupe oben links auf der Startseite öffnet eine Suche mit Bildschirmtastatur. Gesucht wird in der Bibliothek der Box – in den Reitern, die sichtbar sind – und im Vorrat unten.',
        },
        {
          type: 'toggle',
          key: 'appPool',
          label: '„Nur in der Suche“ in der App',
          help: 'Zeigt in der App beim Hinzufügen die Knöpfe „Nur in der Suche“. Aus: ausgeblendet, der Vorrat bleibt erhalten – die Suche am Display findet ihn weiter, solange sie an ist.',
        },
      ],
    },
    {
      title: 'Spotify',
      items: [
        {
          type: 'toggle',
          key: 'dispWishes',
          label: 'Wünsche aus Spotify',
          help: 'In der Suche am Display sucht eine Kachel „Bei Spotify suchen“ nach Alben, Künstlern und Podcasts. Das Kind kann sich etwas wünschen und den Reiter wählen; du gibst es in der App frei (Bibliothek › Wünsche), Home Assistant bekommt eine Nachricht mit Link. Spotify wird erst beim Tippen auf die Kachel gefragt, jeweils 10 Treffer, weitere erst beim Weiterblättern; jede Seite merkt sich die Box einen Tag. Aus: keine Spotify-Suche am Display, alles andere bleibt.',
          disabled: !on,
        },
        {
          type: 'toggle',
          key: 'dispTracks',
          label: 'Einzelne Songs aus Spotify',
          help: 'Die Spotify-Suche am Display findet auch einzelne Songs (Songs mit anstößigem Text nie). Kann das Kind den Song schon hören – sein Album oder der ganze Künstler ist auf der Box oder freigegeben –, legt es ihn gleich in eine seiner Playlists auf der Startseite; sonst wünscht es ihn sich für eine davon, und du gibst ihn unter Bibliothek › Wünsche frei. Braucht „Wünsche aus Spotify“.',
          disabled: !on || !state.values.get('dispWishes'),
        },
        {
          type: 'toggle',
          key: 'dispPlaylists',
          label: 'Playlists in der Suche',
          help: 'In der Suche am Display zeigt eine Kachel „Playlists“ die Playlists, die du für die Suche freigegeben hast (Bibliothek › Spotify › Auf Spotify suchen › Meine Playlists › „Nur in der Suche“). Das Kind hört sie an und holt sie selbst auf die Startseite. Songs kommen nur in Playlists, die dem Konto der Box selbst gehören.',
          disabled: !on,
        },
        {
          type: 'toggle',
          key: 'dispPlCreate',
          label: 'Kind darf Playlists anlegen',
          help: 'Hinter der Kachel „Playlists“ legt das Kind mit „Neue Playlist“ eine eigene, private Playlist im Spotify-Konto der Box an und holt sie unter einen Reiter seiner Wahl. Löschen kannst du sie in der Spotify-App.',
          disabled: !on || !state.values.get('dispPlaylists'),
        },
        ...(state.values.get('dispPlaylists') && state.values.get('dispPlCreate')
          ? [
              {
                type: 'toggle',
                key: 'dispPlDelete',
                label: 'Kind darf eigene Playlists löschen',
                help: 'Nur Playlists, die das Kind am Display selbst angelegt hat: Unter „Einträge verwalten“ gibt es dann „Ganz löschen“ (einmal nachgefragt). Die Playlist verschwindet von der Startseite, aus der Suche und aus seiner Spotify-Bibliothek – Spotify selbst löscht Playlists nie, sie ist für das Kind nur nicht mehr zu finden. Braucht ein weiteres Recht bei Spotify. Aus: das Kind kann sie nur von der Startseite nehmen.',
                disabled: !on,
              },
            ]
          : []),
        ...(state.values.get('dispPlaylists') && state.values.get('dispPlCreate')
          ? [
              {
                type: 'stepper',
                key: 'plPerDay',
                label: 'Neue Playlists pro Tag',
                help: 'So viele Playlists darf das Kind am Tag anlegen.',
                min: 1,
                max: 20,
              },
            ]
          : []),
        // (making and changing playlists needs one more right from Spotify: asked when switched on, a button here until given)
        ...(writes && !right
          ? [
              {
                type: 'warn',
                text: 'Spotify einmal neu verbinden: Für neue Playlists und Songs braucht die Box das Recht, private Playlists zu ändern. Bis dahin bleiben „Neue Playlist“ und die Songs am Display aus.',
              },
              {
                type: 'html',
                html: `<div class="btns"><button class="btn primary" data-sp-connect>${icon('sync', 18)}${esc('Spotify neu verbinden')}</button></div>`,
              },
            ]
          : writes
            ? [
                {
                  type: 'html',
                  html: `<p class="help" style="margin:0">${icon('check', 16)} ${esc('Spotify-Recht für Playlists und Songs vorhanden')}</p>`,
                },
              ]
            : []),
      ],
    },
    {
      title: 'Podcasts und Radio',
      items: [
        {
          type: 'toggle',
          key: 'dispPodcasts',
          label: 'Podcasts für Kinder in der Suche',
          help: 'In der Suche am Display sucht eine Kachel „Podcasts“ in Apples Podcast-Verzeichnis (bei Deutsch auch in der ARD Audiothek) – nur Sendungen der Kinder-Kategorien. Das Kind kann sie ohne Freigabe auf die Startseite holen und selbst wieder entfernen. Gesucht wird erst beim Tippen auf die Kachel; der Suchbegriff geht dabei an Apple bzw. die ARD.',
          disabled: !on,
        },
        {
          type: 'toggle',
          key: 'dispRadio',
          label: 'Radio für Kinder in der Suche',
          help: 'In der Suche am Display sucht eine Kachel „Radio“ im Senderverzeichnis radio-browser.info – nur Sender, die dort als Kinderradio markiert sind. Das Kind kann sie ohne Freigabe auf die Startseite holen und selbst wieder entfernen. Gesucht wird erst, wenn das Kind es will; der Suchbegriff geht dabei an radio-browser.info.',
          disabled: !on,
        },
        {
          type: 'html',
          html: `<p class="help" style="margin:0">${esc('Was freigegeben ist und was das Kind geholt hat: Bibliothek › Für die Suche freigegeben.')}</p>`,
        },
      ],
    },
  ]
}

// the switches of the display's options (disp.opts, loaded by loadControls)
function setControlValues() {
  const o = disp.opts
  state.values.set('dispSearch', o.displaySearch === true)
  // ("Nur in der Suche" in this app: its buttons and the pool's list below - off: hidden, the pool is kept)
  state.values.set('appPool', o.appSearchPool === true)
  // (podcasts for children in the display's search, put on the start page by the child - search-podcasts.ts)
  state.values.set('dispPodcasts', o.displayPodcasts === true)
  // (radio stations for children in the display's search, put on the start page by the child - search-radio.ts)
  state.values.set('dispRadio', o.displayRadio === true)
  // (wishes from Spotify in the display's search, approved by the parents - wishes.ts)
  state.values.set('dispWishes', o.displayWishes === true)
  // (fork "wishes": playlists in the display's search, new ones by the child, single songs - search-playlists.ts)
  state.values.set('dispPlaylists', o.displayPlaylists === true)
  state.values.set('dispPlCreate', o.displayPlaylistCreate === true)
  state.values.set('plPerDay', o.playlistsPerDay ?? 5)
  state.values.set('dispTracks', o.displayTracks === true)
  state.values.set('dispPlDelete', o.displayPlaylistDelete === true)
  // (fork "wishes": the child sorts the start page itself - start-order.ts)
  state.values.set('startSort', o.displayStartSort === true)
  state.values.set('plScope', o.playlistScope === true)
}

// "Bedienung am Display": the sections "Startseite" and "Suche" before "Haltezeiten"
const bedienungSections = () => [
  {
    // ((fork "wishes") the child sorts the start page itself; off: A to Z as always)
    title: 'Startseite',
    items: [
      {
        type: 'toggle',
        key: 'startSort',
        label: 'Kind darf die Startseite sortieren',
        help: 'Lange auf ein Cover drücken, dann die Cover an ihren Platz ziehen – in der Bühnen-Ansicht mit Pfeilen. „A–Z“ sortiert wieder alphabetisch. Neues kommt nach vorne. Im Theme „Cover Flow“ nicht verfügbar.',
      },
    ],
  },
  {
    // ((fork "wishes") the search's switches: a page of their own, "Suche am Display")
    title: 'Suche',
    items: [
      {
        type: 'html',
        html: `<div class="navlist">${navRow('suchedisplay', 'Suche am Display', 'Lupe, Spotify-Wünsche, Songs, Playlists, Podcasts, Radio', 'search')}</div>`,
      },
    ],
  },
]

// the fork's switches of "Bedienung am Display" and "Suche am Display" (NOT_MINE: one of splitti's, his change saves it)
const NOT_MINE = Symbol('not mine')
async function changeControl(key, v, page) {
  if (key === 'startSort')
    return saveDisplayOptions(
      { displayStartSort: !!v },
      v ? 'Das Kind kann die Startseite sortieren' : 'Startseite wieder von A bis Z',
    )
  if (key === 'dispSearch') {
    const r = await saveDisplayOptions(
      { displaySearch: !!v },
      v ? 'Suche auf dem Display an' : 'Suche auf dem Display aus',
    )
    // ((fork "wishes") the search's other switches depend on it)
    renderPage(page, false)
    return r
  }
  if (key === 'dispWishes') {
    const r = await saveDisplayOptions({ displayWishes: !!v }, v ? 'Wünsche aus Spotify an' : 'Wünsche aus Spotify aus')
    // ((fork "wishes") "Einzelne Songs aus Spotify" depends on it)
    renderPage(page, false)
    return r
  }
  // ((fork "wishes") the playlists' switches: the page again - what depends on them shows or goes)
  const again = async (r) => {
    renderPage(page, false)
    return r
  }
  if (key === 'dispPlaylists')
    return again(
      await saveDisplayOptions(
        { displayPlaylists: !!v },
        v ? 'Playlists in der Suche an' : 'Playlists in der Suche aus',
      ),
    )
  // (switched on without the right to change the child's playlists: the sign-in at once, back to this page)
  const needRight = async (r) => {
    if (r && v && !state.values.get('plScope')) {
      renderPage(page, false)
      if (
        await ask(
          'Recht bei Spotify fehlt',
          'Für neue Playlists und einzelne Songs braucht die Box das Recht, private Playlists im Spotify-Konto zu ändern. Jetzt bei Spotify neu anmelden (mit dem Konto der Box)?',
          'Bei Spotify anmelden',
        )
      ) {
        connectSpotify()
        return r
      }
    }
    return again(r)
  }
  if (key === 'dispPlCreate')
    return needRight(
      await saveDisplayOptions(
        { displayPlaylistCreate: !!v },
        v ? 'Kind darf Playlists anlegen' : 'Keine neuen Playlists am Display',
      ),
    )
  if (key === 'plPerDay') return saveDisplayOptions({ playlistsPerDay: v }, `${v} neue Playlists pro Tag`)
  if (key === 'dispPlDelete')
    return needRight(
      await saveDisplayOptions(
        { displayPlaylistDelete: !!v },
        v ? 'Kind darf eigene Playlists löschen' : 'Kind kann eigene Playlists nur von der Startseite nehmen',
      ),
    )
  if (key === 'dispTracks')
    return needRight(
      await saveDisplayOptions(
        { displayTracks: !!v },
        v ? 'Einzelne Songs aus Spotify an' : 'Einzelne Songs aus Spotify aus',
      ),
    )
  if (key === 'dispRadio')
    return saveDisplayOptions(
      { displayRadio: !!v },
      v ? 'Radio für Kinder in der Suche an' : 'Radio für Kinder in der Suche aus',
    )
  if (key === 'dispPodcasts')
    return saveDisplayOptions(
      { displayPodcasts: !!v },
      v ? 'Podcasts für Kinder in der Suche an' : 'Podcasts für Kinder in der Suche aus',
    )
  if (key === 'appPool')
    return saveDisplayOptions(
      { appSearchPool: !!v },
      v ? '„Nur in der Suche“ in der App an' : '„Nur in der Suche“ in der App ausgeblendet',
    )
  return NOT_MINE
}

/* Bibliothek › Spotify › Sync-Einstellungen */

// the spacing of the background requests, and a quota block of the catalog only (off: every block stops all of it, as
// MuPiBox has it)
const syncSections = () => [
  {
    title: 'Hintergrund-Abfragen',
    help: 'Wie lange die Box zwischen zwei Anfragen an Spotify wartet, wenn sie im Hintergrund viele Seiten holt – z. B. alle Alben eines Künstlers, der „Nur in der Suche“ freigegeben ist (bei großen Künstlern über 10 Seiten). Zu viele Anfragen auf einmal: Spotify sperrt die Box für Stunden.',
    items: [
      {
        type: 'slider',
        label: 'Sekunden zwischen Spotify-Anfragen',
        key: 'bgSec',
        default: 15,
        min: 5,
        max: 120,
        step: 5,
        unit: ' s',
        help: 'Mehr Sekunden: Freigegebene Künstler sind später vollständig in der Suche, die Box ist aber vor Sperren sicherer.',
      },
    ],
  },
  {
    title: 'Spotify-Sperren',
    help: 'Spotify zählt die Anfragen der Box in getrennten Kontingenten. Ist das Kontingent für Kataloganfragen (Suche, Künstler, Alben, Playlists, Sync) aufgebraucht, sperrt Spotify die Box oft für viele Stunden – das Abspielen über den Player nimmt Spotify dabei aber weiter an.',
    items: [
      {
        type: 'toggle',
        label: 'Kontingente trennen',
        key: 'quotaSplit',
        help: 'An: Bei einer solchen Sperre spielt die Box weiter ab, was sie schon hat (Abspielen, Pause, Weiter); gesperrt sind nur Suche, Künstlerseiten und Sync. Jede andere Sperre hält wie bisher alles an. Aus: Jede Sperre hält alles an, wie in der MuPiBox vorgesehen. Gilt ab der nächsten Sperre; beim Ausschalten wartet auch das Abspielen sofort.',
      },
    ],
  },
]

async function changeSync(key, v) {
  const body = key === 'bgSec' ? { background_request_seconds: Number(v) || 15 } : { split_quota_block: !!v }
  const r = await api(`${SYNC_API}/config`, { method: 'POST', body })
  const saved =
    key === 'quotaSplit'
      ? v
        ? 'Kontingente getrennt – gilt ab der nächsten Sperre'
        : 'Kontingente nicht mehr getrennt'
      : 'Gespeichert'
  toast(r.ok ? saved : (r.body?.error ?? 'Nicht gespeichert'), r.ok ? 'ok' : 'info')
  return r.ok
}

/* Updates: the fork's branch and its last tag */

/** the rows of the fork (not from the official repository) on the update page, and its words in the text below */
export function forkUpdateRows(i, busy) {
  // the fork's branch (not from the official repository): its last commit, the official version it is based on
  const f = i?.fork
  const forkRow = f
    ? `<div class="row"><span class="lbl"><b>${esc(`Fork · Entwicklungsstand · ${f.branch} · Stand ${f.date}`)}</b><small>${esc(`${f.repo} · ${f.sha}${f.base ? ` · auf Basis von ${f.base}` : ''}${f.installed ? ' · installiert' : ''}`)}</small></span>
        <button class="btn danger" data-upd="fork" ${busy ? 'disabled' : ''}>${f.installed ? 'Neu installieren' : 'Installieren'}</button></div>`
    : ''
  // the fork's last tag: the named state to go back to, beside the branch that goes on
  const t = i?.forkTag
  const forkTagRow = t
    ? `<div class="row"><span class="lbl"><b>${esc(`Fork · Letzter Tag · ${t.tag}`)}</b><small>${esc(`${t.repo} · ${t.sha}${t.base ? ` · auf Basis von ${t.base}` : ''}${t.installed ? ' · installiert' : ''}`)}</small></span>
        <button class="btn" data-upd="fork-tag" ${busy ? 'disabled' : ''}>${t.installed ? 'Neu installieren' : 'Installieren'}</button></div>`
    : ''
  return {
    rows: `${forkTagRow}${forkRow}`,
    from: f ? `, der Fork aus ${esc(f.repo)} (nicht vom MuPiBox-Team; zurück mit „Stabil“)` : '',
  }
}

/** what is asked before the fork is installed (kind: "fork" - its branch, "fork-tag" - its last tag) */
export function forkUpdateAsk(kind, i) {
  let title
  let text
  if (kind === 'fork') {
    const f = i?.fork
    title = 'Fork installieren?'
    text = `Zweig „${f?.branch ?? ''}“ aus ${f?.repo ?? ''} (Stand ${f?.date ?? ''}) – nicht vom MuPiBox-Team. Die Box zeigt 10–30 Minuten eine Wartungsanzeige und startet danach von selbst neu. Am besten am Netzteil. Zurück zur offiziellen Version geht es mit „Stabil“.`
  } else if (kind === 'fork-tag') {
    const t = i?.forkTag
    title = 'Letzten Fork-Tag installieren?'
    text = `Tag „${t?.tag ?? ''}“ aus ${t?.repo ?? ''} (Stand ${t?.date ?? ''}) – der letzte benannte Stand des Forks, nicht vom MuPiBox-Team. Die Box zeigt 10–30 Minuten eine Wartungsanzeige und startet danach von selbst neu. Am besten am Netzteil. Zurück zur offiziellen Version geht es mit „Stabil“.`
  }
  return { title, text }
}

/* The fork's pages in the app's schema (schema.json is splitti's) */

// [the page they come before, the pages] - as in the lists of their area
const FORK_PAGES = [
  [
    'podsuche',
    {
      id: 'wuensche',
      slug: 'wuensche',
      area: 'bibliothek',
      parent: 'bibliothek',
      title: 'Wünsche',
      description: '',
      icon: 'bulb',
      sections: [],
    },
    {
      id: 'suchfreigaben',
      slug: 'suchfreigaben',
      area: 'bibliothek',
      parent: 'bibliothek',
      title: 'Für die Suche freigegeben',
      description: '',
      icon: 'search',
      sections: [],
    },
  ],
  [
    'displaylive',
    {
      id: 'suchedisplay',
      slug: 'search-display',
      area: 'einstellungen',
      parent: 'g-display',
      title: 'Suche am Display',
      description: 'Lupe, Spotify-Wünsche, Songs, Playlists, Podcasts, Radio',
      icon: 'search',
      sections: [],
    },
  ],
]
// the app's search: the fork's switches and pages - [the entry they come after (its label), the entries]; null: at the end
const FORK_SEARCH = [
  [
    'Hörstand auf dem Display zeigen',
    { l: 'Kind darf die Startseite sortieren', where: 'Display & Bedienung › Bedienung am Display', id: 'bedienung' },
  ],
  [null, { l: 'Suche am Display', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [null, { l: 'Suche auf dem Display', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [null, { l: 'Wünsche aus Spotify', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [null, { l: 'Einzelne Songs aus Spotify', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [null, { l: 'Playlists in der Suche', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [null, { l: 'Kind darf Playlists anlegen', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
  [
    null,
    { l: 'Podcasts für Kinder in der Suche', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' },
  ],
  [null, { l: 'Radio für Kinder in der Suche', where: 'Display & Bedienung › Suche am Display', id: 'suchedisplay' }],
]

/** once, with the schema loaded (before its pages are known to the app) */
export function forkSchema(schema) {
  for (const [before, ...pages] of FORK_PAGES) {
    const at = schema.pages.findIndex((p) => p.id === before)
    schema.pages.splice(at >= 0 ? at : schema.pages.length, 0, ...pages)
  }
  for (const [after, entry] of FORK_SEARCH) {
    const at = after === null ? -1 : schema.searchIndex.findIndex((e) => e.l === after)
    if (at >= 0) schema.searchIndex.splice(at + 1, 0, entry)
    else schema.searchIndex.push(entry)
  }
}
