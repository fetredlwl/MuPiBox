// (fork "wishes") Everything of the fork the server sets up - the display's search (pool, podcasts, radio,
// playlists), the wishes, the start page sorted by the child, Spotify's block - in one place, so that server.ts (splitti's)
// only calls registerForkRoutes once: an update of upstream meets one line there instead of these.
import fs from 'node:fs'
import path from 'node:path'
import type { Express, RequestHandler } from 'express'
import type { MupiboxConfig } from './models/mupibox-config.model'
import { type PlaylistSong, type PlaylistsApi, registerSearchPlaylistsRoutes, tracksOn } from './search-playlists'
import { registerSearchPodcastsRoutes } from './search-podcasts'
import { registerSearchPoolRoutes } from './search-pool'
import { registerSearchRadioRoutes } from './search-radio'
import type { SpotifyApiService } from './services/spotify-api.service'
import type { SpotifyMediaInfo } from './services/spotify-media-info.service'
import { fetchFullPlaylistTracks } from './services/spotify-playlist-full'
import { playerUntilOf, spotifyBlock, useQuotaSplit } from './spotify-block'
import { getValidAccessToken } from './spotify-sync/auth'
import { loadSpotifySyncConfig, loadSpotifyTokenStore } from './spotify-sync/config-loader'
import { spotifyGet, spotifySend } from './spotify-sync/playlists'
import { registerStartOrderRoutes } from './start-order'
import { keptWishAlbums, registerWishesRoutes } from './wishes'

/** what the fork needs of the server (server.ts hands it over) */
export interface ForkDeps {
  configDir: string
  dataFile: string
  dataLock: string
  /** data.json written as the server writes it (atomic) */
  writeLibrary: (data: unknown) => Promise<void>
  /** the box runs for real (not the test or development server: no fixtures) */
  productionServe: boolean
  getMupiboxConfig: () => Promise<MupiboxConfig | undefined>
  getMupiboxConfigSync: () => MupiboxConfig | undefined
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => void | false) => Promise<void>
  /** the Spotify service (set up when the server has its login - undefined before) */
  spotify: () => SpotifyApiService | undefined
  spotifyMediaInfo: SpotifyMediaInfo
  session: RequestHandler
  csrf: RequestHandler
  localOrElternSession: RequestHandler
}

export function registerForkRoutes(app: Express, d: ForkDeps) {
  const configBasePath = d.configDir
  const { dataFile, dataLock, productionServe, updateMupiboxConfig, spotifyMediaInfo } = d
  const getMupiboxConfig = d.getMupiboxConfig
  const getMupiboxConfigSync = d.getMupiboxConfigSync
  const requireSession = d.session
  const requireCsrf = d.csrf
  const localOrElternSession = d.localOrElternSession

  // (fork "wishes") a private playlist (the child's own - no embed page): name, pictures and tracks with the Spotify login
  spotifyMediaInfo.privatePlaylist = async (playlistId) => {
    const store = loadSpotifyTokenStore(await getMupiboxConfig())
    if (!store) return undefined
    const token = await getValidAccessToken(store, updateMupiboxConfig)
    if (!token.ok) return undefined
    const head = await spotifyGet<{
      name?: string
      images?: { url?: string; width?: number | null; height?: number | null }[] | null
    }>(`/playlists/${encodeURIComponent(playlistId)}?fields=name,images`, token.token, 'display')
    const full = await fetchFullPlaylistTracks(playlistId, token.token)
    return {
      playlist: {
        name: head.name ?? '',
        images: (head.images ?? []).map((i) => ({ url: i.url ?? '', width: i.width ?? 0, height: i.height ?? 0 })),
        tracks: { total: full.tracks.length },
      },
      tracks: full.tracks,
      fullList: true,
      fullListSnapshot: full.snapshot,
    }
  }

  // The search pool ("Nur in der Suche", search-pool.ts): allowed for the display's search, not on its start page
  const searchPool = registerSearchPoolRoutes(app, {
    configDir: configBasePath,
    dataFile,
    dataLock,
    writeLibrary: d.writeLibrary,
    spotify: d.spotify,
    // (the spacing of the background requests: Sync-Einstellungen, spotify_sync.background_request_seconds)
    backgroundSeconds: () =>
      loadSpotifySyncConfig(getMupiboxConfigSync() as unknown as Parameters<typeof loadSpotifySyncConfig>[0])
        .background_request_seconds,
    // ("Nur in der Suche" in the parents' app: Bedienung › Suche)
    appEnabled: () => (getMupiboxConfigSync()?.mupibox as Record<string, unknown> | undefined)?.appSearchPool === true,
    session: requireSession,
    csrf: requireCsrf,
  })

  // (fork "wishes") podcasts for children in the display's search (Apple's directory / the ARD Audiothek, children's
  // categories only); MUPIBOX_PODCAST_FIXTURE: invented hits for the development server and tools/display-check
  registerSearchPodcastsRoutes(app, {
    getMupiboxConfig: () => getMupiboxConfigSync() as unknown as MupiboxConfig | undefined,
    pool: searchPool,
    ...(!productionServe && process.env.MUPIBOX_PODCAST_FIXTURE
      ? {
          search: async () => JSON.parse(fs.readFileSync(String(process.env.MUPIBOX_PODCAST_FIXTURE), 'utf8')),
          tips: async () => JSON.parse(fs.readFileSync(String(process.env.MUPIBOX_PODCAST_FIXTURE), 'utf8')),
        }
      : {}),
  })

  // (fork "wishes") radio for children in the display's search (radio-browser.info, children's stations only);
  // MUPIBOX_RADIO_FIXTURE: invented stations for the development server and tools/display-check
  registerSearchRadioRoutes(app, {
    getMupiboxConfig: () => getMupiboxConfigSync() as unknown as MupiboxConfig | undefined,
    pool: searchPool,
    ...(!productionServe && process.env.MUPIBOX_RADIO_FIXTURE
      ? {
          search: async () => JSON.parse(fs.readFileSync(String(process.env.MUPIBOX_RADIO_FIXTURE), 'utf8')),
          tips: async () => JSON.parse(fs.readFileSync(String(process.env.MUPIBOX_RADIO_FIXTURE), 'utf8')),
        }
      : {}),
  })

  // (fork "wishes") wishes from Spotify (Bedienung › Suche › "Wünsche aus Spotify", the app's page "Wünsche");
  // MUPIBOX_SPOTIFY_FIXTURE: invented pages for the development server and tools/display-check, each call written to
  // MUPIBOX_SPOTIFY_FIXTURE_LOG (the check counts them)
  const spotifyFixture =
    !productionServe && process.env.MUPIBOX_SPOTIFY_FIXTURE ? String(process.env.MUPIBOX_SPOTIFY_FIXTURE) : ''
  // (answered as late as Spotify does - MUPIBOX_SPOTIFY_FIXTURE_DELAY_MS: covers that come after the page change)
  const fixtureCall = async (what: string) => {
    if (process.env.MUPIBOX_SPOTIFY_FIXTURE_LOG)
      fs.appendFileSync(String(process.env.MUPIBOX_SPOTIFY_FIXTURE_LOG), `${what}\n`)
    const delay = Number(process.env.MUPIBOX_SPOTIFY_FIXTURE_DELAY_MS) || 0
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    return JSON.parse(fs.readFileSync(spotifyFixture, 'utf8'))
  }
  // (fork "wishes") playlists in the display's search: the child's own, new ones, single songs into them
  // (search-playlists.ts) - with the child's Spotify login; MUPIBOX_SPOTIFY_FIXTURE: kept in memory, each call logged
  const playlistsToken = async (): Promise<string> => {
    const store = loadSpotifyTokenStore(await getMupiboxConfig())
    if (!store) throw Object.assign(new Error('no Spotify login'), { status: 503 })
    const t = await getValidAccessToken(store, updateMupiboxConfig)
    if (!t.ok) throw Object.assign(new Error(`token: ${t.failure.reason}`), { status: 503 })
    return t.token
  }
  const playlistsApi: PlaylistsApi = {
    create: async (name) =>
      spotifySend<{ id: string }>('POST', '/me/playlists', await playlistsToken(), {
        name,
        // (Spotify makes a playlist public unless told: the child's are private)
        public: false,
        description: 'MuPiBox',
      }),
    add: async (id, uris) => {
      const r = await spotifySend<{ snapshot_id?: string }>(
        'POST',
        `/playlists/${encodeURIComponent(id)}/items`,
        await playlistsToken(),
        { uris },
      )
      // (the player's list of it: read anew - the song shows at once)
      spotifyMediaInfo.forget(id)
      return typeof r?.snapshot_id === 'string' ? r.snapshot_id : undefined
    },
    remove: async (id, uris) => {
      const r = await spotifySend<{ snapshot_id?: string }>(
        'DELETE',
        `/playlists/${encodeURIComponent(id)}/items`,
        await playlistsToken(),
        {
          items: uris.map((uri) => ({ uri })),
        },
      )
      spotifyMediaInfo.forget(id)
      return typeof r?.snapshot_id === 'string' ? r.snapshot_id : undefined
    },
    unlist: async (id) => {
      // (Spotify has no deleting since 2026: out of the library - the URI in the query, as its reference shows it)
      await spotifySend(
        'DELETE',
        `/me/library?uris=${encodeURIComponent(`spotify:playlist:${id}`)}`,
        await playlistsToken(),
        undefined,
      )
      spotifyMediaInfo.forget(id)
    },
    cover: async (id) => {
      const p = await spotifyGet<{ images?: { url?: string; width?: number | null }[] | null }>(
        `/playlists/${encodeURIComponent(id)}?fields=images`,
        await playlistsToken(),
        'display',
      )
      // (the middle size when Spotify gives several - 300 px; a mosaic comes as one picture)
      const images = (p.images ?? []).filter((i) => i.url)
      return images.find((i) => (i.width ?? 0) >= 250 && (i.width ?? 0) <= 400)?.url ?? images[0]?.url ?? ''
    },
    items: async (id) => {
      const token = await playlistsToken()
      const fields = encodeURIComponent('items(item(id,name,artists(name),album(images))),next')
      const songs: PlaylistSong[] = []
      for (let offset = 0; offset < 200; offset += 50) {
        const page = await spotifyGet<{
          items?: {
            item?: {
              id?: string
              name?: string
              artists?: { name?: string }[]
              album?: { images?: { url?: string }[] }
            } | null
          }[]
          next?: string | null
        }>(`/playlists/${encodeURIComponent(id)}/items?fields=${fields}&limit=50&offset=${offset}`, token, 'display')
        for (const e of page.items ?? []) {
          const t = e?.item
          if (t?.id && t.name)
            songs.push({
              id: t.id,
              name: t.name,
              artist: t.artists?.[0]?.name ?? '',
              cover: t.album?.images?.[1]?.url ?? t.album?.images?.[0]?.url ?? '',
            })
        }
        if (!page.next) break
      }
      return songs
    },
  }
  const fixtureSongs = new Map<string, PlaylistSong[]>()
  const fixtureLog = (what: string) => {
    if (process.env.MUPIBOX_SPOTIFY_FIXTURE_LOG)
      fs.appendFileSync(String(process.env.MUPIBOX_SPOTIFY_FIXTURE_LOG), `${what}\n`)
  }
  const playlistsFixture: PlaylistsApi = {
    create: async (name) => {
      fixtureLog(`playlist create ${name}`)
      const id = `pl${Date.now().toString(36)}`.padEnd(22, '0').slice(0, 22)
      fixtureSongs.set(id, [])
      return { id }
    },
    add: async (id, uris) => {
      fixtureLog(`playlist add ${id} ${uris.join(',')}`)
      const list = fixtureSongs.get(id) ?? []
      for (const uri of uris) list.push({ id: uri.split(':').pop() ?? '', name: uri, artist: '', cover: '' })
      fixtureSongs.set(id, list)
      return undefined
    },
    remove: async (id, uris) => {
      fixtureLog(`playlist remove ${id} ${uris.join(',')}`)
      fixtureSongs.set(
        id,
        (fixtureSongs.get(id) ?? []).filter((s) => !uris.includes(`spotify:track:${s.id}`)),
      )
      return undefined
    },
    cover: async () => '',
    unlist: async (id) => {
      fixtureLog(`playlist unlist ${id}`)
      fixtureSongs.delete(id)
    },
    items: async (id) => {
      fixtureLog(`playlist items ${id}`)
      return fixtureSongs.get(id) ?? []
    },
  }
  // (the account's own playlists - and those it collaborates on: songs may go into them; kept 10 minutes)
  // (and their pictures - the routine of search-playlists.ts takes them from the same answer; and their versions - a song
  // list kept with the same one is still right)
  type AccountInfo = {
    at: number
    ids: Set<string>
    covers: Map<string, string>
    snapshots: Map<string, string>
    // all of the account's playlists in it (not cut off after 500): one missing is gone
    complete: boolean
  }
  let accountPlaylistsKept: AccountInfo | null = null
  const accountInfo = async (fresh = false): Promise<AccountInfo> => {
    if (spotifyFixture)
      return { at: Date.now(), ids: new Set(), covers: new Map(), snapshots: new Map(), complete: false }
    if (!fresh && accountPlaylistsKept && Date.now() - accountPlaylistsKept.at < 600_000) return accountPlaylistsKept
    const token = await playlistsToken()
    const me = await spotifyGet<{ id?: string }>('/me', token, 'display')
    const ids = new Set<string>()
    const covers = new Map<string, string>()
    const snapshots = new Map<string, string>()
    let complete = false
    let offset = 0
    for (let page = 0; page < 10; page++) {
      const d = await spotifyGet<{
        items?: ({
          id?: string
          owner?: { id?: string }
          collaborative?: boolean
          snapshot_id?: string
          images?: { url?: string; width?: number | null }[] | null
        } | null)[]
        next?: string | null
      }>(`/me/playlists?limit=50&offset=${offset}`, token, 'display')
      const items = d.items ?? []
      for (const p of items) {
        if (!p?.id || !((!!me.id && p.owner?.id === me.id) || p.collaborative === true)) continue
        ids.add(p.id)
        if (typeof p.snapshot_id === 'string') snapshots.set(p.id, p.snapshot_id)
        const images = (p.images ?? []).filter((i) => i.url)
        const url = images.find((i) => (i.width ?? 0) >= 250 && (i.width ?? 0) <= 400)?.url ?? images[0]?.url
        if (url) covers.set(p.id, url)
      }
      offset += items.length
      if (!d.next || !items.length) {
        complete = true
        break
      }
    }
    accountPlaylistsKept = { at: Date.now(), ids, covers, snapshots, complete }
    return accountPlaylistsKept
  }
  const accountPlaylists = async (): Promise<Set<string>> => (await accountInfo()).ids
  // ((fork "wishes") the start page sorted by the child - start-order.ts)
  registerStartOrderRoutes(app, {
    configDir: configBasePath,
    getMupiboxConfig: () => getMupiboxConfigSync() as unknown as Record<string, unknown> | undefined,
  })
  const searchPlaylists = registerSearchPlaylistsRoutes(app, {
    configDir: configBasePath,
    pool: searchPool,
    getMupiboxConfig: () => getMupiboxConfigSync() as unknown as Record<string, unknown> | undefined,
    api: () => (spotifyFixture ? playlistsFixture : playlistsApi),
    accountPlaylists,
    accountCovers: async () => (await accountInfo(true)).covers,
    accountSnapshots: () => accountInfo(),
  })

  registerWishesRoutes(app, {
    configDir: configBasePath,
    cacheDir: path.join(process.cwd(), 'cache'),
    pool: searchPool,
    getMupiboxConfig: () => getMupiboxConfigSync() as unknown as Record<string, unknown> | undefined,
    searchPage: async (q, offset, tracks) => {
      if (spotifyFixture) return (await fixtureCall(`search ${q} ${offset}`)).search[String(offset)]
      const spotifyApiService = d.spotify()
      if (!spotifyApiService) throw Object.assign(new Error('no Spotify'), { status: 503 })
      return spotifyApiService.searchWishPage(q, offset, tracks)
    },
    albumTracks: async (albumId) => {
      if (spotifyFixture)
        return (await fixtureCall(`album ${albumId}`)).albums?.[albumId] ?? { artistId: '', cover: '', tracks: [] }
      const spotifyApiService = d.spotify()
      if (!spotifyApiService) throw Object.assign(new Error('no Spotify'), { status: 503 })
      return spotifyApiService.albumWishTracks(albumId)
    },
    playlists: searchPlaylists,
    tracksOn: () => tracksOn(getMupiboxConfigSync() as unknown as Record<string, unknown> | undefined),
    artistPage: async (artistId, offset) => {
      const pick = (images?: { url?: string }[]) => images?.[1]?.url ?? images?.[0]?.url ?? ''
      if (spotifyFixture) {
        const all = ((await fixtureCall(`artist ${artistId} ${offset}`)).artists[artistId] ?? []) as {
          id: string
          name: string
          cover: string
        }[]
        return { items: all.slice(offset, offset + 10), total: all.length }
      }
      const spotifyApiService = d.spotify()
      if (!spotifyApiService) throw Object.assign(new Error('no Spotify'), { status: 503 })
      const r = await spotifyApiService.getArtistAlbums(artistId, 'album,single,compilation', 10, offset)
      return {
        items: r.items.map((a) => ({ id: a.id, name: a.name, cover: pick(a.images as { url?: string }[]) })),
        total: r.total,
      }
    },
    keptAlbums: spotifyFixture ? () => undefined : keptWishAlbums,
    session: requireSession,
    csrf: requireCsrf,
  })

  // (fork "wishes") whether a quota block of the catalog leaves the box playing: Sync-Einstellungen › Spotify-Sperren
  useQuotaSplit(
    () =>
      loadSpotifySyncConfig(getMupiboxConfigSync() as unknown as Parameters<typeof loadSpotifySyncConfig>[0])
        .split_quota_block,
  )
  // (fork "wishes") Spotify's block for the display's note: catalog - nothing new from Spotify (searches, lists); player -
  // Spotify does not play either (the display greys its Spotify tiles)
  app.get('/api/spotify-block', localOrElternSession, (_req, res) => {
    const block = spotifyBlock()
    res.json({ catalog: !!block, player: playerUntilOf(block) > Date.now(), until: block?.until ?? null })
  })

  return { searchPool }
}
