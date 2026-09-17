import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { DueLine } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toDueLines } from './due-line-mappers';
import type { DueLineServiceI } from './due-line-service';

/**
 * Due lines, over HTTP. The default behind `DUE_LINE_SERVICE`, provided by the app layer
 * and never at root (rule D5).
 */
@Injectable()
export class DueLineApi implements DueLineServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listDueLines(listId: string): Promise<readonly DueLine[]> {
    const body = await firstValueFrom(
      this._http.get<unknown>(
        this._urls.gateway(`/v1/lists/${listId}/suggestions`),
        { context: operation('lists.suggestions') }
      )
    );

    return toDueLines(body);
  }
}
