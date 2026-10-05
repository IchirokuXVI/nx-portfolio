import { inject } from '@angular/core';
import { Router, type RedirectFunction, type UrlTree } from '@angular/router';
import { ResourceRegistry } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  COMPOSITE_ID_SEPARATOR,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { LIST_PARAM, ZONE_PARAM } from './shopper-params';

/**
 * Where an address that is no screen of its own goes (admin plan 0045).
 *
 * Every target is asked of the registry, so a redirect cannot point at an
 * address the route table does not have. A row that cannot be read lands on
 * the list above it, which is the closest place that is certain to exist.
 */

/** A path the registry answered, as a tree, or the fallback when it did not. */
function tree(path: readonly string[] | null, fallback: UrlTree): UrlTree {
  return path === null ? fallback : inject(Router).createUrlTree([...path]);
}

/** The people, which is where the section opens. */
export function peopleTree(): UrlTree {
  const path = inject(ResourceRegistry).pathOf('users') ?? ['/'];
  return inject(Router).createUrlTree([...path]);
}

/** The zones. */
export function zonesTree(): UrlTree {
  const path = inject(ResourceRegistry).pathOf('zones') ?? ['/'];
  return inject(Router).createUrlTree([...path]);
}

/** One row of a resource, read through its own gateway, or `null`. */
async function readRow(
  registry: ResourceRegistry,
  resource: string,
  id: unknown
): Promise<ResourceRow | null> {
  const descriptor = registry.byName(resource);
  if (descriptor === undefined || typeof id !== 'string' || id === '') {
    return null;
  }

  try {
    return await registry.gatewayFor(descriptor).read(id);
  } catch {
    return null;
  }
}

/**
 * One shopping list. It lives under the person who owns it, and an address
 * that names the shopping list alone does not say who that is, so the row is
 * read to find out. One that cannot be read lands on the people.
 *
 * Two addresses come here: the old `/shoppers/shopping-lists/{id}`, and a row
 * of a zone's Shopping lists tab.
 */
export const toBasket: RedirectFunction = async ({ params }) => {
  const registry = inject(ResourceRegistry);
  const router = inject(Router);
  const fallback = peopleTree();
  const id: unknown = params['id'];

  const basket = await readRow(registry, 'baskets', id);
  if (basket === null || typeof id !== 'string') {
    return fallback;
  }

  const path = registry.rowPath('baskets', id, basket);
  return path === null ? fallback : router.createUrlTree([...path]);
};

/**
 * One list, under its zone. The old address named the list alone, so the list
 * is read to find which zone that is. One that cannot be read lands on the
 * zones.
 */
export const toList: RedirectFunction = ({ params }) => listTree(params['id']);

/**
 * The list a line is on. The old address of a line was the pair of the list
 * and the line, and the line is drawn on its list's page.
 */
export const toListOfOldLine: RedirectFunction = ({ params }) => {
  const id: unknown = params['id'];
  return listTree(
    typeof id === 'string' ? id.split(COMPOSITE_ID_SEPARATOR)[0] : null
  );
};

async function listTree(id: unknown): Promise<UrlTree> {
  const registry = inject(ResourceRegistry);
  const router = inject(Router);
  const fallback = zonesTree();

  const list = await readRow(registry, 'lists', id);
  if (list === null || typeof id !== 'string') {
    return fallback;
  }

  const path = registry.rowPath('lists', id, list);
  return path === null ? fallback : router.createUrlTree([...path]);
}

/**
 * The list a line's form goes back to.
 *
 * `/shoppers/zones/{zoneId}/lists/{listId}/lines` is no screen: the lines are
 * drawn on the list's own page. Both ids are in the address, so nothing is
 * read.
 */
export const toListOfLine: RedirectFunction = ({ params }) => {
  const registry = inject(ResourceRegistry);
  const zoneId: unknown = params[ZONE_PARAM];
  const listId: unknown = params[LIST_PARAM];

  return tree(
    typeof zoneId === 'string' && typeof listId === 'string'
      ? registry.rowPath('lists', listId, { zoneId })
      : null,
    zonesTree()
  );
};
