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

  /**
   * The collection's URL, when it is addressed under a parent.
   *
   * A chain's shops live at `/supermarkets/{id}/locations` while one shop lives
   * at `/locations/{id}`, so the collection and the member are two different
   * paths and only the first depends on a filter. Given the filter values, this
   * answers the collection's path; {@link path} stays the member's.
   *
   * The in-memory gateway ignores it, which is right: there are no URLs there,
   * and the parent reaches it as an ordinary filter it can match on.
   */
  collectionPath?(scope: Readonly<Record<string, string>>): string;

  /**
   * Filter names {@link collectionPath} consumes, so they are not also sent as
   * query parameters.
   *
   * `supermarketId` is a path segment on the shops route and not a parameter it
   * declares, and the gateway validates its query with `forbidNonWhitelisted`,
   * so sending it both ways is a 400 rather than a harmless repetition.
   */
  readonly pathFilters?: readonly string[];

  /**
   * Whether a write is a `PUT` to the collection rather than a `POST` and a
   * `PATCH`.
   *
   * Prices and aisle positions are both written this way, because the row is
   * keyed on what the body carries rather than on a path segment: writing one
   * is the same act whether or not it already exists, and the gateway offers no
   * other verb for it.
   */
  readonly upsert?: boolean;

  /**
   * The properties that address a row, when no member route reads one.
   *
   * Three catalog resources need it. A price and an aisle position are keyed on
   * a pair the body carries and answer with an `id` they accept nowhere; a price
   * scope has an ordinary id and simply has no `GET` for it. In all three cases
   * the row is found by reading the collection and matching on these fields.
   *
   * The descriptor's `identify` is what puts the same key in the URL, and the
   * two have to agree: this states how the gateway takes a key apart and that
   * states how a screen puts one together.
   */
  readonly key?: readonly string[];

  /**
   * Which of {@link key} the list route accepts as filters.
   *
   * Every one of them unless stated, which is the case that costs one request.
   * Where the route filters on fewer, the rest are matched here: one shop's
   * aisle positions can be asked for by shop and not by product, so the shop
   * narrows the read and the product is found within it.
   *
   * An empty list means the collection is read whole. That is the price scopes'
   * case, and it is affordable because scopes are few: one per chain, or one
   * per warehouse, or one per shop.
   */
  readonly keyFilters?: readonly string[];
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
