import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import {
  ASSISTANT_PATTERNS,
  type AssistantCapabilities,
} from '@portfolio/luna-shopper/contracts';
import { describeError } from '@portfolio/luna-shopper/platform';
import { NatsClient } from '../messaging/nats-client';

/** How often the gateway asks again (plan 0231, section 3). */
export const CAPABILITIES_POLL_MS = 60 * 1000;

/**
 * How long one question may take. Nest's NATS client waits forever, and a
 * question that never returns must not hold the next one back. The timeout
 * runs inside the observable, so a question given up on is also unsubscribed:
 * an assistant that takes the question and never answers leaves nothing behind.
 */
export const CAPABILITIES_TIMEOUT_MS = 5 * 1000;

/**
 * What the assistant can do, asked once at boot and every minute after (plan
 * 0231, section 3), so that the public settings route never waits on NATS.
 *
 * It keeps the last answer and serves it. A failed question keeps the answer
 * before it, because one missed poll is not a change of deployment. Before
 * the first answer {@link current} is null, and the settings route serves its
 * fallback.
 */
@Injectable()
export class AssistantCapabilitiesProbe
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantCapabilitiesProbe.name);
  private last: AssistantCapabilities | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight = false;

  constructor(private readonly nats: NatsClient) {}

  /** The last answer, or null before the first one arrived. */
  current(): AssistantCapabilities | null {
    return this.last;
  }

  onApplicationBootstrap(): void {
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), CAPABILITIES_POLL_MS);
    // A poll must never keep a process alive that is otherwise done.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /** Ask once. Never throws. */
  async refresh(): Promise<void> {
    if (this.inFlight) {
      return;
    }
    this.inFlight = true;
    try {
      this.last = await this.nats.send<AssistantCapabilities>(
        ASSISTANT_PATTERNS.capabilities,
        {},
        { timeoutMs: CAPABILITIES_TIMEOUT_MS }
      );
    } catch (error) {
      this.logger.warn(
        `Could not ask the assistant what it can do; ${
          this.last ? 'keeping the last answer' : 'serving the fallback'
        }: ${describeError(error).message}`
      );
    } finally {
      this.inFlight = false;
    }
  }
}
