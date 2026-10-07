import { GatewayError } from '../gateway-error';
import { HarvestMemory } from './harvest-memory';

/**
 * Places out of memory, as backend plan 0193 answers them (admin plan 0061,
 * target 10).
 *
 * The places queue is shown and tested with nothing listening. So the memory
 * harvester has to answer the candidates on the list, the link with what it
 * filled, the other chain refusal and the bulk link the way the server does.
 */

const LIBERTADOR = 'place-mercadona-libertador';
const OESTE = 'place-mercadona-oeste';
const TRASSIERRA = 'place-mercadona-trassierra';
const CARREFOUR = 'place-carrefour-1';
const DIA = 'place-dia-1';

const refusal = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (error: unknown) => error as GatewayError
  );

async function candidatesOf(memory: HarvestMemory, id: string) {
  const page = await memory.listPlaces({ limit: 100 });
  const place = page.items.find((row) => row.id === id);
  if (place === undefined) {
    throw new Error(`no place ${id}`);
  }
  return place.candidates;
}

describe('HarvestMemory, the candidates of a place', () => {
  it('names the shop that carries the reference of a place', async () => {
    expect(await candidatesOf(new HarvestMemory(), OESTE)).toEqual([
      {
        supermarketLocationId: 'loc_cordoba_oeste',
        supermarketId: 'sm_mercadona',
        label: null,
        address: 'Calle Historiador Domínguez Ortiz 4',
        city: 'Córdoba',
        postalCode: '14005',
        rung: 'EXTERNAL_REF',
        metres: expect.any(Number),
      },
    ]);
  });

  it('names a shop of the chain within fifty metres', async () => {
    const [candidate] = await candidatesOf(new HarvestMemory(), LIBERTADOR);

    expect(candidate.supermarketLocationId).toBe('loc_cordoba_centro');
    expect(candidate.rung).toBe('NEARBY');
    expect(candidate.metres).toBeLessThanOrEqual(50);
  });

  it('names a shop of the chain farther than that as a hint', async () => {
    const [candidate] = await candidatesOf(new HarvestMemory(), TRASSIERRA);

    expect(candidate.supermarketLocationId).toBe('loc_sierra');
    expect(candidate.rung).toBe('SAME_CHAIN_NEAR');
    expect(candidate.metres).toBeGreaterThan(50);
    expect(candidate.metres).toBeLessThanOrEqual(250);
  });

  it('names nothing for a place with no shop near it', async () => {
    expect(await candidatesOf(new HarvestMemory(), DIA)).toEqual([]);
  });

  it('names nothing for a place that is decided', async () => {
    const memory = new HarvestMemory();
    await memory.rejectPlace(OESTE);

    expect(await candidatesOf(memory, OESTE)).toEqual([]);
  });
});

describe('HarvestMemory, an import of a place with a candidate', () => {
  it('is refused on a strict rung, with the candidates', async () => {
    const error = await refusal(new HarvestMemory().importPlace(OESTE, {}));

    expect(error?.code).toBe('place_matches_location');
    expect(error?.details['candidates']).toEqual([
      expect.objectContaining({
        supermarketLocationId: 'loc_cordoba_oeste',
        rung: 'EXTERNAL_REF',
      }),
    ]);
  });

  it('is not refused on a hint', async () => {
    const place = await new HarvestMemory().importPlace(TRASSIERRA, {});

    expect(place.status).toBe('IMPORTED');
  });

  /**
   * The strict rungs read the shops of the chain that the import names. The
   * place stands 28 metres from a Mercadona shop, and Consum has none there.
   */
  it('matches against the chain that is picked, and not the chain of the place', async () => {
    const place = await new HarvestMemory().importPlace(LIBERTADOR, {
      supermarketId: 'sm_consum',
    });

    expect(place.status).toBe('IMPORTED');
  });

  it('is still refused under the chain of the place when that chain is picked', async () => {
    const error = await refusal(
      new HarvestMemory().importPlace(LIBERTADOR, {
        supermarketId: 'sm_mercadona',
      })
    );

    expect(error?.code).toBe('place_matches_location');
  });
});

/** Backend plan 0195: an import never makes a second shop for a reference. */
describe('HarvestMemory, an import whose reference a shop holds', () => {
  const holder = {
    supermarketLocationId: 'loc_cordoba_oeste',
    supermarketId: 'sm_mercadona',
    supermarketName: { en: 'Mercadona', es: 'Mercadona' },
    label: null,
    address: 'Calle Historiador Domínguez Ortiz 4',
    city: 'Córdoba',
    externalProvider: 'osm',
  };

  it('is refused with the holder, also with force', async () => {
    const memory = new HarvestMemory();

    const error = await refusal(memory.importPlace(OESTE, { force: true }));

    expect(error?.status).toBe(409);
    expect(error?.code).toBe('location_external_ref_taken');
    expect(error?.details).toEqual({
      externalRef: 'way/48821004',
      heldBy: holder,
    });
    // Nothing was written: the place is still undecided.
    const page = await memory.listPlaces({ status: 'NEW', limit: 100 });
    expect(page.items.some((place) => place.id === OESTE)).toBe(true);
  });

  /** The holder is a shop of another chain than the one that is picked. */
  it('is refused without force when the holder is of another chain', async () => {
    const error = await refusal(
      new HarvestMemory().importPlace(OESTE, { supermarketId: 'sm_consum' })
    );

    expect(error?.code).toBe('location_external_ref_taken');
    expect(error?.details['heldBy']).toEqual(holder);
  });
});

describe('HarvestMemory, a link', () => {
  it('answers the place and the fields it filled', async () => {
    const result = await new HarvestMemory().linkPlace(TRASSIERRA, {
      supermarketLocationId: 'loc_sierra',
    });

    expect(result.place).toEqual(
      expect.objectContaining({
        id: TRASSIERRA,
        status: 'IMPORTED',
        supermarketLocationId: 'loc_sierra',
        candidates: [],
      })
    );
    // The shop held a street and a country, and no city and no postal code.
    expect(result.filled).toEqual(['POSTAL_CODE', 'CITY']);
  });

  it('replaces a postal code that catalog guessed with the stated one', async () => {
    const result = await new HarvestMemory().linkPlace(OESTE, {
      supermarketLocationId: 'loc_cordoba_oeste',
    });

    expect(result.filled).toEqual(['POSTAL_CODE']);
  });

  it('answers an empty list for a shop that held everything', async () => {
    const result = await new HarvestMemory().linkPlace(LIBERTADOR, {
      supermarketLocationId: 'loc_cordoba_centro',
    });

    expect(result.filled).toEqual([]);
  });

  it('links a place that names no chain to the shop that is named', async () => {
    // Dia is a chain the memory catalog does not hold.
    const result = await new HarvestMemory().linkPlace(DIA, {
      supermarketLocationId: 'loc_consum_centro',
    });

    expect(result.place.status).toBe('IMPORTED');
  });

  it('refuses a place that names another chain, and writes nothing', async () => {
    const memory = new HarvestMemory();

    const error = await refusal(
      memory.linkPlace(CARREFOUR, { supermarketLocationId: 'loc_sierra' })
    );

    expect(error).toBeInstanceOf(GatewayError);
    expect(error?.status).toBe(409);
    expect(error?.code).toBe('place_names_another_chain');
    expect(error?.details['chain']).toEqual({
      id: 'sm_carrefour',
      name: { en: 'Carrefour', es: 'Carrefour' },
    });
    const page = await memory.listPlaces({ status: 'NEW', limit: 100 });
    expect(page.items.some((place) => place.id === CARREFOUR)).toBe(true);
  });

  it('links across chains when the request says so', async () => {
    const result = await new HarvestMemory().linkPlace(CARREFOUR, {
      supermarketLocationId: 'loc_sierra',
      acrossChains: true,
    });

    expect(result.place.supermarketLocationId).toBe('loc_sierra');
    // The place holds no postal code. It was mapped as an outline, and the
    // shop has no size yet, so the floor area is filled beside the city.
    expect(result.filled).toEqual(['FOOTPRINT', 'CITY']);
    // Nothing held the reference, so the answer names no holder.
    expect('refHeldBy' in result).toBe(false);
  });

  /**
   * Backend plan 0195. The Consum shop has no reference, and a Mercadona
   * shop holds the reference of the place.
   */
  it('leaves a reference that another shop holds empty, links, and names the holder', async () => {
    const memory = new HarvestMemory();

    const result = await memory.linkPlace(OESTE, {
      supermarketLocationId: 'loc_consum_centro',
      acrossChains: true,
    });

    expect(result.place).toEqual(
      expect.objectContaining({
        status: 'IMPORTED',
        supermarketLocationId: 'loc_consum_centro',
      })
    );
    expect(result.filled).not.toContain('EXTERNAL_REF');
    expect(result.refHeldBy).toEqual(
      expect.objectContaining({
        supermarketLocationId: 'loc_cordoba_oeste',
        supermarketName: { en: 'Mercadona', es: 'Mercadona' },
        address: 'Calle Historiador Domínguez Ortiz 4',
        city: 'Córdoba',
      })
    );

    // The shop still has no reference: the next link fills it.
    const next = await memory.linkPlace(DIA, {
      supermarketLocationId: 'loc_consum_centro',
    });
    expect(next.filled).toEqual(['EXTERNAL_REF']);
    expect('refHeldBy' in next).toBe(false);
  });

  it('refuses a shop the catalog does not hold', async () => {
    const error = await refusal(
      new HarvestMemory().linkPlace(DIA, { supermarketLocationId: 'nowhere' })
    );

    expect(error?.code).toBe('not_found');
  });

  it('refuses a place that is already imported', async () => {
    const memory = new HarvestMemory();
    await memory.linkPlace(OESTE, {
      supermarketLocationId: 'loc_cordoba_oeste',
    });

    const error = await refusal(
      memory.linkPlace(OESTE, { supermarketLocationId: 'loc_cordoba_oeste' })
    );

    expect(error?.code).toBe('place_already_imported');
  });
});

describe('HarvestMemory, the bulk link by reference', () => {
  it('answers what it would do and changes nothing, without apply', async () => {
    const memory = new HarvestMemory();

    const dry = await memory.linkPlacesByRef({});

    expect(dry.applied).toBe(false);
    expect(dry.skipped).toEqual([]);
    expect(dry.linked).toHaveLength(1);
    expect(dry.linked[0].place).toEqual(
      expect.objectContaining({ id: OESTE, status: 'NEW' })
    );
    expect(dry.linked[0].shop).toEqual(
      expect.objectContaining({
        supermarketLocationId: 'loc_cordoba_oeste',
        rung: 'EXTERNAL_REF',
      })
    );
    expect(dry.linked[0].filled).toEqual(['POSTAL_CODE']);

    // Nothing was written: the place is still in the queue, with its
    // candidate, and a second dry call answers the same.
    const page = await memory.listPlaces({ status: 'NEW', limit: 100 });
    expect(page.items.some((place) => place.id === OESTE)).toBe(true);
    expect((await memory.linkPlacesByRef({})).linked).toHaveLength(1);
  });

  it('links with apply, and a second call finds nothing', async () => {
    const memory = new HarvestMemory();

    const applied = await memory.linkPlacesByRef({ apply: true });

    expect(applied.applied).toBe(true);
    expect(applied.linked).toHaveLength(1);
    expect(applied.linked[0].place).toEqual(
      expect.objectContaining({
        id: OESTE,
        status: 'IMPORTED',
        supermarketLocationId: 'loc_cordoba_oeste',
      })
    );

    const page = await memory.listPlaces({ status: 'NEW', limit: 100 });
    expect(page.items.some((place) => place.id === OESTE)).toBe(false);
    const again = await memory.linkPlacesByRef({ apply: true });
    expect(again.linked).toEqual([]);
    expect(again.skipped).toEqual([]);
  });
});
