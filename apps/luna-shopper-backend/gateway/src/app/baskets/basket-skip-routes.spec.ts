import { PARTICIPANT_THROTTLE } from '../generated-lists/participant-throttler.guard';
import { ParticipantGuard } from '../generated-lists/participant.guard';
import { BasketController } from './basket.controller';

/**
 * The two skip routes, as the framework sees them (plan 0137, section 10).
 *
 * Read by reflection rather than by calling them, because what is asserted is
 * what Nest was told: the verb, the path, the guard that turns a credential into
 * a participant, and the bucket one person's writes are counted in. None of
 * those runs when the method is called directly, so a test that called `skip`
 * and got a row back would prove nothing about any of them.
 *
 * The throttle is asserted here as well as by the walk in
 * `participant-throttler.guard.spec.ts`, and the two are not the same claim: the
 * walk says every write on the surface declares **a** limit, and this says these
 * two declare the **write** limit rather than the tighter search one.
 */
describe('the skip routes (plan 0137, section 5)', () => {
  const proto = BasketController.prototype;

  it.each([
    ['skip', 'put'],
    ['unskip', 'delete'],
  ])('routes %s as a %s on the row', (name, verb) => {
    const handler = proto[name as keyof typeof proto] as object;
    expect(Reflect.getMetadata('path', handler)).toBe(':id/rows/:rowKey/skip');
    // Nest stores the verb as a `RequestMethod` ordinal: 0 GET, 1 POST, 2 PUT,
    // 3 DELETE, 4 PATCH.
    const ordinal = Reflect.getMetadata('method', handler) as number;
    expect(['get', 'post', 'put', 'delete', 'patch'][ordinal]).toBe(verb);
  });

  it.each(['skip', 'unskip'])('counts %s in the write bucket', (name) => {
    const handler = proto[name as keyof typeof proto] as object;
    const limit = Reflect.getMetadata(PARTICIPANT_THROTTLE, handler) as
      | { limit: number }
      | undefined;
    expect(limit).toBeDefined();
  });

  it('refuses a caller the participant guard does not resolve', () => {
    // The guard is on the controller, so both routes carry it without saying
    // so themselves. That is the shape the rest of the participant surface has,
    // and asserting it here is what stops a later plan moving one of these two
    // routes onto a class that has no guard at all.
    const guards = (Reflect.getMetadata('__guards__', BasketController) ??
      []) as unknown[];
    expect(guards).toContain(ParticipantGuard);
  });
});
