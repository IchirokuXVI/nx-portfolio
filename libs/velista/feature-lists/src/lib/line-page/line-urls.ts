import { computed, inject, type Signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import {
  appPath,
  lineIdOf,
  listIdOf,
  zoneIdOf,
} from '@portfolio/velista/platform';

/**
 * The URLs around one line, for a screen whose route carries the three ids
 * (velista `0135`, section 11).
 *
 * The line page has three pages and five sheets around it, and each one names a
 * fallback for its back control. Written once, so a screen cannot spell the path
 * of its neighbour differently.
 */
export interface LineUrls {
  readonly zoneId: Signal<string>;
  readonly listId: Signal<string>;
  readonly lineId: Signal<string>;
  /** The list the line is on. */
  readonly list: Signal<string>;
  /** The line page, and whatever is under it: `line('history')`. */
  line(...segments: readonly string[]): string;
  /** The same, for another line of the same list: the survivor of a merge. */
  lineOf(lineId: string, ...segments: readonly string[]): string;
}

/** Call from a constructor or a field initializer. */
export function lineUrls(): LineUrls {
  const route = inject(ActivatedRoute);
  const locale = inject(RokuLocaleStore).locale;
  const basePath = inject(APP_BASE_PATH);

  const zoneId = zoneIdOf(route);
  const listId = listIdOf(route);
  const lineId = lineIdOf(route);

  const listSegments = (): string[] => ['zones', zoneId(), 'lists', listId()];
  const lineOf = (id: string, ...segments: readonly string[]): string =>
    appPath(locale(), basePath, ...listSegments(), 'lines', id, ...segments);

  return {
    zoneId,
    listId,
    lineId,
    list: computed(() => appPath(locale(), basePath, ...listSegments())),
    line: (...segments) => lineOf(lineId(), ...segments),
    lineOf,
  };
}
