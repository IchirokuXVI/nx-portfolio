import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import type {
  AliasQuery,
  EntryQuery,
  HarvestServiceI,
  ItemRefQuery,
  PageQuery,
  PlaceGroupQuery,
  PlaceQuery,
  RunQuery,
  ShopQuery,
} from './harvest-service';

/** Everything under `/v1/admin/harvest`, which is where all of it already is. */
const ROOT = '/v1/admin/harvest';

/**
 * The harvester's REST surface, as the screens call it (plan 0006, section 1).
 *
 * Every route this file names exists today and needed nothing from the backend
 * beyond `0073`'s guard swap. There is no `ResourceApiGateways` underneath it:
 * these routes do not follow the collection and member convention that class
 * encodes. A run is aborted with a POST to a sub path, a source is addressed by
 * its supermarket rather than by its own id, and entries live under the chain
 * they came from.
 *
 * Every failure leaves here as a {@link GatewayError}, so no screen above ever
 * sees an `HttpErrorResponse` or switches on a status number. That matters more
 * here than elsewhere: the harvester is absent in both clusters on purpose, so a
 * failed read is an ordinary state these screens draw rather than an exception
 * that escapes.
 *
 * Provided by the app layer and never at root, because it depends on the
 * `HttpClient` carrying the bearer token.
 */
@Injectable()
export class HarvestApi implements HarvestServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  spawnRun(
    input: Wire.SpawnHarvestRunDto
  ): Promise<Wire.HarvestHarvestRunView> {
    return this._send('post', `${ROOT}/runs`, { body: input });
  }

  listRuns(query: RunQuery): Promise<Wire.HarvestHarvestRunPage> {
    return this._send('get', `${ROOT}/runs`, { params: toParams(query) });
  }

  readRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    return this._send('get', `${ROOT}/runs/${segment(id)}`);
  }

  abortRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    return this._send('post', `${ROOT}/runs/${segment(id)}/abort`, {
      body: {},
    });
  }

  listPlaces(query: PlaceQuery): Promise<Wire.HarvestDiscoveredPlacePage> {
    return this._send('get', `${ROOT}/places`, { params: toParams(query) });
  }

  placeGroups(
    query: PlaceGroupQuery
  ): Promise<Wire.HarvestDiscoveredPlaceGroupsResult> {
    return this._send('get', `${ROOT}/places/groups`, {
      params: toParams(query),
    });
  }

  importPlace(
    id: string,
    input: Wire.ImportDiscoveredPlaceDto
  ): Promise<Wire.HarvestDiscoveredPlaceView> {
    return this._send('post', `${ROOT}/places/${segment(id)}/import`, {
      body: input,
    });
  }

  rejectPlace(id: string): Promise<Wire.HarvestDiscoveredPlaceView> {
    return this._send('post', `${ROOT}/places/${segment(id)}/reject`, {
      body: {},
    });
  }

  /**
   * Entries are addressed under their chain, not under a flat collection.
   *
   * `supermarketId` is a path segment rather than a filter, which is why this
   * screen asks which chain before it can ask anything else. Plan 0006 section 1
   * lists `GET .../entries` alongside `groups`, `import` and `reject`, but those
   * three belong to `places`: there is no grouping route for entries and no way
   * to reject one, so this queue offers the two things that exist.
   */
  listEntries(query: EntryQuery): Promise<Wire.HarvestSourceCatalogEntryPage> {
    const { supermarketId, ...rest } = query;
    return this._send(
      'get',
      `${ROOT}/supermarkets/${segment(supermarketId)}/entries`,
      { params: toParams(rest) }
    );
  }

  createItemFromEntry(
    supermarketId: string,
    entryId: string,
    input: Wire.CreateItemFromEntryDto
  ): Promise<Wire.CatalogItemView> {
    return this._send(
      'post',
      `${ROOT}/supermarkets/${segment(supermarketId)}/entries/${segment(
        entryId
      )}/item`,
      { body: input }
    );
  }

  listItemRefs(query: ItemRefQuery): Promise<Wire.HarvestItemSourceRefPage> {
    return this._send('get', `${ROOT}/item-refs`, { params: toParams(query) });
  }

  listUnresolvedItemRefs(
    query: ItemRefQuery
  ): Promise<Wire.HarvestItemSourceRefPage> {
    return this._send('get', `${ROOT}/item-refs/unresolved`, {
      params: toParams(query),
    });
  }

  setManualItemRef(
    input: Wire.SetManualItemSourceRefDto
  ): Promise<Wire.HarvestItemSourceRefView> {
    return this._send('put', `${ROOT}/item-refs`, { body: input });
  }

  confirmItemRef(id: string): Promise<Wire.HarvestItemSourceRefView> {
    return this._send('post', `${ROOT}/item-refs/${segment(id)}/confirm`, {
      body: {},
    });
  }

  rejectItemRef(id: string): Promise<Wire.HarvestItemSourceRefView> {
    return this._send('post', `${ROOT}/item-refs/${segment(id)}/reject`, {
      body: {},
    });
  }

  /**
   * A leaflet, uploaded (backend plan 0081, section 7).
   *
   * A plain JSON body, and deliberately not multipart: the extractor produces
   * JSON, the schema validates JSON, and a form part around it would add a
   * parse step for nothing. This is the one route in the gateway with a body
   * limit of its own, because the default parser refuses 100 KB and a real
   * leaflet is three times that.
   */
  importLeaflet(
    input: Wire.ImportLeafletDto
  ): Promise<Wire.HarvestHarvestRunView> {
    return this._send('post', `${ROOT}/leaflets`, { body: input });
  }

  /**
   * One chain's queued printed names (backend plan 0081, section 2).
   *
   * Under the chain in the path, like the entries queue and unlike the shops
   * one, because that is where the gateway declares it. So `supermarketId` is
   * pulled out of the query rather than sent as a filter: sending it as well
   * would be a property the DTO does not declare, and the validation pipe
   * refuses the whole request over one.
   */
  listAliases(query: AliasQuery): Promise<Wire.HarvestSourceAliasPage> {
    const { supermarketId, ...rest } = query;
    return this._send(
      'get',
      `${ROOT}/supermarkets/${segment(supermarketId)}/aliases`,
      { params: toParams(rest) }
    );
  }

  /**
   * Bind a printed name to a product, which is what writes the price.
   *
   * The three decisions are addressed by the alias rather than by the chain: an
   * alias id is unique and an operator acting on a row has it. Accepting is not
   * only a binding: the run that queued this row is over and its offer sits in
   * the run's stored document, so the harvester writes the price it was queued
   * for and answers how many rows it wrote.
   */
  acceptAlias(
    id: string,
    input: Wire.AcceptSourceAliasDto
  ): Promise<Wire.HarvestSourceAliasAcceptResult> {
    return this._send('post', `${ROOT}/aliases/${segment(id)}/accept`, {
      body: input,
    });
  }

  /**
   * The same, for a product the catalog does not hold yet.
   *
   * **One call**, the way `entries/:entryId/item` is one call: it creates the
   * item and binds the alias in the harvester. Two calls would leave a window
   * where an item exists that nothing points at, and the operator would have no
   * way to tell that from a queue row they had not decided.
   */
  createItemFromAlias(
    id: string,
    input: Wire.CreateItemFromAliasDto
  ): Promise<Wire.HarvestSourceAliasAcceptResult> {
    return this._send('post', `${ROOT}/aliases/${segment(id)}/item`, {
      body: input,
    });
  }

  /**
   * Not a product he tracks.
   *
   * The row stays as `REJECTED` rather than being deleted, so the next leaflet
   * that prints the string skips it with a warning instead of asking again. The
   * status is the owner's, and a run does not get to overwrite a decision.
   */
  rejectAlias(id: string): Promise<Wire.HarvestSourceAliasView> {
    return this._send('post', `${ROOT}/aliases/${segment(id)}/reject`, {
      body: {},
    });
  }

  /**
   * The shops a source names, for one chain (backend plan 0084, section 7).
   *
   * `shops` rather than `source-locations`, which is what the gateway calls the
   * path. The rows are the source's shops and the mapping is what turns one of
   * them into one of ours.
   */
  listShops(query: ShopQuery): Promise<Wire.HarvestSourceLocationPage> {
    return this._send('get', `${ROOT}/shops`, { params: toParams(query) });
  }

  mapShop(
    id: string,
    input: Wire.MapSourceLocationDto
  ): Promise<Wire.HarvestSourceLocationView> {
    return this._send('put', `${ROOT}/shops/${segment(id)}/location`, {
      body: input,
    });
  }

  /**
   * Back to `UNMAPPED`, leaving what was already written alone.
   *
   * A `DELETE` on the binding rather than a `POST` to a verb, because unmapping
   * removes the one thing mapping added. It is the only route in this file that
   * is one.
   */
  unmapShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    return this._send('delete', `${ROOT}/shops/${segment(id)}/location`);
  }

  ignoreShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    return this._send('post', `${ROOT}/shops/${segment(id)}/ignore`, {
      body: {},
    });
  }

  unignoreShop(id: string): Promise<Wire.HarvestSourceLocationView> {
    return this._send('post', `${ROOT}/shops/${segment(id)}/unignore`, {
      body: {},
    });
  }

  listSources(query: PageQuery): Promise<Wire.HarvestSupermarketSourcePage> {
    return this._send('get', `${ROOT}/sources`, { params: toParams(query) });
  }

  readSource(
    supermarketId: string
  ): Promise<Wire.HarvestSupermarketSourceView> {
    return this._send('get', `${ROOT}/sources/${segment(supermarketId)}`);
  }

  upsertSource(
    supermarketId: string,
    input: Wire.UpsertSupermarketSourceDto
  ): Promise<Wire.HarvestSupermarketSourceView> {
    return this._send('put', `${ROOT}/sources/${segment(supermarketId)}`, {
      body: input,
    });
  }

  /**
   * The one switch of section 3 this app is allowed to change.
   *
   * Per chain, and therefore application state rather than deployment
   * configuration. `upsert` describes a chain and this starts fetching it, which
   * the backend keeps as two routes because they are two decisions.
   */
  setSourceEnabled(
    supermarketId: string,
    enabled: boolean
  ): Promise<Wire.HarvestSupermarketSourceView> {
    return this._send(
      'put',
      `${ROOT}/sources/${segment(supermarketId)}/enabled`,
      { body: { enabled } }
    );
  }

  private async _send<R>(
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    options: { params?: HttpParams; body?: unknown } = {}
  ): Promise<R> {
    try {
      return await firstValueFrom(
        this._http.request<R>(method, this._urls.gateway(path), {
          params: options.params,
          body: options.body,
        })
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

/**
 * A query object as a query string, with absent and empty values left out.
 *
 * An empty filter has to disappear rather than be sent as `''`, because the
 * harvester's DTOs validate what they are given: `status=` is not a status, and
 * a screen whose filter is set to "any" would fail every read.
 */
function toParams(query: object): HttpParams {
  let params = new HttpParams();

  // `object` rather than `Record<string, unknown>`, because an interface with
  // named properties has no index signature and so does not satisfy the record
  // type. Every caller passes one of the query interfaces above, which are all
  // flat bags of optional scalars.
  for (const [name, value] of Object.entries(
    query as Record<string, unknown>
  )) {
    if (value === undefined || value === null || value === '') {
      continue;
    }
    params = params.set(name, String(value));
  }

  return params;
}
