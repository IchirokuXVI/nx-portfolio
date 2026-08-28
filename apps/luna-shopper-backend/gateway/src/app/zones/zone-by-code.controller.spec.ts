import { ZONE_PATTERNS } from '@portfolio/luna-shopper/contracts';
import { THROTTLE_LIMITS } from '@portfolio/luna-shopper/platform';
import { ZoneController } from './zone.controller';

/**
 * `@Throttle` writes one metadata key per named bucket, suffixed with the
 * bucket's name. The key prefixes are spelled out because the library stopped
 * exporting its `THROTTLER_LIMIT` / `THROTTLER_TTL` constants; if a version bump
 * ever renames them this test fails, which is the right way round.
 */
const BUCKET = 'default';
const LIMIT_KEY = `THROTTLER:LIMIT${BUCKET}`;
const TTL_KEY = `THROTTLER:TTL${BUCKET}`;

/**
 * The join code preview route (plan 0024, section 1), at the two seams that are
 * the whole of the gateway's job here: which throttler bucket guards it, and
 * where it sits relative to the parameter route that could swallow it.
 *
 * Both are decorator metadata rather than behaviour, so they are read off the
 * class. What the route answers is core's business and is proven there.
 */
function build() {
  const send = jest.fn(async () => ({ name: 'Flat 3B', memberCount: 4 }));
  return { controller: new ZoneController({ send } as never), send };
}

/** The route paths Nest will register, in declaration order. */
function declaredPaths(): string[] {
  const proto = ZoneController.prototype as unknown as Record<string, unknown>;
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor')
    .map((name) => Reflect.getMetadata('path', proto[name] as object))
    .filter((path): path is string => typeof path === 'string');
}

describe('GET /v1/zones/by-code/:code', () => {
  it('asks core to resolve the code, and passes nothing else', async () => {
    const { controller, send } = build();

    const view = await controller.getByCode('ABCD1234');

    expect(send).toHaveBeenCalledWith(ZONE_PATTERNS.getByCode, {
      joinCode: 'ABCD1234',
    });
    expect(view).toEqual({ name: 'Flat 3B', memberCount: 4 });
  });

  it('is not given a userId, because it has no caller to authorize', async () => {
    const { controller, send } = build();

    await controller.getByCode('ABCD1234');

    expect(Object.keys(send.mock.calls[0][1])).toEqual(['joinCode']);
  });

  it('carries the join code bucket, not the default one', () => {
    // An unauthenticated lookup leaves no membership row and nothing for an
    // owner to notice, so it is a cheaper enumeration oracle than joining and
    // must not be given a looser limit than the join route (section 1.4).
    const handler = ZoneController.prototype.getByCode;
    const bucket = THROTTLE_LIMITS.joinCode[BUCKET];

    expect(Reflect.getMetadata(LIMIT_KEY, handler)).toBe(bucket.limit);
    expect(Reflect.getMetadata(TTL_KEY, handler)).toBe(bucket.ttl);
    // Five per thirty seconds, the bucket that exists for enumeration
    // protection; a looser one here is the thing section 1.4 warns about.
    expect(bucket.limit).toBe(5);
  });

  it('is declared above the parameter route that would swallow it', () => {
    // This pair would not actually collide, since `by-code/:code` has two
    // segments; the file's convention is what is being held (section 1.3), so a
    // future single segment sibling does not break silently.
    const paths = declaredPaths();

    expect(paths.indexOf('by-code/:code')).toBeGreaterThan(-1);
    expect(paths.indexOf('by-code/:code')).toBeLessThan(paths.indexOf(':id'));
  });
});
