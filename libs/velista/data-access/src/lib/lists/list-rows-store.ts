import { inject, Injectable, signal, type Signal } from '@angular/core';
import {
  DEFAULT_LIST_ROW_LAYOUT,
  type ListRowLayout,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { isRecord } from '../mapping/primitives';

/** The layouts this build knows, for reading a record another build wrote. */
const LAYOUTS: readonly ListRowLayout[] = ['default', 'compact'];

/**
 * The version of the record this build writes and reads (velista `0202`). Version 1
 * meant the opposite rows: its `compact` was the row that is now the default. No
 * build with it reached production, so a record of version 1 is read as the default
 * view and is never translated.
 */
const VERSION = 2;

/**
 * How this device draws the rows of a zone list (velista `0202`): the default view,
 * which is the row of velista `0191` with its three lines of facts, or the compact
 * view, the two line row that fits more rows on a screen.
 *
 * On the device and not on the server, under one key (`StorageKeys.listRows`), in
 * the shape of `MappingSettingsStore`: the choice is about this screen size and this
 * person's eyes. The view picker of the zone list page and of the basket page both
 * write it, so one choice sets the view everywhere. A record that is missing, not
 * JSON, not a record, of another version, or names a layout this build does not
 * know reads as the default.
 */
// Provided by the app layer, never root: rule D5, beside the other stores.
@Injectable()
export class ListRowsStore {
  private readonly _browser = inject(BrowserFacade);

  private readonly _layout = signal<ListRowLayout>(this._read());

  readonly layout: Signal<ListRowLayout> = this._layout.asReadonly();

  setLayout(layout: ListRowLayout): void {
    this._layout.set(layout);
    try {
      this._browser.writeStorage(
        StorageKeys.listRows,
        JSON.stringify({ version: VERSION, layout })
      );
    } catch {
      // A full or blocked storage keeps the choice for this document only.
    }
  }

  private _read(): ListRowLayout {
    let raw: unknown = null;
    try {
      raw = JSON.parse(
        this._browser.readStorage(StorageKeys.listRows) ?? 'null'
      );
    } catch {
      raw = null;
    }
    if (!isRecord(raw) || raw['version'] !== VERSION) {
      return DEFAULT_LIST_ROW_LAYOUT;
    }
    const layout = raw['layout'];
    return LAYOUTS.find((known) => known === layout) ?? DEFAULT_LIST_ROW_LAYOUT;
  }
}
