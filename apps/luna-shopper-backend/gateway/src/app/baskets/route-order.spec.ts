import { RequestMethod } from '@nestjs/common';
import {
  METHOD_METADATA,
  MODULE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { GatewayBasketsModule } from './baskets.module';

/**
 * The order the basket controllers register in is a routing rule (plan 0144,
 * section 7, test 2).
 *
 * Nest registers routes in controller order and then in method order inside each
 * controller, and the **first** match runs. So every literal segment has to be
 * registered before the parameter that would swallow it: `live` and `shared`
 * before `:id`, and `participants/mine` before `participants/:participantId`.
 *
 * It is asserted here rather than left to the comments on the module because
 * plan 0144 merged two modules into one, and merging two lists of controllers is
 * exactly how such an order is lost. Nothing else in the suite would notice: a
 * swallowed route still answers, with the wrong handler, the wrong guard and a
 * core lookup for a basket called `shared`.
 *
 * It reads the metadata Nest itself reads, rather than booting the application,
 * so it runs under `nx test` and therefore in CI, which never runs the
 * integration target.
 */
describe('the basket routes register in an order that is a rule', () => {
  /** Every route of the module, in the order Nest will register them. */
  const routes = (
    Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, GatewayBasketsModule) ?? []
  ).flatMap((controller: NonNullable<unknown>) => {
    const base = Reflect.getMetadata(PATH_METADATA, controller) ?? '';
    const proto = (controller as { prototype: object }).prototype;
    return Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor')
      .filter((name) =>
        Reflect.hasMetadata(PATH_METADATA, (proto as never)[name])
      )
      .map((name) => {
        const handler = (proto as never)[name];
        const path = Reflect.getMetadata(PATH_METADATA, handler) ?? '';
        const method: RequestMethod = Reflect.getMetadata(
          METHOD_METADATA,
          handler
        );
        return {
          method: RequestMethod[method],
          path: `${base}/${path}`.replace(/\/+$/, '').replace(/\/{2,}/g, '/'),
          handler: name,
        };
      });
  });

  /** Where a route sits in the registration order, or -1. */
  const at = (method: string, path: string): number =>
    routes.findIndex((r) => r.method === method && r.path === path);

  it.each([
    ['GET', 'baskets/live', 'baskets/:id'],
    ['GET', 'baskets/live/summary', 'baskets/:id'],
    ['GET', 'baskets/shared', 'baskets/:id'],
    // Only the delete pair competes: there is no `GET :id/participants/:id`,
    // so the owner's read of one participant cannot swallow `mine`.
    [
      'DELETE',
      'baskets/:id/participants/mine',
      'baskets/:id/participants/:participantId',
    ],
  ])('registers %s %s before %s', (method, literal, parameter) => {
    const first = at(method, literal);
    const second = at(method, parameter);

    // Both have to exist, or the assertion below passes for the wrong reason:
    // a renamed path that matches neither would leave two -1s.
    expect(first).toBeGreaterThanOrEqual(0);
    expect(second).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(second);
  });

  it('registers no route under the old name', () => {
    expect(routes.filter((r) => /generated/i.test(r.path))).toEqual([]);
  });
});
