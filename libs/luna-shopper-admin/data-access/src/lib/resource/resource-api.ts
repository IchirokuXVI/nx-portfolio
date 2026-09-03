import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  fromNaturalKey,
  type ResourceGateway,
  type ResourceInput,
  type ResourcePage,
  type ResourceQuery,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { GatewayError, toGatewayError } from '../gateway-error';
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

class ResourceApi<T extends ResourceRow> implements ResourceGateway<T> {
  constructor(
    private readonly _http: HttpClient,
    private readonly _urls: ApiUrl,
    private readonly _source: ResourceSource<T>
  ) {}

  async list(query: ResourceQuery): Promise<ResourcePage<T>> {
    const filters = query.filters ?? {};
    const body = await this._send<unknown>('get', this._collection(filters), {
      params: toParams(
        { ...query, filters: this._queryFilters(filters) },
        this._source.pageSize
      ),
    });

    return toPage<T>(body);
  }

  /**
   * One row, by whatever addresses it.
   *
   * A resource with no member route is found by reading its collection: the
   * fields the route filters on narrow the read, and the rest are matched here.
   * It stops at {@link SCAN_PAGE_LIMIT} pages, so an id that names nothing costs
   * a bounded number of requests and then answers "not there", which is what it
   * would have answered anyway.
   */
  async read(id: string): Promise<T> {
    const key = this._source.key;
    if (key === undefined) {
      return this._send<T>('get', this._member(id));
    }

    const wanted = fromNaturalKey(id, key);
    const narrow = this._source.keyFilters ?? key;
    const filters = Object.fromEntries(
      narrow.map((field) => [field, wanted[field] ?? ''])
    );

    let cursor: string | undefined = undefined;
    for (let page = 0; page < SCAN_PAGE_LIMIT; page += 1) {
      const answer: ResourcePage<T> = await this.list({
        filters,
        cursor,
        limit: SCAN_PAGE_SIZE,
      });

      const row = answer.items.find((entry) =>
        key.every((field) => String(entry[field] ?? '') === wanted[field])
      );
      if (row !== undefined) {
        return row;
      }

      if (answer.nextCursor === null) {
        break;
      }
      cursor = answer.nextCursor;
    }

    throw notFound();
  }

  create(input: ResourceInput): Promise<T> {
    const filters = toFilterValues(input);
    return this._source.upsert === true
      ? this._send<T>('put', this._collection(filters), { body: input })
      : this._send<T>('post', this._collection(filters), { body: input });
  }

  /**
   * A change, sent the way the resource accepts one.
   *
   * An upsert carries its key in the body, so the key is put back before the
   * changed fields: the form leaves the key out of an edit, deliberately, since
   * changing it would address a different row rather than move this one.
   */
  update(id: string, input: ResourceInput): Promise<T> {
    if (this._source.upsert !== true) {
      return this._send<T>('patch', this._member(id), { body: input });
    }

    const key =
      this._source.key === undefined
        ? {}
        : fromNaturalKey(id, this._source.key);
    const body = { ...key, ...input };
    return this._send<T>('put', this._collection(toFilterValues(body)), {
      body,
    });
  }

  /**
   * Delete a row.
   *
   * A resource with a natural key is read first, because its `DELETE` is
   * addressed by the id the row answers with rather than by the key the URL
   * carries. That is one extra request on an act that already asked the
   * operator whether they meant it.
   */
  async remove(id: string): Promise<void> {
    if (this._source.key === undefined) {
      await this._send<unknown>('delete', this._member(id));
      return;
    }

    const row = await this.read(id);
    const rowId = row['id'];
    if (typeof rowId !== 'string' || rowId === '') {
      throw notFound();
    }
    await this._send<unknown>('delete', this._member(rowId));
  }

  /** The filters the route declares, which is every one it does not consume. */
  private _queryFilters(
    filters: Readonly<Record<string, string>>
  ): Readonly<Record<string, string>> {
    const consumed = new Set(this._source.pathFilters ?? []);
    return consumed.size === 0
      ? filters
      : Object.fromEntries(
          Object.entries(filters).filter(([name]) => !consumed.has(name))
        );
  }

  private _collection(scope: Readonly<Record<string, string>> = {}): string {
    return this._urls.gateway(
      this._source.collectionPath?.(scope) ?? this._source.path
    );
  }

  private _member(id: string): string {
    return this._urls.gateway(`${this._source.path}/${encodeURIComponent(id)}`);
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
 * How much of a collection a member read may walk before giving up.
 *
 * A bound rather than a budget. An operator reaches a form from the list, so the
 * row is almost always on the first page; the pages after it are for a
 * bookmarked URL, and the limit is what stops a mistyped one from reading the
 * whole catalog to find that out.
 */
const SCAN_PAGE_LIMIT = 25;

/** The largest page the gateway will answer with, so a scan asks for one. */
const SCAN_PAGE_SIZE = 100;

/**
 * A create's body as the values a path can be built from.
 *
 * The parent of a new row is stated in the body the operator filled in, and the
 * collection it is posted to is addressed under that parent. Only strings are
 * taken, because only a string can be a path segment.
 */
function toFilterValues(
  input: ResourceInput
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  );
}

/** A 404 shaped the way one off the wire would be. */
function notFound(): GatewayError {
  return new GatewayError({
    code: 'not_found',
    status: 404,
    correlationId: '',
  });
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
  pageSize: number | undefined
): HttpParams {
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
    if (value !== '') {
      params = params.set(name, value);
    }
  }

  return params;
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
