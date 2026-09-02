import { PriceScopeKind } from '@portfolio/luna-shopper/contracts';
import type { ReferenceStore } from './types';

/**
 * The two chains the reference catalog introduces (plan 0067, section 5).
 *
 * Both get a `STORE` scope with one location, which is exactly the case the
 * scope entity was designed for: "a chain with no obtainable data gets one STORE
 * scope per location and hand entered prices". Neither has a storefront the
 * harvester can read, so every price they carry came off a till receipt and
 * always will until someone writes a source for them.
 *
 * Mercadona is deliberately absent. It already exists, with a WAREHOUSE scope
 * per warehouse, and the reference catalog attaches to what the harvest created
 * rather than creating a second Mercadona beside it.
 */
export const REFERENCE_STORES: ReferenceStore[] = [
  {
    slug: 'el-jamon',
    name: { en: 'El Jamón', es: 'El Jamón' },
    // Grupo Empresarial El Jamón, S.L., the operator named on the receipts.
    externalBrandKey: 'Q116893318',
    scopeKind: PriceScopeKind.STORE,
    scopeLabel: { en: 'Córdoba — Ronda', es: 'Córdoba — Ronda' },
    location: {
      label: { en: 'Córdoba — Ronda', es: 'Córdoba — Ronda' },
      address: 'C/ Ronda, 5',
      city: 'Córdoba',
      postalCode: '14013',
      country: 'ES',
    },
  },
  {
    slug: 'supercash',
    name: { en: 'SuperCash', es: 'SuperCash' },
    // Deza Calidad, S.A., which trades as SuperCash.
    externalBrandKey: 'Q117761543',
    scopeKind: PriceScopeKind.STORE,
    scopeLabel: {
      en: 'Córdoba — Libertador Sucre',
      es: 'Córdoba — Libertador Sucre',
    },
    location: {
      label: {
        en: 'Córdoba — Libertador Sucre',
        es: 'Córdoba — Libertador Sucre',
      },
      // The store the receipts were rung up in. The company address printed at
      // the head of the long tickets (P. Las Quemadas, 14014) is Deza Calidad's
      // registered office, not a shop, which is why it is not this.
      address: 'Av. Libertador Sucre',
      city: 'Córdoba',
      postalCode: '14013',
      country: 'ES',
    },
  },
];
