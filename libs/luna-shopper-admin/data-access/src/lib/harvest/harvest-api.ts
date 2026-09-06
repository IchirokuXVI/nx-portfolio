import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import type {
  AcceptSourceEntryInput,
  CreateItemFromSourceEntryInput,
  EntryQuery,
  HarvestServiceI,
  ImportHarvestDocumentInput,
  PageQuery,
  PlaceGroupQuery,
  PlaceQuery,
  RunQuery,
  ShopQuery,
  SourceEntryAcceptResult,
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

  /**
   * Take back what the run wrote (backend plan 0082).
   *
   * A POST to a sub path, like the abort above it, because it is an act on the
   * run rather than an edit of it. It is not a `DELETE` on the run: the run row
   * survives and gains `revertedAt`, and it is the prices elsewhere that go.
   */
  revertRun(id: string): Promise<Wire.HarvestHarvestRunView> {
    return this._send('post', `${ROOT}/runs/${segment(id)}/revert`, {
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
   * The one queue, over one flat collection (backend plan 0086, section 10).
   *
   * `GET /entries` with the chain as a filter, where it used to be
   * `GET /supermarkets/{id}/entries` with the chain as a path segment. The three
   * decisions below are addressed by the row's own id, which is unique and which
   * an operator acting on a row has, so none of them names the chain twice.
   */
  listEntries(query: EntryQuery): Promise<Wire.HarvestSourceCatalogEntryPage> {
    return this._send('get', `${ROOT}/entries`, { params: toParams(query) });
  }

  acceptEntry(
    id: string,
    input: AcceptSourceEntryInput
  ): Promise<SourceEntryAcceptResult> {
    return this._send('post', `${ROOT}/entries/${segment(id)}/accept`, {
      body: input,
    });
  }

  createItemFromEntry(
    id: string,
    input: CreateItemFromSourceEntryInput
  ): Promise<SourceEntryAcceptResult> {
    return this._send('post', `${ROOT}/entries/${segment(id)}/item`, {
      body: input,
    });
  }

  rejectEntry(id: string): Promise<Wire.HarvestSourceCatalogEntryView> {
    return this._send('post', `${ROOT}/entries/${segment(id)}/reject`, {
      body: {},
    });
  }

  /**
   * A harvest document, uploaded (backend plan 0086, section 6.2).
   *
   * A plain JSON body, and deliberately not multipart: the producer emits JSON,
   * the schema validates JSON, and a form part around it would add a parse step
   * for nothing. This is the one route in the gateway with a body limit of its
   * own, raised again by `0086` because a re-imported catalog walk is four
   * thousand products rather than a leaflet's two hundred.
   */
  importDocument(
    input: ImportHarvestDocumentInput
  ): Promise<Wire.HarvestHarvestRunView> {
    return this._send('post', `${ROOT}/imports`, { body: input });
  }

  /**
   * A finished run's rows, as a document (backend plan 0086, section 6.2).
   *
   * Read as JSON rather than as a blob, and turned into a file by the screen.
   * The request carries the bearer token, so it cannot be a plain link an anchor
   * follows, and the file's name is the chain, the scope and the day, which the
   * screen resolves through the directory and the document does not spell out.
   */
  exportRun(id: string): Promise<Readonly<Record<string, unknown>>> {
    return this._send('get', `${ROOT}/runs/${segment(id)}/export`);
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
