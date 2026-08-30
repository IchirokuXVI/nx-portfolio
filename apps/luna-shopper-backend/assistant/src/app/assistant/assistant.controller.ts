import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ASSISTANT_PATTERNS,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
  type AssistantVoiceRequest,
} from '@portfolio/luna-shopper/contracts';
import { AssistantService } from './assistant.service';

/**
 * The assistant's whole broker surface: two subjects, and they are the same turn
 * (plan 0039 section 1, plan 0041).
 *
 * There is nothing else here because there is nothing else the service does. It
 * takes a question in ordinary language and answers it, and the three things it
 * can do on the caller's behalf all happen over HTTP against the gateway with the
 * caller's own token (rule A1), never over this transport.
 *
 * The second subject exists because only one of the two requests can be megabytes,
 * not because a spoken turn is a different thing: `voice` transcribes and then
 * runs the identical code `turn` runs.
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

  @MessagePattern(ASSISTANT_PATTERNS.voice)
  voice(
    @Payload() request: AssistantVoiceRequest
  ): Promise<AssistantTurnResponse> {
    return this.assistant.voice(request);
  }
}
