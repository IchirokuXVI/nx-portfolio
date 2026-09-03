import { inject } from '@angular/core';
import type {
  ResourceGateway,
  ResourcePage,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { ResourceMemoryGateways } from './resource-memory';

/**
 * Where a resource's rows come from.
 *
 * A descriptor states this and gets its four functions back, rather than
 * writing an HTTP client per entity. Fifteen entities that each hand rolled a
 * `list` would be fifteen chances to disagree about what a cursor is.
 */
export interface ResourceSource<T extends ResourceRow = ResourceRow> {
  /** The gateway path, such as `/v1/admin/catalog/supermarkets`. */
  readonly path: string;
  /** How many rows a page asks for. The backend clamps it either way. */
  readonly pageSize?: number;
  /**
   * The property holding a row's id. `id` unless stated.
   *
   * The same answer the descriptor gives, repeated here because the in-memory
   * table has to find a row by it and knows nothing about descriptors. A user
   * is keyed by `userId` and an admin by `adminId`, so this is not a corner
   * case.
   */
  readonly idField?: string;
  /**
   * How to read a page out of the body, when it is not `{ items, nextCursor }`.
   *
   * Every collection under `/v1/admin/**` answers with that shape but one:
   * `GET /v1/admin/admins` returns `{ admins }` and no cursor, because there
   * are a handful of admins and paging them would be a ceremony. One function
   * here is cheaper than a second gateway implementation for one route.
   */
  page?(body: unknown): ResourcePage<T>;
  /**
   * Rows to answer with when there is no backend.
   *
   * Every data domain in this workspace ships an in-memory implementation so
   * that the app runs and every spec passes with nothing listening. One seed per
   * descriptor is how a resource gets one without a second class per entity.
   */
  readonly seed?: readonly T[];
}

/** Builds the gateway for one resource. */
export interface ResourceGatewaysI {
  for<T extends ResourceRow>(source: ResourceSource<T>): ResourceGateway<T>;
}

/**
 * Inject THIS token, never a concrete class.
 *
 * The default is the in-memory one, so a spec and a run with no backend work
 * with no configuration at all. `app-providers.ts` binds the HTTP
 * implementation, beside the `HttpClient` it depends on.
 */
export const RESOURCE_GATEWAYS = serviceToken<ResourceGatewaysI>(
  'RESOURCE_GATEWAYS',
  () => inject(ResourceMemoryGateways)
);
