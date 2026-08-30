import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { AssistantApi } from './assistant-api';

/**
 * The assistant: two routes, one turn (plan 0032 section 6, backend `0041`).
 *
 * **There is no client here and there is not going to be one.** The panel talks to
 * `/v1/assistant` on the gateway base URL the app already has, so
 * `gatewayInterceptor` attaches the token and the `Accept-Language` header, `ApiUrl`
 * resolves the origin per environment, and a signed out caller is refused by machinery
 * that predates this feature. What is left for this library to own is the request
 * body, the response mapping, and nothing else.
 *
 * The service is stateless (backend rule A2), so **the whole conversation goes with
 * every turn**. There is no conversation id and nothing to resume.
 *
 * Two methods rather than one, and the split is the wire's rather than this app's: a
 * typed turn sends a sentence and a spoken one sends a file. They answer with the same
 * shape and run the same code from the transcription onward.
 */
export interface AssistantServiceI {
  /**
   * A turn (`POST /v1/assistant`).
   *
   * Two arguments and not one, because the gateway takes two: `transcript` is the
   * conversation so far, oldest first, and `message` is what the caller just said.
   * Folding the message into the transcript here would be this library inventing a
   * shape and then taking it apart again.
   *
   * `transcript` arrives already capped by `AssistantStore`. Capping is not done here
   * because dropping turns is something the person is told about, and a service that
   * silently shortened its argument would take that away.
   *
   * **It takes text, whoever produced it.** A typed message and one the platform
   * keyboard dictated into the field are the same call, because by the time either
   * reaches here it is a sentence. A message spoken into the app's own microphone is
   * {@link askAloud} instead.
   */
  ask(
    transcript: readonly AssistantTurn[],
    message: string
  ): Promise<AssistantReply>;

  /**
   * A spoken turn (`POST /v1/assistant/voice`).
   *
   * Two methods and not one, because the two requests genuinely differ: this one has
   * no message, since what the caller said is inside the recording and nobody on this
   * side knows it. The reply carries `heard`, which is how the panel learns it.
   *
   * Everything else is the same turn. The transcript arrives capped by
   * `AssistantStore`, the answer comes back in the same shape, and from the service's
   * point of view a spoken turn becomes a typed one the moment it is transcribed
   * (backend `0041`, section 3.1).
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
