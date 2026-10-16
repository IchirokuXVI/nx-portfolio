import {
  foldWalk,
  shopperView,
  type WalkEntry,
} from '@portfolio/luna-shopper/shop-map/model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SHOP_WALK_GUARD_KINDS,
  SHOP_WALK_PATTERNS,
} from '../lib/messages/shop-walk.messages';
import { SHOP_WALK_SCHEMA_IDS } from './messages/shop-walk.schemas';
import {
  validateMessageRequest,
  validateMessageResponse,
  validateSchema,
} from './validator';

/**
 * The wire shapes of backend plan 0168 against the model library's own output.
 *
 * The El Jamón walk log is the model's fixture, read as a file rather than
 * imported so no library reaches into another's sources. Every entry of it has
 * to pass the append request, the fold of it the document schema, and the
 * shopper's view of that fold the map view: the contract restates the model,
 * and this is what says it restates it correctly.
 */
const FIXTURE = join(
  __dirname,
  '../../../shop-map/model/src/lib/__fixtures__/el-jamon/walk-log.json'
);
const log = (
  JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
    entries: Omit<WalkEntry, 'seq'>[];
  }
).entries.map((entry, index) => ({ ...entry, seq: index + 1 }) as WalkEntry);

describe('shop walk schemas (plan 0168)', () => {
  it('accepts every entry of the El Jamón log as an append request', () => {
    for (const entry of log) {
      const { seq, ...rest } = entry;
      const result = validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        userId: 'u1',
        walkId: 'w1',
        baseSeq: seq - 1,
        ...rest,
      });
      expect({ id: entry.id, errors: result.errors }).toEqual({
        id: entry.id,
        errors: [],
      });
    }
  });

  it('accepts the fold as a document, and the shopper view of it as a map', () => {
    const document = foldWalk(log);
    expect(
      validateSchema(SHOP_WALK_SCHEMA_IDS.shopMapDocument, document).errors
    ).toEqual([]);
    expect(
      validateMessageResponse(SHOP_WALK_PATTERNS.mapForLocation, {
        map: {
          walkId: 'w1',
          savedAt: '2026-09-29T11:00:00.000Z',
          view: shopperView(document),
          sections: [{ name: 'Lácteos', sectionId: 's1' }],
        },
      }).errors
    ).toEqual([]);
  });

  it('answers a shop with no map as null', () => {
    expect(
      validateMessageResponse(SHOP_WALK_PATTERNS.mapForLocation, { map: null })
        .valid
    ).toBe(true);
  });

  it('accepts a guard event of every kind, and refuses one it does not know (plan 0197)', () => {
    const append = (event: unknown) =>
      validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        userId: 'u1',
        walkId: 'w1',
        id: 'e1',
        baseSeq: 0,
        kind: 'stopped',
        at: '2026-10-08T11:00:00.000Z',
        logFrom: 0,
        logTo: 10,
        reason: 'frame-moved',
        events: [event],
      }).valid;
    const guard = { type: 'guard', logMs: 5 };

    expect(SHOP_WALK_GUARD_KINDS).toEqual([
      'lost',
      'jump',
      'turned',
      'heading',
      'compass-disturbed',
      'compass-settled',
    ]);
    for (const what of SHOP_WALK_GUARD_KINDS) {
      expect({ what, valid: append({ ...guard, what }) }).toEqual({
        what,
        valid: true,
      });
    }
    expect(append({ ...guard, what: 'turned', degrees: 158.4 })).toBe(true);
    expect(append({ ...guard, what: 'jump', metres: 3.4 })).toBe(true);

    expect(append({ ...guard, what: 'frame-moved' })).toBe(false);
    expect(append(guard)).toBe(false);
    expect(append({ type: 'guard', what: 'lost' })).toBe(false);
    expect(append({ ...guard, what: 'turned', degrees: '158' })).toBe(false);
    // No raw sensor sample rides along.
    expect(append({ ...guard, what: 'heading', samples: [1, 2] })).toBe(false);
  });

  it('refuses an event of no known type and an unknown kind', () => {
    const base = {
      userId: 'u1',
      walkId: 'w1',
      id: 'e1',
      baseSeq: 0,
      kind: 'started',
      at: '2026-09-29T11:00:00.000Z',
      logFrom: 0,
      logTo: 10,
      events: [],
    };
    expect(validateMessageRequest(SHOP_WALK_PATTERNS.append, base).valid).toBe(
      true
    );
    expect(
      validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        ...base,
        kind: 'continued',
      }).valid
    ).toBe(true);
    expect(
      validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        ...base,
        kind: 'paused',
      }).valid
    ).toBe(false);
    expect(
      validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        ...base,
        events: [{ type: 'teleport', to: [0, 0] }],
      }).valid
    ).toBe(false);
    expect(
      validateMessageRequest(SHOP_WALK_PATTERNS.append, {
        ...base,
        events: [{ type: 'path', points: [[1, 2]] }],
      }).valid
    ).toBe(false);
  });
});
