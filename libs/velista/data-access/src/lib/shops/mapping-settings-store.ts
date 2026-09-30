import { inject, Injectable, signal } from '@angular/core';
import {
  DEFAULT_MAPPING_SETTINGS,
  type MappingSettings,
} from '@portfolio/velista/models';
import { BrowserFacade, StorageKeys } from '@portfolio/velista/platform';
import { isRecord } from '../mapping/primitives';

/**
 * The settings for every walk this device records (velista `0122`, target 6):
 * "Walking across a shelf makes it a path", on by default.
 *
 * On the device and not on the server, under one key (`StorageKeys.mappingSettings`),
 * because the plan keeps them there: storing them on the account is a decision
 * for later. A record that cannot be read is the defaults, and a setting the
 * record does not name keeps its default.
 *
 * Recording (velista `0126`) reads {@link settings} when a walk starts or resumes
 * and hands `walkingAcrossMakesPath` to the live map.
 */
// Provided by the app layer, never root: rule D5, beside the other stores.
@Injectable()
export class MappingSettingsStore {
  private readonly _browser = inject(BrowserFacade);

  private readonly _settings = signal<MappingSettings>(this._read());

  readonly settings = this._settings.asReadonly();

  setWalkingAcrossMakesPath(on: boolean): void {
    this._write({ ...this._settings(), walkingAcrossMakesPath: on });
  }

  private _write(settings: MappingSettings): void {
    this._settings.set(settings);
    try {
      this._browser.writeStorage(
        StorageKeys.mappingSettings,
        JSON.stringify({ version: 1, ...settings })
      );
    } catch {
      // A full or blocked storage keeps the choice for this document only.
    }
  }

  private _read(): MappingSettings {
    let raw: unknown = null;
    try {
      raw = JSON.parse(
        this._browser.readStorage(StorageKeys.mappingSettings) ?? 'null'
      );
    } catch {
      raw = null;
    }
    if (!isRecord(raw)) {
      return DEFAULT_MAPPING_SETTINGS;
    }
    return {
      walkingAcrossMakesPath:
        typeof raw['walkingAcrossMakesPath'] === 'boolean'
          ? raw['walkingAcrossMakesPath']
          : DEFAULT_MAPPING_SETTINGS.walkingAcrossMakesPath,
    };
  }
}
