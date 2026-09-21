import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import {
  AUTH_PATTERNS,
  type SuggestUsernameRequest,
  type SuggestUsernameResult,
} from '@portfolio/luna-shopper/contracts';
import { UsernameGenerator } from './username-generator.service';

/**
 * A fresh generated name, for the setup's first step (plan 0145, section 4).
 *
 * **It writes nothing.** The name is a suggestion on a screen, and it becomes
 * this account's name only when the client sends it to
 * `AUTH_PATTERNS.setUsername`, which already owns that write and already
 * carries the rename throttle. So this handler touches no repository, and it
 * takes no `userId`: it is not about the caller at all.
 *
 * A controller of its own rather than a handler on `IdentityController`,
 * because that class is about accounts and credentials and this is about a
 * pool of words. It sits beside the generator it is one line over.
 */
@Controller()
export class UsernameController {
  constructor(private readonly usernames: UsernameGenerator) {}

  @MessagePattern(AUTH_PATTERNS.suggestUsername)
  suggest(@Payload() req: SuggestUsernameRequest): SuggestUsernameResult {
    // `generate` falls back to the request context's locale, which the NATS
    // headers seeded, and finally to English. Exactly what registration draws.
    return { username: this.usernames.generate(req?.locale) };
  }
}
