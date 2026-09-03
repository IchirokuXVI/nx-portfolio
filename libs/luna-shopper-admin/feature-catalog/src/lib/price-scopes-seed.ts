import type { Wire } from '@portfolio/luna-shopper-admin/models';

/**
 * Price scopes to show when there is no backend.
 *
 * Three kinds, because the kinds are the point. Mercadona prices per warehouse
 * and many shops share one row; Consum prices nationally; Bonpreu has no
 * automated source at all and therefore one `STORE` scope per shop, which is
 * what makes a hand typed price work with no special case anywhere.
 */
export const PRICE_SCOPE_SEED: readonly Wire.CatalogPriceScopeView[] = [
  {
    id: 'ps_mercadona_4661',
    supermarketId: 'sm_mercadona',
    kind: 'WAREHOUSE',
    externalKey: '4661',
    label: { en: 'Córdoba warehouse', es: 'Almacén de Córdoba' },
  },
  {
    id: 'ps_mercadona_mad3',
    supermarketId: 'sm_mercadona',
    kind: 'WAREHOUSE',
    // A string and never a number: the same field comes back as a numeric code
    // from one chain and a city slug from another.
    externalKey: 'mad3',
    label: { en: 'Madrid warehouse', es: 'Almacén de Madrid' },
  },
  {
    id: 'ps_consum_national',
    supermarketId: 'sm_consum',
    kind: 'NATIONAL',
    externalKey: null,
    label: null,
  },
  {
    id: 'ps_bonpreu_bcn_gracia',
    supermarketId: 'sm_bonpreu',
    kind: 'STORE',
    externalKey: null,
    label: { en: 'Gràcia', es: 'Gràcia' },
  },
];
