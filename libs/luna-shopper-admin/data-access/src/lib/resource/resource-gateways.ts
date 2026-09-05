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
  /**
   * The gateway path, such as `/v1/admin/catalog/supermarkets`.
   *
   * Where one row lives. It is also where the collection lives, unless
   * {@link collectionPath} says otherwise.
   */
  readonly path: string;
  /**
   * Where the collection lives, when it is somewhere else.
   *
   * `/v1/admin/catalog/**` is not uniform CRUD, and one resource is split in
   * two: a chain's shops are listed and created at
   * `/supermarkets/{id}/locations`, and read, changed and deleted at
   * `/locations/{id}`. So the collection is a function of the values that
   * identify it, which are the filters on a list and the submitted fields on a
   * create.
   *
   * `null` means the collection cannot be addressed yet, because the value
   * naming it has not been given. The list answers an empty page rather than
   * asking the gateway for a URL with a hole in it, and the screen says which
   * filter is missing (see `ResourceDescriptor.requires`).
   */
  collectionPath?(values: Readonly<Record<string, unknown>>): string | null;
  /**
   * Where **one row** lives, when it is not `path/{id}`.
   *
   * A chain's shop is read at `/locations/{id}`, so a collection that hangs off
   * a parent does not imply a member that does. A membership and a list line do
   * imply one: the gateway has `PATCH /v1/admin/zones/{zoneId}/members/{id}` and
   * no flat route at all, so the parent has to be in the member URL as well as
   * in the collection's.
   *
   * The argument is the row's address, which for these resources is the
   * composite {@link key} `(parent, own id)`, so the function splits it with
   * `compositeParts` and puts both halves back in the path. `null` means the
   * address does not read, which is a not found rather than a guess.
   */
  memberPath?(id: string): string | null;
  /**
   * The names {@link collectionPath} consumes.
   *
   * They are part of the URL, so they are **not** also sent as a query
   * parameter or in a body. The create DTO does not declare `supermarketId`,
   * and the validation pipe refuses a property a DTO does not declare, so
   * sending it as well as putting it in the path would turn every create into a
   * 400.
   *
   * They are also **put back on every row that comes out**, because a nested
   * collection does not repeat what its URL already said: a membership arrives
   * with no `zoneId` on it, and its only address afterwards is the pair
   * `(zoneId, membershipId)`. A value the row already carries is left alone, so
   * a shop keeps the `supermarketId` the server sent.
   */
  readonly pathParams?: readonly string[];
  /**
   * The columns one row is keyed on, when its own id cannot address it.
   *
   * A price is unique on `(itemId, priceScopeId)` and there is no route that
   * reads one by its uuid. Naming the key here is what lets `read` find the row
   * by listing the collection with those two as filters, which is one request
   * and an exact answer.
   */
  readonly key?: readonly string[];
  /**
   * Which of the {@link key}'s columns the collection accepts as a filter.
   *
   * Not all of them, and the difference decides whether a read is one request
   * or a walk. The price list takes both `itemId` and `priceScopeId`, so a
   * price is found exactly. The location item list takes only
   * `supermarketLocationId`, so that shop's rows are fetched and the product is
   * found among them.
   *
   * Sending a parameter the route does not declare is not merely useless: the
   * validation pipe refuses the whole request. So this is stated rather than
   * assumed to be the key. Absent means the whole key.
   */
  readonly keyFilters?: readonly string[];
  /**
   * Whether a create and an update are both a `PUT` to the collection.
   *
   * Two catalog resources are upserts rather than a `POST` and a `PATCH`, and
   * the body carries the key. The upsert **merges**: catalog writes only the
   * properties the request names, so sending what changed is as safe here as it
   * is on a `PATCH` and does not blank the columns left out.
   */
  readonly upsert?: boolean;
  /**
   * Whether one row is read by walking the collection.
   *
   * `GET /v1/admin/catalog/price-scopes/{id}` does not exist. A member is found
   * by reading the collection, and with {@link key} it is found in one request
   * because the key doubles as the collection's filters.
   */
  readonly readVia?: 'member' | 'collection';
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
