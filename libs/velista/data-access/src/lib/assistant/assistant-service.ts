import { inject } from '@angular/core';
import { serviceToken } from '@portfolio/shared/data-access';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { AssistantApi } from './assistant-api';

/**
 * The assistant, which is one route and therefore one method (plan 0032, section 6).
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
   * **It takes text, whoever produced it.** A typed message, a message dictated with
   * the platform keyboard, and a message spoken into the app's own microphone are the
   * same call: the service that shipped has one text endpoint and no audio one, so
   * there is nothing here for a recording to go to (plan 0032, section 10).
   */
  ask(
    transcript: readonly AssistantTurn[],
    message: string
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
