import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Product groups to show when there is no backend.
 *
 * Real comparisons rather than `group-1` and `group-2`, because the thing worth
 * demonstrating is that a group's `referenceUnit` is its own: whole milk and
 * semi skimmed milk are compared per litre whatever size bottle they come in,
 * and toilet paper is compared per unit because a roll is the thing being
 * bought.
 */
export const PRODUCT_GROUP_SEED: readonly Wire.CatalogProductGroupView[] = [
  {
    id: 'pg_milk',
    name: { en: 'Milk', es: 'Leche' },
    slug: 'milk',
    referenceUnit: 'LITER',
    synonyms: {
      en: ['whole milk', 'semi skimmed milk', 'skimmed milk'],
      es: ['leche entera', 'leche semidesnatada', 'leche desnatada'],
    },
  },
  {
    id: 'pg_olive_oil',
    name: { en: 'Olive oil', es: 'Aceite de oliva' },
    slug: 'olive-oil',
    referenceUnit: 'LITER',
    synonyms: {
      en: ['extra virgin olive oil', 'virgin olive oil'],
      es: ['aceite de oliva virgen extra', 'aceite de oliva virgen'],
    },
  },
  {
    id: 'pg_toilet_paper',
    name: { en: 'Toilet paper', es: 'Papel higiénico' },
    slug: 'toilet-paper',
    referenceUnit: 'UNIT',
    synonyms: { en: ['bathroom tissue'], es: ['papel de baño'] },
  },
  {
    id: 'pg_eggs',
    name: { en: 'Eggs', es: 'Huevos' },
    slug: 'eggs',
    referenceUnit: 'UNIT',
    synonyms: { en: ['free range eggs'], es: ['huevos camperos'] },
  },
];
