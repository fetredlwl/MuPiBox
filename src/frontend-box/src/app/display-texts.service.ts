import { HttpClient } from '@angular/common/http'
import { Injectable, inject, signal } from '@angular/core'
import { environment } from '../environments/environment'

// Texts of the overlays on the box display. Per text the box shows, in this order:
//   1. the parents' own text (config displayTexts, set in the parents' web app or the admin interface)
//   2. the chosen language (config displayLanguage) from assets/i18n/display-texts.json
//   3. English
// These English defaults are only used if the language file can't be read.
export const DEFAULT_DISPLAY_TEXTS = {
  blockedHeading: "That's enough music for today",
  blockedSubheading: 'More music tomorrow',
  quietHeading: 'Quiet time',
  quietSubheading: 'Music will be back soon',
  parentsTitle: 'Parent setup',
  parentsHint: 'Scan with your phone or open in a browser:',
  parentsCountdown: 'Disappears in {s} s',
  parentsClose: 'Close',
  // km themes (not editable by the parents, only translated): folder entry with titles of its own, radio live pill,
  // short close button of the track list
  ownFilesLabel: 'All tracks here',
  liveLabel: 'Live',
  connectingLabel: 'Connecting …',
  closeShort: 'Close',
  // list that could not be loaded: NAS folder / radio and podcasts without a connection
  nasUnavailable: 'NAS not reachable',
  offlineLabel: 'No connection',
  // Spotify albums Spotify could not be asked for (it blocks the box's requests for a while)
  spotifyUnavailable: 'Spotify is not answering right now',
  // the track list of an album, a playlist or a show that has none
  noTracks: 'No tracks available',
  // title of the resume page (km themes; the other themes keep "Resume")
  resumeTitle: 'Continue listening',
  outputTitle: 'Listen with',
  outputBox: 'Box',
  outputBoxSub: 'Speaker',
  outputConnected: 'connected',
  outputOff: 'off',
  outputConnecting: 'switching on …',
  outputNotFound: 'Not found – is it switched on?',
  // "Läuft gerade" pill in the header (km themes, design round 2)
  pausedLabel: 'Paused',
  stopLabel: 'Stop',
  // above the track list (km themes, design round 2): {n} = the current title, {t} = how many
  trackOf: 'Track {n} of {t}',
  // the headset switch in the player's header: the device did not answer
  outputHeadsetNotFound: 'Headphones not found. Are they on and close by?',
  // the tile of the device that plays now ("Hören mit" window)
  outputPlaying: 'playing',
  // pairing with Home Assistant (opened in the app; ha-pairing overlay): {c} = the Home Assistant's name
  haTitle: 'Pair Home Assistant',
  haWaiting: 'Now start the pairing in Home Assistant.',
  haKey: 'Key of the box – it must match the one Home Assistant shows:',
  haWants: '{c} would like to pair',
  haCode: 'Enter this code in Home Assistant:',
  haScopeRead: 'see what is playing',
  haScopeControl: 'control playback',
  haCancel: 'Cancel',
  haAlso: 'It also asks for:',
  haScopeNotify: 'messages and announcements',
  haScopePower: 'restart and switch off',
  haAllowAll: 'Allow all',
  haOnlyBasic: 'Only show and control',
  // the parents' menu on the box (settings page, held on WiFi/battery) and its restart / shut down question
  settingsTitle: 'Settings',
  settingsNetwork: 'Network',
  settingsBluetooth: 'Bluetooth',
  settingsPower: 'Restart / Shut down',
  settingsParentApp: 'Parent web app',
  powerQuestion: 'Restart or shut down the MuPiBox?',
  powerShutdown: 'Shut down',
  powerReboot: 'Restart',
  powerCancel: 'Cancel',
  // lock screen: the box has not had the time from the network since it was switched on
  clockNotSynced: 'Time not synchronised',
  // the bar while the lock screen stands back for the parents' menu (see parent-access.service.ts)
  parentAccessHint: 'Parent access – the lock still applies. Back to the start page, or 2 minutes without a touch: the lock screen comes back.',
  // a new display model waiting for its answer (app: Display-Modell; display-test overlay): {s} = the time left (m:ss)
  displayTestTitle: 'New display',
  displayTestText: 'Do you see this picture? Then tap “Keep”. Otherwise the box goes back to the display before in {s}.',
  displayTestKeep: 'Keep',
  // (fork "wishes") Spotify blocks the box and does not play (SpotifyPauseComponent)
  spotifyPausePlayer: 'Spotify is not working right now. You can listen to radio and podcasts.',
  // (fork "wishes") the search on the display (search page): {n} = a name, {c} = a tab
  searchPlaceholder: 'Type a name',
  searchStart: 'Type the first letters.',
  searchLoading: 'Loading the library …',
  searchNothing: 'Nothing found.',
  searchRemoveQ: 'Remove?',
  searchArtist: 'Artist',
  searchPodcast: 'Podcast',
  searchWhere: 'Where on the start page?',
  searchGetAll: 'Get everything by {n}',
  searchAllThere: 'All albums are on the start page already.',
  searchAlbumsLoading: 'The albums are still loading.',
  searchPlay: 'Play',
  searchToStart: 'To the start page',
  searchAlready: '{n} is here already.',
  searchAdded: '{n} is now in {c}.',
  searchGone: '{n} is gone.',
  searchFailed: 'That did not work.',
  searchCatAudiobook: 'Audio books',
  searchCatMusic: 'Music',
  searchCatRadio: 'Radio',
  // (fork "wishes") podcasts for children in the search (search-podcasts.ts)
  searchPodcastsButton: 'Podcasts',
  searchPodcastsLoading: 'Searching …',
  searchPodcastsNone: 'No podcasts for children found.',
  searchTipsLabel: 'Tips for children',
  // (fork "wishes") wishes from Spotify (search, its artist and album page): {n} = a name
  wishSearchTile: 'Search Spotify',
  wishLoading: 'Searching Spotify …',
  wishNone: 'Nothing found on Spotify.',
  wishButton: 'Wish for it',
  wishWhole: 'Wish for everything by {n}',
  wishWished: 'Wished',
  wishSent: 'Wish sent: {n}',
  wishAlready: 'You have wished for {n} already.',
  wishThere: '{n} is on the box already.',
  wishPaused: 'Spotify is taking a break – try again later.',
  wishAllowed: 'You may fetch {n} yourself.',
  // (fork "wishes") the tiles of the search's start, radio for children, the child's own entries
  searchManageTile: 'Manage entries',
  searchMine: 'Mine',
  searchSpotify: 'Spotify',
  searchRadioButton: 'Radio',
  searchRadioNone: 'No radio stations for children found.',
  searchRadioStation: 'Radio station',
  searchKey: 'Search',
  searchMove: 'Somewhere else',
  searchRemove: 'Remove',
  searchRemoveYes: 'Yes, remove',
}
export type DisplayTextKey = keyof typeof DEFAULT_DISPLAY_TEXTS
type TextSet = Partial<Record<DisplayTextKey, string>>

interface LanguageFile {
  languages?: Record<string, { name?: string; texts?: Record<string, unknown> }>
}

function pickTexts(raw: Record<string, unknown> | undefined): TextSet {
  const texts: TextSet = {}
  for (const key of Object.keys(DEFAULT_DISPLAY_TEXTS) as DisplayTextKey[]) {
    const value = raw?.[key]
    if (typeof value === 'string' && value.trim()) texts[key] = value.trim()
  }
  return texts
}

@Injectable({ providedIn: 'root' })
export class DisplayTextsService {
  private http = inject(HttpClient)
  private readonly custom = signal<TextSet>({})
  private readonly language = signal('en')
  private readonly languages = signal<Record<string, TextSet>>({})

  constructor() {
    this.http.get<LanguageFile>('assets/i18n/display-texts.json').subscribe({
      next: (file) => {
        const sets: Record<string, TextSet> = {}
        for (const [code, lang] of Object.entries(file?.languages ?? {})) {
          sets[code] = pickTexts(lang?.texts)
        }
        this.languages.set(sets)
      },
      error: () => {},
    })
    this.refresh()
  }

  // The preview page of the admin interface shows texts that are typed but not saved yet: from then on the
  // saved settings are no longer read (they would replace the preview).
  private previewActive = false

  /** Preview of the admin interface: shows the given language and own texts instead of the saved ones. */
  public applyPreview(language: unknown, texts: Record<string, unknown> | undefined): void {
    this.previewActive = true
    this.custom.set(pickTexts(texts))
    if (typeof language === 'string' && language) this.language.set(language)
  }

  /** Reads the settings again (called when an overlay appears, so a change shows up without a reload). */
  public refresh(): void {
    if (this.previewActive) return
    this.http
      .get<{ displayTexts?: Record<string, unknown>; displayLanguage?: unknown }>(`${environment.backend.apiUrl}/config`)
      .subscribe({
        next: (config) => {
          this.custom.set(pickTexts(config?.displayTexts))
          this.language.set(typeof config?.displayLanguage === 'string' ? config.displayLanguage : 'en')
        },
        // keep what we have (or the defaults) when the backend is not reachable
        error: () => {},
      })
  }

  /** The text for `key`; {name} placeholders are filled from `values`. Reading it inside a computed/template tracks changes. */
  public text(key: DisplayTextKey, values: Record<string, string | number> = {}): string {
    const sets = this.languages()
    // (a quiet time's heading is the name of its window, see PlaytimeBlockedOverlayComponent - without one the
    // language's text; an own heading saved before, when the parents' app had a field for it, is left out: one heading
    // for every window did not fit them all - "Gute Nacht" for the homework)
    const own = key === 'quietHeading' ? undefined : this.custom()[key]
    const template = own ?? sets[this.language()]?.[key] ?? sets.en?.[key] ?? DEFAULT_DISPLAY_TEXTS[key]
    return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole))
  }
}
