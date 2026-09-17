import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  LIST_PATTERNS,
  type LineSuggestionPage,
  type ListSuggestionsRequest,
} from '@portfolio/luna-shopper/contracts';
import { SuggestionsService } from './suggestions.service';

/** The lines a list suggests, over NATS (plan 0123). `READ` on the list. */
@Controller()
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @MessagePattern(LIST_PATTERNS.suggestions)
  list(@Payload() req: ListSuggestionsRequest): Promise<LineSuggestionPage> {
    return this.suggestions.list(req);
  }
}
