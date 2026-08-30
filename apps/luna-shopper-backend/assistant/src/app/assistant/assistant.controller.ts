import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  ASSISTANT_PATTERNS,
  type AssistantTranscribeRequest,
  type AssistantTranscribeResponse,
  type AssistantTurnRequest,
  type AssistantTurnResponse,
  type AssistantVoiceRequest,
} from '@portfolio/luna-shopper/contracts';
import { AssistantService } from './assistant.service';

/**
 * The assistant's whole broker surface: three subjects (plans 0039, 0041, 0045).
 *
 * It takes a question in ordinary language and answers it, and the three things it
 * can do on the caller's behalf all happen over HTTP against the gateway with the
 * caller's own token (rule A1), never over this transport.
 *
 * `voice` exists because only one of the two turn requests can be megabytes, not
 * because a spoken turn is a different thing: it transcribes and then runs the
 * identical code `turn` runs.
 *
 * `transcribe` is words and nothing else, for a caller that is not having a
 * conversation at all — a voice comment, which is stored before anything is
 * transcribed and gets its transcript afterwards (plan 0045, section 4.1). It is
 * the only thing on this controller that carries no `authorization`, and that is
 * not an oversight: nothing is being read on anybody's behalf, so rule A1 has
 * nothing to enforce.
 *
 * All three live here rather than anywhere else because this service holds the
 * provider credential and no other does.
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

  @MessagePattern(ASSISTANT_PATTERNS.transcribe)
  transcribe(
    @Payload() request: AssistantTranscribeRequest
  ): Promise<AssistantTranscribeResponse> {
    return this.assistant.transcribe(request);
  }
}
