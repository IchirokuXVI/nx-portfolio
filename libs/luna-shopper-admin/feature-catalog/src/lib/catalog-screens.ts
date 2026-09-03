import type { ResourceScreens } from '@portfolio/luna-shopper-admin/feature-resource';
import { PriceFormPage } from './price-form-page';
import { PRICES } from './prices';

/**
 * The catalog resources that draw with something of their own.
 *
 * One entry, and the plans said there would be one: prices need a form that
 * names the scope a price belongs to and says how many shops it covers, because
 * a price is not attached to a shop and an interface that hides that is not
 * simpler, it is wrong. Everything else in the catalog is a descriptor and no
 * code at all.
 *
 * Keyed by descriptor name so the route factory can look one up without the
 * app restating which screen belongs to which resource.
 */
export const CATALOG_SCREENS: Readonly<Record<string, ResourceScreens>> = {
  [PRICES.name]: { form: PriceFormPage },
};
