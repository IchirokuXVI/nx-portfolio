import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  compositeIdOf,
  compositeParts,
  type ResourceGateway,
  type ResourceInput,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { notFoundError, toGatewayError } from '../gateway-error';
import type { ResourceGatewaysI, ResourceSource } from './resource-gateways';

/**
 * Every resource, over HTTP, from one implementation (plan 0004, section 1).
 *
 * `/v1/admin/**` is one namespace with one shape (backend plan 0073): a
 * collection answers `{ items, nextCursor }`, a member is addressed by id, a
 * create is a `POST` to the collection and a change is a `PATCH` to the member.
 * Fifteen entities that each wrote that out would be fifteen chances to
 * disagree about what a cursor is.
 *
 * A resource that does not fit writes its own {@link ResourceGateway} and the
 * descriptor names that instead. Nothing here is load bearing for the list and
 * the form, which see only the five functions.
 *
 * Provided by the app layer and never at root: it depends on the `HttpClient`
 * the app configures, which is the one carrying the bearer token.
 */
@Injectable()
export class ResourceApiGateways implements ResourceGatewaysI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  for<T extends ResourceRow>(source: ResourceSource<T>): ResourceGateway<T> {
    return new ResourceApi<T>(this._http, this._urls, source);
  }
}

/**
 * How many pages a walked read is willing to look through.
 *
 * A read that walks the collection only happens where the gateway has no route
 * that reads one row, and with a key it finds the row on the first page because
 * the key is the filter. Without one it really does page, and a bound is what
 * stops a mistyped URL from asking for every price in the catalog one page at a
 * time. Past it the answer is "not found", which is what the screen would say
 * anyway.
 */
const MAX_WALKED_PAGES = 10;

class ResourceApi<T extends ResourceRow> implements ResourceGateway<T> {
  constructor(
    private readonly _http: HttpClient,
    private readonly _urls: ApiUrl,
    private readonly _source: ResourceSource<T>
  ) {}

  async list(query: ResourceQuery): Promise<ResourcePage<T>> {
    const collection = this._collection(query.filters ?? {});
    if (collection === null) {
      // The collection has no address yet, because the filter naming it is
      // unset. An empty page is the honest answer; the screen says which one.
      return { items: [], nextCursor: null };
    }

    const body = await this._send<unknown>('get', collection, {
      params: toParams(query, this._source.pageSize, this._source.pathParams),
    });

    const read = this._source.page;
    return read === undefined ? toPage<T>(body) : read(body);
  }

  async read(id: string): Promise<T> {
    if (this._source.readVia !== 'collection') {
      return this._send<T>('get', this._member(id));
    }

    const found = await this._find(id);
    if (found === null) {
      throw notFoundError();
    }
    return found;
  }

  create(input: ResourceInput): Promise<T> {
    const collection = this._collection(input);
    if (collection === null) {
      throw notFoundError();
    }

    return this._send<T>(
      this._source.upsert === true ? 'put' : 'post',
      collection,
      {
        body: this._body(input),
      }
    );
  }

  update(id: string, input: ResourceInput): Promise<T> {
    if (this._source.upsert !== true) {
      return this._send<T>('patch', this._member(id), {
        body: this._body(input),
      });
    }

    // An upsert is addressed by the key in its body rather than by a path, so
    // the key goes back in. The form left it out on purpose: those columns are
    // what the row *is*, and a form that let them be edited would silently
    // write a second row instead of changing this one.
    const key = this._keyOf(id);
    const collection = this._collection({ ...key, ...input });
    if (collection === null) {
      throw notFoundError();
    }

    return this._send<T>('put', collection, {
      body: { ...key, ...this._body(input) },
    });
  }

  /**
   * Delete a row.
   *
   * A composite address is not what a delete quotes. `DELETE` takes the row's
   * own uuid, which is the one thing that uuid is good for, so a keyed resource
   * is read first and deleted by what came back.
   */
  async remove(id: string): Promise<void> {
    const target =
      this._source.key === undefined
        ? id
        : ownIdOf(await this.read(id), this._source);

    await this._send<unknown>('delete', this._member(target));
  }

  /**
   * The collection's URL, given whatever names it.
   *
   * The filters on a list and the submitted fields on a create, which are the
   * same names either way: a chain's shops are listed under the chain and
   * created under the chain.
   */
  private _collection(
    values: Readonly<Record<string, unknown>>
  ): string | null {
    // Not `?? this._source.path`: a `collectionPath` that answered null would
    // fall straight through it and list at the member path, which is a 404 in
    // place of the sentence the screen meant to draw. The two cases are "no
    // collection path was declared" and "it was, and it has no answer yet".
    const declared = this._source.collectionPath;
    if (declared === undefined) {
      return this._urls.gateway(this._source.path);
    }

    const path = declared(values);
    return path === null ? null : this._urls.gateway(path);
  }

  private _member(id: string): string {
    return this._urls.gateway(`${this._source.path}/${encodeURIComponent(id)}`);
  }

  /** A body with the values the path already carries taken out of it. */
  private _body(input: ResourceInput): ResourceInput {
    const consumed = this._source.pathParams;
    if (consumed === undefined || consumed.length === 0) {
      return input;
    }

    const body: ResourceInput = { ...input };
    for (const name of consumed) {
      delete body[name];
    }
    return body;
  }

  /** A composite address, back as the fields it names. Empty for a plain id. */
  private _keyOf(id: string): Readonly<Record<string, string>> {
    const key = this._source.key;
    return key === undefined ? {} : (compositeParts(id, key) ?? {});
  }

  /**
   * The key, narrowed to the parts the collection will accept as filters.
   *
   * Sending one it does not declare is refused outright rather than ignored, so
   * a read that guessed would fail where a read that asks for less succeeds and
   * scans.
   */
  private _readFilters(id: string): Readonly<Record<string, string>> {
    const key = this._keyOf(id);
    const allowed = this._source.keyFilters;
    if (allowed === undefined) {
      return key;
    }

    return Object.fromEntries(
      Object.entries(key).filter(([name]) => allowed.includes(name))
    );
  }

  /**
   * One row, found by reading the collection.
   *
   * With a key this is one filtered request. Without one it walks, bounded by
   * {@link MAX_WALKED_PAGES}, because a resource with no read route and no key
   * has nothing better available.
   */
  private async _find(id: string): Promise<T | null> {
    const filters = this._readFilters(id);
    let cursor: string | undefined;

    for (let page = 0; page < MAX_WALKED_PAGES; page += 1) {
      const answer = await this.list({ cursor, filters });

      const match = answer.items.find(
        (row) => addressOf(row, this._source) === id
      );
      if (match !== undefined) {
        return match;
      }

      if (answer.nextCursor === null) {
        return null;
      }
      cursor = answer.nextCursor;
    }

    return null;
  }

  /**
   * One request, with every failure arriving as a {@link GatewayError}.
   *
   * The screens above never see an `HttpErrorResponse` and never switch on a
   * status number. The form reads `fieldErrors`; everything else reads `code`.
   */
  private async _send<R>(
    method: 'get' | 'post' | 'put' | 'patch' | 'delete',
    url: string,
    options: { params?: HttpParams; body?: unknown } = {}
  ): Promise<R> {
    try {
      return await firstValueFrom(
        this._http.request<R>(method, url, {
          params: options.params,
          body: options.body,
        })
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

/**
 * A query as the query string the gateway reads.
 *
 * `cursor`, `limit` and `order` are named here rather than generated, and that
 * is worth a line. `PageQueryDto` carries `cursor` and `limit` without an
 * `@ApiPropertyOptional`, so they are absent from the committed OpenAPI
 * document even though every collection route accepts them. The response
 * shapes are generated; this half is written out, and a spec asserts what it
 * sends.
 */
function toParams(
  query: ResourceQuery,
  pageSize: number | undefined,
  pathParams: readonly string[] | undefined
): HttpParams {
  const consumed = new Set(pathParams ?? []);
  let params = new HttpParams();

  if (query.cursor !== undefined && query.cursor !== '') {
    params = params.set('cursor', query.cursor);
  }

  const limit = query.limit ?? pageSize;
  if (limit !== undefined) {
    params = params.set('limit', String(limit));
  }

  if (query.order !== undefined && query.order !== '') {
    params = params.set('order', query.order);
  }

  for (const [name, value] of Object.entries(query.filters ?? {})) {
    // A filter the path already carries is not also a query parameter. The
    // route reads the chain from `/supermarkets/{id}/locations` and its DTO
    // does not declare `supermarketId`, and the validation pipe refuses a
    // property no DTO declares, so sending both would answer 400.
    if (value !== '' && !consumed.has(name)) {
      params = params.set(name, value);
    }
  }

  return params;
}

/**
 * The address a row is reached by: its key where it has one, its id otherwise.
 *
 * The same answer `idOf` gives from a descriptor. The gateway cannot see a
 * descriptor, so the two say it separately and the source repeats the key. A
 * disagreement between them is a row that lists under one address and reads
 * under another, which `resource-api.spec.ts` is what catches.
 */
function addressOf(
  row: ResourceRow,
  source: ResourceSource<ResourceRow>
): string {
  return source.key === undefined
    ? ownIdOf(row, source)
    : compositeIdOf(row, source.key);
}

/** The row's own id, which is what a member URL quotes. */
function ownIdOf(
  row: ResourceRow,
  source: ResourceSource<ResourceRow>
): string {
  const value = row[source.idField ?? 'id'];
  return typeof value === 'string' ? value : '';
}

/**
 * A page body, as a page.
 *
 * The types are generated from the committed contract, so the shape is not in
 * doubt; the two fields the list makes decisions from are normalized anyway.
 * `nextCursor` decides whether there is another page, and reading a missing one
 * as `undefined` would make "no more rows" and "the server forgot to say"
 * indistinguishable at the one place it matters.
 */
function toPage<T extends ResourceRow>(body: unknown): ResourcePage<T> {
  const record =
    typeof body === 'object' && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const items = record['items'];
  const cursor = record['nextCursor'];

  return {
    items: Array.isArray(items) ? (items as T[]) : [],
    nextCursor: typeof cursor === 'string' && cursor !== '' ? cursor : null,
  };
}
