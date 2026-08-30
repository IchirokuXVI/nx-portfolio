import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ASSISTANT_PATTERNS,
  type AssistantTranscribeRequest,
  type AssistantTranscribeResponse,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
} from '@portfolio/luna-shopper/contracts';
import { AssistantService } from './assistant.service';

/**
 * The assistant's whole broker surface: two subjects (plans 0039 and 0041).
 *
 * It takes a question in ordinary language and answers it, and the three things it
 * can do on the caller's behalf all happen over HTTP against the gateway with the
 * caller's own token (rule A1), never over this transport.
 *
 * The second subject is here rather than anywhere else because this service holds
 * the provider credential and no other does. It is the only thing on this
 * controller that carries no `authorization`, which is not an oversight: nothing
 * is being read on anybody's behalf, so rule A1 has nothing to enforce.
 */
@Controller()
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}

  @MessagePattern(ASSISTANT_PATTERNS.turn)
  turn(
    @Payload() request: AssistantTurnRequest
  ): Promise<AssistantTurnResponse> {
    return this.assistant.turn(request);
  }

  @MessagePattern(ASSISTANT_PATTERNS.transcribe)
  transcribe(
    @Payload() request: AssistantTranscribeRequest
  ): Promise<AssistantTranscribeResponse> {
    return this.assistant.transcribe(request);
  }
}
