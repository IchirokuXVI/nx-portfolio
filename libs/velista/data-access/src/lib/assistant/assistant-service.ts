import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { AssistantApi } from './assistant-api';

/**
 * The assistant, which is one route and therefore one method twice over (plan 0032,
 * section 6).
 *
 * **There is no client here and there is not going to be one.** The panel talks to
 * `/v1/assistant` on the gateway base URL the app already has, so
 * `gatewayInterceptor` attaches the token and the `Accept-Language` header, `ApiUrl`
 * resolves the origin per environment, and a signed out caller is refused by machinery
 * that predates this feature. What is left for this library to own is the request
 * body, the response mapping, and nothing else.
 *
 * The service is stateless (backend rule A2), so **the whole transcript goes with
 * every turn**, including the message being sent. There is no conversation id and
 * nothing to resume.
 */
export interface AssistantServiceI {
  /**
   * A typed turn (`POST /v1/assistant`).
   *
   * `transcript` is the conversation so far **and** the new message as its last entry,
   * already capped by the caller (`AssistantStore`). Capping is not done here because
   * dropping turns is something the person is told about, and a service that silently
   * shortened its argument would take that away.
   */
  ask(transcript: readonly AssistantTurn[]): Promise<AssistantReply>;

  /**
   * A spoken turn: the same transcript, plus a recording to transcribe
   * (`POST /v1/assistant`, multipart).
   *
   * **This is the open dependency plan 0032 section 10 names, resolved in the
   * direction that plan's section 4 draws**: the audio is uploaded and the service
   * transcribes it, rather than the browser transcribing and sending text. The reason
   * is that the drawn recorder is a `MediaRecorder` feature — five minutes, a pause
   * button, and a file that survives a hand letting go — and the browser's own
   * `SpeechRecognition` hands back text and no file, so there would be nothing to
   * pause and nothing to hold at the limit.
   *
   * Backend `0039` has not answered yet, so this is where that answer lands. If it
   * comes back the other way, the change is this method's body and its two lines in
   * `AssistantApi`: everything above it, the recorder included, is unaffected, which
   * is the whole reason the seam is here rather than in the panel.
   */
  askAloud(
    transcript: readonly AssistantTurn[],
    recording: Blob
  ): Promise<AssistantReply>;
}

/**
 * Inject this, typed as the interface, never a concrete class.
 *
 * The default is the real gateway, matching every other service token here.
 */
export const ASSISTANT_SERVICE = serviceToken<AssistantServiceI>(
  'ASSISTANT_SERVICE',
  () => inject(AssistantApi)
);
