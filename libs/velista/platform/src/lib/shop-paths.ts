import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { APP_BASE_PATH } from '@portfolio/velista/models';
import { appPath } from './app-path';

/**
 * Where a shop's pages live in the route table (velista `0121`), in one place.
 *
 * Here and not in the feature library that draws them, because five libraries
 * open them (the four hosts of the shop picker and the basket), and none of them
 * may import a lazily loaded feature library. `routes.spec.ts` asserts the table
 * agrees.
 */
export const SHOP_PATHS = {
  /** `shops/:locationId`: a shop's own page. */
  shop: 'shops',
  /** `shops/:locationId/map`: the map every shopper sees. */
  map: 'map',
  /** The query parameter that names the basket the map counts from. */
  basketParam: 'basket',
  /** `shops/:locationId/walks`: a shop's walks (velista `0122`). */
  walks: 'walks',
  /** `.../walks/settings` and `.../walks/:walkId/settings`. */
  settings: 'settings',
  /** `.../walks/:walkId/rewind`. */
  rewind: 'rewind',
  /**
   * `.../walks/:walkId/record`, the recording screen of velista `0126`. Named
   * here so the resume warning can lead to it; the route is 0126's to add.
   */
  record: 'record',
  /** `.../walks/:walkId/edit`: editing a walk's map by hand (velista `0123`). */
  edit: 'edit',
  /** `.../edit/sheet/areas/:areaId`: the sheet of one area over the edit page. */
  areas: 'areas',
  /** The sheet over the walks list that names a new walk. */
  newWalk: 'new',
  /** The sheet over a walk's settings that confirms deleting it. */
  deleteWalk: 'delete',
  /** The warning over a walk's history before resuming the shown walk. */
  resume: 'resume',
} as const;

/** A shop's walks (velista `0122`). */
export function shopWalksPath(
  locale: string,
  basePath: string,
  locationId: string
): string {
  return appPath(
    locale,
    basePath,
    SHOP_PATHS.shop,
    locationId,
    SHOP_PATHS.walks
  );
}

/** The settings for every walk. */
export function mappingSettingsPath(
  locale: string,
  basePath: string,
  locationId: string
): string {
  return `${shopWalksPath(locale, basePath, locationId)}/${SHOP_PATHS.settings}`;
}

/**
 * One walk's page: its history with no `page`, else `rewind`, `settings`,
 * `edit` (velista `0123`), or `record` once velista `0126` adds it.
 */
export function shopWalkPath(
  locale: string,
  basePath: string,
  locationId: string,
  walkId: string,
  page: 'rewind' | 'settings' | 'record' | 'edit' | null = null
): string {
  const path = `${shopWalksPath(locale, basePath, locationId)}/${encodeURIComponent(walkId)}`;
  return page === null ? path : `${path}/${SHOP_PATHS[page]}`;
}

/** A shop's own page. */
export function shopPagePath(
  locale: string,
  basePath: string,
  locationId: string
): string {
  return appPath(locale, basePath, SHOP_PATHS.shop, locationId);
}

/**
 * A shop's map, counting from a basket (its id, or `live`) or from none.
 */
export function shopMapPath(
  locale: string,
  basePath: string,
  locationId: string,
  basket: string | null = null
): string {
  const path = appPath(
    locale,
    basePath,
    SHOP_PATHS.shop,
    locationId,
    SHOP_PATHS.map
  );
  return basket === null
    ? path
    : `${path}?${SHOP_PATHS.basketParam}=${encodeURIComponent(basket)}`;
}

/**
 * Opens a shop's own page, pushed so back returns to whatever opened it. Call it
 * in an injection context, as a field initializer, and keep the function.
 */
export function shopPageOpener(): (locationId: string) => void {
  const router = inject(Router);
  const basePath = inject(APP_BASE_PATH);
  const locale = inject(RokuLocaleStore).locale;
  return (locationId) =>
    void router.navigateByUrl(shopPagePath(locale(), basePath, locationId));
}
