import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  CreateGeneratedListRequest,
  GeneratedListRun,
  GeneratedListSummary,
  Page,
  WritableGeneratedListStatus,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import {
  toGeneratedListRun,
  toGeneratedListSummary,
  toPage,
} from '../mapping/mappers';
import { required } from '../mapping/required';
import type { GeneratedListServiceI } from './generated-list-service';

/**
 * How many trips a page of the history holds.
 *
 * A phone screen fits four or five rows, so this is roughly four screens of scrolling
 * per request: small enough that the first page lands quickly on a slow connection, and
 * large enough that somebody flicking through a year of shopping is not making a
 * request every thumb movement.
 */
const HISTORY_PAGE_SIZE = 20;

/**
 * The caller's generated shopping lists, over HTTP. The default behind
 * `GENERATED_LIST_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the `HttpClient`
 * the app configures.
 */
@Injectable()
export class GeneratedListApi implements GeneratedListServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listMine(cursor?: string): Promise<Page<GeneratedListSummary>> {
    let params = new HttpParams().set('limit', HISTORY_PAGE_SIZE);
    if (cursor !== undefined) {
      params = params.set('cursor', cursor);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._lists(), {
        params,
        context: operation('generatedList.listMine'),
      })
    );

    return toPage(body, toGeneratedListSummary);
  }

  /**
   * The request body is built here from our own model rather than spread from it.
   *
   * The gateway's validation pipe runs with `forbidNonWhitelisted: true`, so a field it
   * does not know is a 400 rather than an ignored key, and rule D4 maps one way anyway.
   * `sources` is sent as `{ zoneId, listId }` with an explicit null, because a null
   * `listId` is the meaningful value here: it is what stores "every list in this group,
   * including ones made later" rather than today's list ids frozen in.
   */
  async create(request: CreateGeneratedListRequest): Promise<GeneratedListRun> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        this._lists(),
        {
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.profileId === undefined
            ? {}
            : { profileId: request.profileId }),
          ...(request.sources === undefined
            ? {}
            : {
                sources: request.sources.map((source) => ({
                  zoneId: source.zoneId,
                  listId: source.listId,
                })),
              }),
          ...(request.idempotencyKey === undefined
            ? {}
            : { idempotencyKey: request.idempotencyKey }),
        },
        { context: operation('generatedList.create') }
      )
    );

    return required(toGeneratedListRun(body), 'generatedList.create');
  }

  /**
   * Finish a trip, or take it back to being one (velista `0057`).
   *
   * The body carries `status` and nothing else, which is what makes it safe to send
   * from a screen that is showing a basket somebody else may be editing: the route
   * takes a name and a default target list too, and a request that spread the whole
   * basket over them would write back whatever this client last read.
   *
   * The answer is a `GeneratedListView` and is deliberately dropped. See
   * `GeneratedListServiceI.setStatus` for who learns about the change instead.
   */
  async setStatus(
    generatedListId: string,
    status: WritableGeneratedListStatus
  ): Promise<void> {
    await firstValueFrom(
      this._http.patch<unknown>(
        `${this._lists()}/${generatedListId}`,
        { status },
        { context: operation('generatedList.setStatus') }
      )
    );
  }

  private _lists(): string {
    return this._urls.gateway('/v1/generated-lists');
  }
}
