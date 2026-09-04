import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Chains to show when there is no backend.
 *
 * Every data domain in this workspace runs without a server, and this is
 * supermarkets' share of that: the list, the form, the pagination and the
 * delete confirmation can all be driven from a checkout with nothing listening
 * on the gateway port.
 *
 * Real Spanish chains with their real Wikidata identifiers, because the point of
 * the brand key is that it splits `Carrefour` from `Carrefour Express`, and a
 * seed of `chain-1` and `chain-2` would demonstrate nothing about the field an
 * operator is most likely to get wrong.
 */
export const SUPERMARKET_SEED: readonly Wire.CatalogSupermarketView[] = [
  {
    id: 'sm_mercadona',
    name: { en: 'Mercadona', es: 'Mercadona' },
    logoUrl: null,
    websiteUrl: 'https://www.mercadona.es',
    externalBrandKey: 'Q1888874',
    defaultPriceScopeId: null,
  },
  {
    id: 'sm_bonpreu',
    name: { en: 'Bonpreu', es: 'Bonpreu' },
    logoUrl: null,
    websiteUrl: 'https://www.compraonline.bonpreuesclat.cat',
    externalBrandKey: 'Q11924747',
    defaultPriceScopeId: null,
  },
  {
    id: 'sm_carrefour',
    name: { en: 'Carrefour', es: 'Carrefour' },
    logoUrl: null,
    websiteUrl: 'https://www.carrefour.es',
    externalBrandKey: 'Q217599',
    defaultPriceScopeId: null,
  },
  {
    id: 'sm_carrefour_express',
    name: { en: 'Carrefour Express', es: 'Carrefour Express' },
    logoUrl: null,
    websiteUrl: 'https://www.carrefour.es',
    externalBrandKey: 'Q2940602',
    defaultPriceScopeId: null,
  },
  {
    id: 'sm_consum',
    name: { en: 'Consum', es: 'Consum' },
    logoUrl: null,
    websiteUrl: 'https://www.consum.es',
    externalBrandKey: 'Q8350308',
    defaultPriceScopeId: null,
  },
];
