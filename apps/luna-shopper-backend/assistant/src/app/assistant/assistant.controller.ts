import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ASSISTANT_PATTERNS,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
} from '@portfolio/luna-shopper/contracts';
import { AssistantService } from './assistant.service';

/**
 * The assistant's whole broker surface: one subject (plan 0039, section 1).
 *
 * There is nothing else here because there is nothing else the service does. It
 * takes a question in ordinary language and answers it, and the three things it
 * can do on the caller's behalf all happen over HTTP against the gateway with the
 * caller's own token (rule A1), never over this transport.
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
}
