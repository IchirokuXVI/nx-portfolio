import { type Routes } from '@angular/router';
import { WalkCapture } from './capture/walk-capture';
import { WalkLabState } from './walk-lab-state';
import { WalkFiles } from './storage/walk-files';
import { WalkDb } from './storage/walk-db';

/**
 * The walk lab's three screens (recorder plan 0002, section 7), mounted by
 * `feature-shell` at `lab/walk` below the locale.
 *
 * The services are provided here, on the lab's own route, so nothing is registered
 * app wide: the capture service, the storage and the imported tracks exist only once
 * somebody opens the lab. `record` and `imported` are declared before `:walkId` so
 * neither word is read as an id.
 */
export const walkLabRoutes: Routes = [
  {
    path: '',
    providers: [WalkDb, WalkCapture, WalkFiles, WalkLabState],
    children: [
      {
        path: '',
        loadComponent: () =>
          import('./pages/walk-list-page').then((m) => m.WalkListPage),
      },
      {
        path: 'record',
        loadComponent: () =>
          import('./pages/record-page').then((m) => m.RecordPage),
      },
      {
        path: 'imported',
        loadComponent: () =>
          import('./pages/viewer-page').then((m) => m.ViewerPage),
        data: { imported: true },
      },
      {
        path: ':walkId',
        loadComponent: () =>
          import('./pages/viewer-page').then((m) => m.ViewerPage),
      },
    ],
  },
];
