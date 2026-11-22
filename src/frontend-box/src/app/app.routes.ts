import { Routes } from '@angular/router'

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    // preview of the overlay texts for the admin interface (Display texts): /text-preview?screen=blocked|quiet|parents
    path: 'text-preview',
    loadComponent: () => import('./text-preview/text-preview.page').then((m) => m.TextPreviewPage),
  },
  {
    // the search in the box's library (the magnifier on the start page, app › Bedienung › Suche)
    path: 'search',
    loadComponent: () => import('./search/search.page').then((m) => m.SearchPage),
  },
  {
    // (fork "wishes") an artist of the search's pool: its albums, as the start page's album list
    path: 'search-artist',
    loadComponent: () => import('./search/search-artist.page').then((m) => m.SearchArtistPage),
  },
  {
    // (fork "wishes") one thing of the pool: play it or put it on the start page
    path: 'search-album',
    loadComponent: () => import('./search/search-album.page').then((m) => m.SearchAlbumPage),
  },
  {
    path: 'resume',
    loadComponent: () => import('./resume/resume.page').then((m) => m.ResumePage),
  },
  {
    path: 'medialist',
    loadComponent: () => import('./medialist/medialist.page').then((m) => m.MedialistPage),
  },
  {
    path: 'player',
    loadComponent: () => import('./player/player.page').then((m) => m.PlayerPage),
  },
  {
    path: 'edit',
    loadComponent: () => import('./edit/edit.page').then((m) => m.EditPage),
  },
  {
    path: 'settings',
    loadComponent: () => import('./settings/settings.page').then((m) => m.SettingsPage),
  },
  {
    path: 'wifi',
    loadComponent: () => import('./wifi/wifi.page').then((m) => m.WifiPage),
  },
  {
    path: 'wifi/add',
    loadComponent: () => import('./wifi/wifi-add.page').then((m) => m.WifiAddPage),
  },
  {
    path: 'bluetooth',
    loadComponent: () => import('./bluetooth/bluetooth.page').then((m) => m.BluetoothPage),
  },
  {
    path: 'add',
    loadComponent: () => import('./add/add.page').then((m) => m.AddPage),
  },
]
