import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  ResourceGateway,
  ResourceInput,
  ResourcePage,
  ResourceQuery,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
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
    const body = await this._send<unknown>('get', this._collection(), {
      params: toParams(query, this._source.pageSize),
    });

    return toPage<T>(body);
  }

  read(id: string): Promise<T> {
    return this._send<T>('get', this._member(id));
  }

  create(input: ResourceInput): Promise<T> {
    return this._send<T>('post', this._collection(), { body: input });
  }

  update(id: string, input: ResourceInput): Promise<T> {
    return this._send<T>('patch', this._member(id), { body: input });
  }

  async remove(id: string): Promise<void> {
    await this._send<unknown>('delete', this._member(id));
  }

  private _collection(): string {
    return this._urls.gateway(this._source.path);
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
    method: 'get' | 'post' | 'patch' | 'delete',
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
