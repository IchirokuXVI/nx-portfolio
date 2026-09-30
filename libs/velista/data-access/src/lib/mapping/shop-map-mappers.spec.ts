import { MEMORY_SHOP_MAPS } from '../shops/shop-map-memory';
import { toShopDetail, toShopMapRead } from './shop-map-mappers';

/** The memory map's wire body, with its `map` replaced by whatever a spec says. */
function withMap(patch: (map: Record<string, unknown>) => unknown): unknown {
  const body = MEMORY_SHOP_MAPS['loc-tejares'] as {
    map: Record<string, unknown>;
  };
  return { map: patch(JSON.parse(JSON.stringify(body.map))) };
}

/** Velista `0121`: the map read, rule D4 applied to a map. */
describe('toShopMapRead', () => {
  it('reads a shop with no map as none, which is an answer', () => {
    expect(toShopMapRead({ map: null })).toEqual({ kind: 'none' });
  });

  it('reads anything that is not the envelope as failed', () => {
    expect(toShopMapRead(null)).toEqual({ kind: 'failed' });
    expect(toShopMapRead({})).toEqual({ kind: 'failed' });
    expect(toShopMapRead({ map: { walkId: 'w' } })).toEqual({
      kind: 'failed',
    });
  });

  it('reads a map into a document the canvas can draw, with its sections and notes', () => {
    const read = toShopMapRead(MEMORY_SHOP_MAPS['loc-tejares']);

    expect(read.kind).toBe('map');
    if (read.kind !== 'map') {
      return;
    }
    expect(read.map.walkId).toBe('walk-tejares');
    expect(read.map.savedAt?.toISOString()).toBe('2026-09-29T12:42:00.000Z');
    expect(read.map.document.areas.map((area) => area.id)).toEqual([
      'area-door',
      'area-eggs',
      'area-pantry',
      'area-till',
    ]);
    expect(read.map.notes.map((note) => note.text)).toEqual([
      'Free range eggs are on the bottom shelf.',
    ]);
    expect(read.map.sections).toEqual([
      { name: 'Huevos', sectionId: 'sec-mercadona-eggs' },
      { name: 'Despensa', sectionId: 'sec-mercadona-pantry' },
    ]);
  });

  it('refuses a map whose shelves stand on top of each other', () => {
    const body = withMap((map) => {
      const view = map['view'] as { areas: Record<string, unknown>[] };
      view.areas.push({ ...view.areas[1], id: 'area-copy' });
      return map;
    });

    expect(toShopMapRead(body)).toEqual({ kind: 'failed' });
  });

  it('refuses a map with a walkway ring it cannot read', () => {
    const body = withMap((map) => {
      (map['view'] as { walkway: unknown[] }).walkway.push([[0, 'a']]);
      return map;
    });

    expect(toShopMapRead(body)).toEqual({ kind: 'failed' });
  });

  it('leaves out an area of a kind this build does not know', () => {
    const body = withMap((map) => {
      const view = map['view'] as { areas: Record<string, unknown>[] };
      view.areas.push({
        id: 'area-lift',
        kind: 'lift',
        x: 40,
        y: 40,
        w: 2,
        h: 2,
        colour: { mode: 'default' },
      });
      return map;
    });
    const read = toShopMapRead(body);

    expect(read.kind).toBe('map');
    expect(
      read.kind === 'map' &&
        read.map.document.areas.some((a) => a.id === 'area-lift')
    ).toBe(false);
  });

  it('drops a section with no id rather than a whole map', () => {
    const body = withMap((map) => ({
      ...map,
      sections: [{ name: 'Huevos' }, { name: 'Despensa', sectionId: 's-2' }],
    }));
    const read = toShopMapRead(body);

    expect(read.kind === 'map' && read.map.sections).toEqual([
      { name: 'Despensa', sectionId: 's-2' },
    ]);
  });
});

describe('toShopDetail', () => {
  const RAW = {
    id: 'loc-1',
    supermarketId: 'sm-1',
    label: { en: '', es: 'Ciudad Jardín' },
    address: 'Avenida de Cádiz 12',
    city: 'Córdoba',
    postalCode: '14013',
    footprintM2: 1187,
    hasMap: true,
    sections: [{ id: 's-1', name: { en: 'Dairy', es: 'Lácteos' } }],
  };

  it('reads a shop with its chain, size, map and sections', () => {
    expect(toShopDetail(RAW, { en: 'El Jamón', es: 'El Jamón' })).toEqual({
      id: 'loc-1',
      supermarketId: 'sm-1',
      chain: { en: 'El Jamón', es: 'El Jamón' },
      label: { en: '', es: 'Ciudad Jardín' },
      address: 'Avenida de Cádiz 12',
      city: 'Córdoba',
      postalCode: '14013',
      footprintM2: 1187,
      hasMap: true,
      sections: [{ id: 's-1', name: { en: 'Dairy', es: 'Lácteos' } }],
    });
  });

  it('offers no map unless the wire says exactly that', () => {
    expect(toShopDetail({ ...RAW, hasMap: 'yes' }, null)?.hasMap).toBe(false);
    expect(toShopDetail({ ...RAW, hasMap: undefined }, null)?.hasMap).toBe(
      false
    );
  });

  it('keeps a size only when it is a positive number', () => {
    expect(
      toShopDetail({ ...RAW, footprintM2: 0 }, null)?.footprintM2
    ).toBeNull();
    expect(
      toShopDetail({ ...RAW, footprintM2: '900' }, null)?.footprintM2
    ).toBeNull();
    expect(
      toShopDetail({ ...RAW, footprintM2: null }, null)?.footprintM2
    ).toBeNull();
  });

  it('refuses a shop with no id or no chain', () => {
    expect(toShopDetail({ ...RAW, id: '' }, null)).toBeNull();
    expect(toShopDetail({ ...RAW, supermarketId: 7 }, null)).toBeNull();
    expect(toShopDetail('shop', null)).toBeNull();
  });
});
