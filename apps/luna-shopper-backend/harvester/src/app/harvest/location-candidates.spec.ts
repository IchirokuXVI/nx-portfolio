import {
  LOCATION_CANDIDATES_MAX,
  rankLocations,
  type LocationCandidate,
} from './matching';

/**
 * The token rule that proposes a catalog shop for a source's printed shop name
 * (plan 0154, section 1).
 *
 * The fixture is the ground plan 0150 covered in Córdoba. The printed names
 * are the eleven shops the DEZA site listed (`responses/04-p1-step5/deza-shops.json`
 * in the report). The locations are the chain's shops as catalog would hold
 * them once every DEZA place OpenStreetMap found there is imported
 * (`responses/03-p1-step4/places-all.json`), plus the seeded SuperCash shop.
 * An OpenStreetMap import has no label, so the address is all there is to
 * match, and that is the case the exact match never hit.
 */

function location(
  id: string,
  address: string,
  postalCode: string,
  label: string | null = null
): LocationCandidate {
  return {
    id,
    label: label === null ? null : { es: label, en: label },
    address,
    postalCode,
  };
}

const CORDOBA: LocationCandidate[] = [
  location('loc-martorell', 'Calle José María Martorell', '14005'),
  location('loc-fuerteventura', 'Calle Isla de Fuerteventura 48', '14011'),
  location('loc-marrubial', 'Avenida Ronda del Marrubial', '14007'),
  location('loc-castro', 'Carretera de Castro 42', '14009'),
  location('loc-libia', 'Avenida de Libia', '14007'),
  location('loc-rescatado', 'Avenida Jesús Rescatado 15', '14010'),
  location('loc-barca', 'Calle Camino de la Barca 1', '14010'),
  // OpenStreetMap's "Supercash Sector Sur", and the seeded SuperCash shop on
  // the same street.
  location('loc-sector-sur', 'Calle Libertador Sucre 38', '14013'),
  location(
    'loc-seed-supercash',
    'Av. Libertador Sucre',
    '14013',
    'Córdoba — Libertador Sucre'
  ),
];

/**
 * Each printed shop, the location it really is, and whether the rule finds it.
 *
 * `real` is null where catalog holds no location for the shop in this
 * fixture: OpenStreetMap had no DEZA place for Zoco, Fuente de la Salud or
 * SuperCash Quemadas, and "Disponibilidad diaria" is not a shop at all.
 *
 * **C2 is a known miss.** "SuperCash (Sector Sur)" names a neighbourhood and
 * both locations for it name the street, so they share no token. The rule
 * proposes nothing for it rather than something wrong, and the operator maps
 * it by hand as before.
 */
const DEZA_SHOPS: Array<{
  externalId: string;
  printedName: string;
  real: string | null;
  found: string | null;
  strong: boolean;
}> = [
  {
    externalId: 'CONSULTAR',
    printedName: 'Disponibilidad diaria según mercado',
    real: null,
    found: null,
    strong: false,
  },
  {
    externalId: 'C1',
    printedName: 'SuperCash (Quemadas)',
    real: null,
    found: null,
    strong: false,
  },
  {
    externalId: 'C2',
    printedName: 'SuperCash (Sector Sur)',
    real: 'loc-sector-sur',
    found: null,
    strong: false,
  },
  {
    externalId: 'T1',
    printedName: 'Jesús Rescatado',
    real: 'loc-rescatado',
    found: 'loc-rescatado',
    strong: true,
  },
  {
    // "Ctra." is not a stop word, so half the printed tokens are held.
    externalId: 'T2',
    printedName: 'Ctra. de Castro',
    real: 'loc-castro',
    found: 'loc-castro',
    strong: false,
  },
  {
    externalId: 'T3',
    printedName: 'Ronda del Marrubial',
    real: 'loc-marrubial',
    found: 'loc-marrubial',
    strong: true,
  },
  {
    externalId: 'T4',
    printedName: 'Isla Fuerteventura',
    real: 'loc-fuerteventura',
    found: 'loc-fuerteventura',
    strong: true,
  },
  {
    externalId: 'T5',
    printedName: 'Camino de la Barca',
    real: 'loc-barca',
    found: 'loc-barca',
    strong: true,
  },
  {
    externalId: 'T6',
    printedName: 'Avda. de Libia',
    real: 'loc-libia',
    found: 'loc-libia',
    strong: true,
  },
  {
    externalId: 'T7',
    printedName: 'Fuente de la salud',
    real: null,
    found: null,
    strong: false,
  },
  {
    externalId: 'Z1',
    printedName: 'Zoco',
    real: null,
    found: null,
    strong: false,
  },
];

describe('rankLocations, the eleven DEZA shops in Córdoba (plan 0154)', () => {
  it.each(DEZA_SHOPS)(
    '$externalId "$printedName" proposes $found first',
    ({ printedName, found, strong }) => {
      const ranked = rankLocations(printedName, CORDOBA);

      if (found === null) {
        expect(ranked).toEqual([]);
        return;
      }
      expect(ranked[0].location.id).toBe(found);
      expect(ranked[0].strong).toBe(strong);
    }
  );

  it('ranks the real location first for every shop that has one, but C2', () => {
    const misses = DEZA_SHOPS.filter(
      ({ printedName, real }) =>
        real !== null &&
        rankLocations(printedName, CORDOBA)[0]?.location.id !== real
    ).map(({ externalId }) => externalId);

    expect(misses).toEqual(['C2']);
  });

  it('never proposes a location for a shop catalog does not hold', () => {
    for (const { printedName, real } of DEZA_SHOPS) {
      if (real === null) {
        expect(rankLocations(printedName, CORDOBA)).toEqual([]);
      }
    }
  });
});

describe('rankLocations, the rule', () => {
  it('drops stop words and street numbers from the printed name only', () => {
    const [top] = rankLocations('Calle de la Barca 7', [
      location('loc-barca', 'Camino Barca', '14010'),
    ]);

    expect(top).toMatchObject({ score: 1, strong: true });
  });

  it('counts a postal code the printed name carries', () => {
    const ranked = rankLocations('Barca 14010', [
      location('loc-barca', 'Camino de la Barca 1', '14010'),
      location('loc-barca-2', 'Camino de la Barca 1', '41010'),
    ]);

    expect(ranked.map(({ location: l, score }) => [l.id, score])).toEqual([
      ['loc-barca', 1],
      ['loc-barca-2', 0.5],
    ]);
  });

  it('reads the label as well as the address', () => {
    const [top] = rankLocations('Zoco', [
      location('loc-zoco', 'Calle Poeta Paredes 2', '14008', 'Zoco Córdoba'),
    ]);

    expect(top?.location.id).toBe('loc-zoco');
  });

  it('keeps nothing under half the printed tokens', () => {
    expect(
      rankLocations('Plaza Mayor Norte', [
        location('loc-plaza', 'Plaza Menor', '14001'),
      ])
    ).toEqual([]);
  });

  it('answers at most three, best first, ties by id', () => {
    const ranked = rankLocations('Ronda Norte', [
      location('loc-d', 'Ronda Sur', '14001'),
      location('loc-c', 'Ronda Norte', '14001'),
      location('loc-b', 'Ronda Este', '14001'),
      location('loc-a', 'Ronda Oeste', '14001'),
    ]);

    expect(ranked).toHaveLength(LOCATION_CANDIDATES_MAX);
    expect(ranked.map(({ location: l }) => l.id)).toEqual([
      'loc-c',
      'loc-a',
      'loc-b',
    ]);
  });

  it('proposes nothing for a name made only of stop words', () => {
    expect(
      rankLocations('Calle de la', [location('loc-1', 'Calle de la', '14001')])
    ).toEqual([]);
  });
});
