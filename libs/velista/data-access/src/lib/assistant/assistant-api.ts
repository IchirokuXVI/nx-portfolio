import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toAssistantReply } from '../mapping/mappers';
import { required } from '../mapping/required';
import type { AssistantServiceI } from './assistant-service';

/**
 * The assistant, over HTTP. The default behind `ASSISTANT_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5): it depends on the
 * `HttpClient` the app configures, and on the interceptor bound beside it.
 *
 * **No new origin and no new environment value** (plan 0032, section 6). This is the
 * gateway base URL every other service in this library already resolves, which is what
 * backend `0039` section 3 bought by proxying the assistant through the gateway rather
 * than giving it a host of its own.
 */
@Injectable()
export class AssistantApi implements AssistantServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async ask(transcript: readonly AssistantTurn[]): Promise<AssistantReply> {
    const answer = await firstValueFrom(
      this._http.post<unknown>(
        this._endpoint(),
        { transcript },
        { context: operation('assistant.ask') }
      )
    );

    return required(toAssistantReply(answer), 'assistant.ask');
  }

  /**
   * The same turn with a recording attached, as `multipart/form-data`.
   *
   * The transcript rides as a JSON string in a form field rather than as repeated
   * fields, because it is a nested array and a multipart body has no shape for one.
   * **No `Content-Type` is set**: the browser has to write the boundary itself, and a
   * hand-written header omits it and produces a body the server cannot split.
   */
  async askAloud(
    transcript: readonly AssistantTurn[],
    recording: Blob
  ): Promise<AssistantReply> {
    const form = new FormData();
    form.set('transcript', JSON.stringify(transcript));
    form.set('audio', recording, 'message.webm');

    const answer = await firstValueFrom(
      this._http.post<unknown>(this._endpoint(), form, {
        context: operation('assistant.askAloud'),
      })
    );

    return required(toAssistantReply(answer), 'assistant.askAloud');
  }

  private _endpoint(): string {
    return this._urls.gateway('/v1/assistant');
  }
}
