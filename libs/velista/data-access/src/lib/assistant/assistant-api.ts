import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import {
  ASSISTANT_ENTRY_MAX_LENGTH,
  ASSISTANT_MESSAGE_MAX_LENGTH,
  ASSISTANT_TRANSCRIPT_MAX_ENTRIES,
  type AssistantMessageRequest,
  type AssistantReply,
  type AssistantTurn,
  type AssistantTurnRequest,
} from '@portfolio/velista/models';
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

  async ask(
    transcript: readonly AssistantTurn[],
    message: string
  ): Promise<AssistantReply> {
    const body: AssistantTurnRequest = {
      message: message.slice(0, ASSISTANT_MESSAGE_MAX_LENGTH),
      transcript: toTranscript(transcript),
    };

    const answer = await firstValueFrom(
      this._http.post<unknown>(this._urls.gateway('/v1/assistant'), body, {
        context: operation('assistant.ask'),
      })
    );

    return required(toAssistantReply(answer), 'assistant.ask');
  }
}

/**
 * This app's transcript in the gateway's words.
 *
 * The **only** place `USER`, `ASSISTANT` and `content` appear on this side. Rule D4
 * runs one way — models come from the wire, request bodies go to it — so this is a
 * builder rather than a mapper, and it lives beside the request it builds.
 *
 * The two truncations are belt and braces against the gateway's outer caps rather than
 * the panel's own limit, which `AssistantStore` has already applied. They matter
 * because the failure they prevent is the worst one available here: a transcript one
 * entry too long comes back a 400, and a 400 on a conversation reads to the person as
 * the assistant having broken rather than as a conversation having got long. Trimming
 * silently is right precisely because the visible cap already happened upstream.
 */
function toTranscript(
  transcript: readonly AssistantTurn[]
): readonly AssistantMessageRequest[] {
  return transcript.slice(-ASSISTANT_TRANSCRIPT_MAX_ENTRIES).map((turn) => ({
    role:
      turn.speaker === 'caller' ? ('USER' as const) : ('ASSISTANT' as const),
    content: turn.text.slice(0, ASSISTANT_ENTRY_MAX_LENGTH),
  }));
}
