import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { confidencePercent, refLines, refProblem } from './ref-view';

type Ref = Wire.HarvestItemSourceRefView;

function ref(over: Partial<Ref> = {}): Ref {
  return {
    id: 'ref-1',
    itemId: 'item-1',
    supermarketId: 'chain-1',
    externalId: '12345',
    externalUrl: null,
    matchedBy: 'NAME_BRAND_SIZE',
    status: 'CANDIDATE',
    confidence: 0.72,
    lastResolvedAt: null,
    lastSeenAt: '2026-09-03T09:00:00.000Z',
    ...over,
  };
}

/**
 * The distinction plan 0006 section 5 asks for, derived rather than read.
 *
 * There is no `GONE` status. `ItemSourceRefStatus` is ACTIVE, CANDIDATE,
 * REJECTED and MANUAL, so the state has to come from the two timestamps.
 */
describe('refProblem', () => {
  it('is unmatched for a ref that was never resolved', () => {
    expect(refProblem(ref({ lastResolvedAt: null }))).toBe('unmatched');
  });

  it('is unmatched for a resolved ref still being seen', () => {
    const live = ref({
      lastResolvedAt: '2026-08-01T09:00:00.000Z',
      lastSeenAt: '2026-09-03T09:00:00.000Z',
    });

    expect(refProblem(live)).toBe('unmatched');
  });

  /**
   * Resolved once and not seen since. Confirming this settles a link to a
   * product that is not there, so the remedy is usually the correction rather
   * than a yes.
   */
  it('is stale for a resolved ref that stopped appearing', () => {
    const gone = ref({
      lastResolvedAt: '2026-08-01T09:00:00.000Z',
      lastSeenAt: '2026-08-01T09:00:00.000Z',
    });

    expect(refProblem(gone)).toBe('stale');
  });

  it('is stale for a resolved ref that has never been seen', () => {
    const gone = ref({
      lastResolvedAt: '2026-08-01T09:00:00.000Z',
      lastSeenAt: null,
    });

    expect(refProblem(gone)).toBe('stale');
  });
});

describe('confidencePercent', () => {
  it('reads a decimal as a percentage', () => {
    expect(confidencePercent(ref({ confidence: 0.72 }))).toBe(72);
  });

  it('clamps a value outside the range rather than rendering it', () => {
    expect(confidencePercent(ref({ confidence: 1.4 }))).toBe(100);
    expect(confidencePercent(ref({ confidence: -1 }))).toBe(0);
  });
});

describe('refLines', () => {
  it('keeps a fixed order whether or not a value is present', () => {
    const full = refLines(ref({ externalUrl: 'https://example.test' })).map(
      (line) => line.key
    );
    const sparse = refLines(ref({ externalUrl: null })).map((line) => line.key);

    expect(sparse).toEqual(full);
  });

  it('renders a missing link as empty rather than as the word null', () => {
    const lines = refLines(ref({ externalUrl: null }));

    expect(lines.find((line) => line.key === 'externalUrl')?.value).toBe('');
  });
});
