import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Products to show when there is no backend.
 *
 * Two of them belong to a group and two do not, on purpose: an ungrouped
 * product is the resting state of a fresh harvest and the thing the "not in a
 * group" filter exists to find, so a seed where everything was curated would
 * demonstrate nothing about the screen's main job.
 */
export const ITEM_SEED: readonly Wire.CatalogItemView[] = [
  {
    id: 'it_milk_hacendado_1l',
    name: {
      en: 'Hacendado whole milk 1 L',
      es: 'Leche entera Hacendado 1 L',
    },
    brand: 'Hacendado',
    imageUrl: null,
    sku: '12345',
    ean: '8480000123456',
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
    productGroupId: 'pg_milk',
  },
  {
    id: 'it_milk_pascual_6x1l',
    name: {
      en: 'Pascual semi skimmed milk 6 × 1 L',
      es: 'Leche semidesnatada Pascual 6 × 1 L',
    },
    brand: 'Pascual',
    imageUrl: null,
    sku: null,
    ean: '8410128760014',
    unitSize: 6,
    category: 'DAIRY',
    defaultUnit: 'LITER',
    productGroupId: 'pg_milk',
  },
  {
    id: 'it_oil_carbonell_1l',
    name: {
      en: 'Carbonell extra virgin olive oil 1 L',
      es: 'Aceite de oliva virgen extra Carbonell 1 L',
    },
    brand: 'Carbonell',
    imageUrl: null,
    sku: null,
    ean: '8410010001010',
    unitSize: 1,
    category: 'PANTRY',
    defaultUnit: 'LITER',
    // Harvested and not yet curated, which is what almost every row looks like
    // the day it arrives.
    productGroupId: null,
  },
  {
    id: 'it_detergent_ariel_lv',
    name: {
      en: 'Ariel liquid detergent 40 washes',
      es: 'Detergente líquido Ariel 40 lavados',
    },
    brand: 'Ariel',
    imageUrl: null,
    sku: null,
    ean: null,
    unitSize: 40,
    category: 'HOUSEHOLD',
    defaultUnit: 'UNIT',
    productGroupId: null,
  },
];
