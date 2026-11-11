import { readsTheChain, redProbe, toProbeStatus } from './probe-verdict';

function row(
  id: string,
  status: string,
  error: string | null = null
): Record<string, unknown> {
  return {
    id,
    sourceId: 'source-deza',
    supermarketId: 'deza',
    adapterKey: 'deza-web',
    trigger: 'MANUAL',
    status,
    previousStatus: null,
    changed: false,
    attempt: 1,
    startedAt: `2026-11-0${id.length}T06:00:00.000Z`,
    finishedAt: null,
    durationMs: null,
    requests: 2,
    steps: [],
    error,
    requestedByUserId: null,
    scheduleId: null,
  };
}

function page(...items: unknown[]): unknown {
  return { items, nextCursor: null };
}

describe('redProbe', () => {
  it('answers a red newest finished probe, with its sentence', () => {
    expect(
      redProbe(page(row('p1', 'UNREACHABLE', 'home: fetch failed.')))
    ).toEqual({
      id: 'p1',
      status: 'UNREACHABLE',
      startedAt: '2026-11-02T06:00:00.000Z',
      error: 'home: fetch failed',
    });
  });

  it('answers null for a green newest finished probe', () => {
    expect(redProbe(page(row('p1', 'PASSED'), row('p2', 'BLOCKED')))).toBe(
      null
    );
  });

  it('answers null for a chain with no probe', () => {
    expect(redProbe(page())).toBe(null);
  });

  it('reads past a running newest probe to a red one', () => {
    expect(
      redProbe(page(row('p1', 'RUNNING'), row('p2', 'SHAPE_CHANGED')))?.id
    ).toBe('p2');
  });

  it('answers null for a running newest probe over a green one', () => {
    expect(redProbe(page(row('p1', 'RUNNING'), row('p2', 'PASSED')))).toBe(
      null
    );
  });

  it('reads past an aborted newest probe to a red one', () => {
    expect(
      redProbe(page(row('p1', 'ABORTED'), row('p2', 'ERROR')))?.status
    ).toBe('ERROR');
  });

  it('answers null when only running and aborted probes are in the page', () => {
    expect(redProbe(page(row('p1', 'RUNNING'), row('p2', 'ABORTED')))).toBe(
      null
    );
  });

  it('keeps no sentence for a probe that sent none', () => {
    expect(redProbe(page(row('p1', 'BLOCKED', '  ')))?.error).toBe(null);
  });

  it('stops at a status this app does not know', () => {
    expect(redProbe(page(row('p1', 'MELTED'), row('p2', 'ERROR')))).toBe(null);
  });

  it('answers null for a body that is not a page', () => {
    expect(redProbe(null)).toBe(null);
    expect(redProbe({ items: 'no' })).toBe(null);
  });
});

describe('toProbeStatus', () => {
  it('reads the seven statuses and nothing else', () => {
    expect(toProbeStatus('PASSED')).toBe('PASSED');
    expect(toProbeStatus('passed')).toBe(null);
    expect(toProbeStatus(3)).toBe(null);
  });
});

describe('readsTheChain', () => {
  it.each([
    'lidl-api',
    'mercadona-api',
    'eljamon-web',
    'dia-api',
    'deza-web',
    'carrefour-web',
  ])('is true for a catalog discovery of %s', (adapterKey) => {
    expect(readsTheChain('CATALOG_DISCOVERY', adapterKey)).toBe(true);
  });

  it('is true for a store discovery of a chain that lists its own shops', () => {
    expect(readsTheChain('STORE_DISCOVERY', 'deza-web')).toBe(true);
  });

  it('is false for a store discovery over OpenStreetMap', () => {
    expect(readsTheChain('STORE_DISCOVERY', 'osm-places')).toBe(false);
  });

  it('is false for a store discovery of an adapter this build does not know', () => {
    expect(readsTheChain('STORE_DISCOVERY', 'new-web')).toBe(false);
  });

  it('is false for a file import', () => {
    expect(readsTheChain('FILE_IMPORT', 'deza-web')).toBe(false);
  });
});
