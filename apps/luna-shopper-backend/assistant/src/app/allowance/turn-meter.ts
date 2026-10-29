import type { ModelUsage } from '../provider/model-provider';
import { costMicroUsd } from '../provider/prices';

/**
 * What one call sequence spent, added up call by call (plan 0234, section
 * 5.3), for the settle in the `finally` around it.
 *
 * Each provider reply is added with the model that answered it: the turn's
 * model for each round, the moderation model for the check of the reply. A
 * reply that reported no usage makes the whole sequence unknown, and an
 * unknown sequence is charged at least its reservation in full (section 2.2):
 * counting too much is the safe error. A call that failed after it may have
 * run (a deadline, a dropped connection) is charged that call's own worst case
 * through {@link addWorstCase}, so a provider outage does not spend a whole
 * reservation of every person it touches.
 */
export class TurnMeter {
  private knownMicroUsd = 0;
  private unknown = false;
  private calls = 0;
  private promptTokens = 0;
  private responseTokens = 0;
  private cachedPromptTokens = 0;

  /** One reply, priced at `model`'s row. */
  add(model: string, usage: ModelUsage | null | undefined): void {
    this.calls += 1;
    const cost = costMicroUsd(model, usage);
    if (cost === null) {
      this.unknown = true;
    } else {
      this.knownMicroUsd += cost;
    }
    this.promptTokens += usage?.promptTokens ?? 0;
    this.responseTokens += usage?.responseTokens ?? 0;
    this.cachedPromptTokens += usage?.cachedPromptTokens ?? 0;
  }

  /** A call that failed in a way that may still have been billed. */
  addWorstCase(microUsd: number): void {
    this.calls += 1;
    this.knownMicroUsd += microUsd;
  }

  /**
   * Whether any model call was billed or may have been. A turn that made none,
   * because it failed before or the provider refused it with a 429, counts no
   * turn (section 5.3).
   */
  get billed(): boolean {
    return this.calls > 0;
  }

  /**
   * The money to settle: what the replies cost, or the reservation when any
   * call's cost is unknown and the known part is smaller. Never capped at the
   * reservation: a turn that ran over it is charged in full.
   */
  microUsd(reservedMicroUsd: number): number {
    return this.unknown
      ? Math.max(this.knownMicroUsd, reservedMicroUsd)
      : this.knownMicroUsd;
  }

  tokens(): {
    promptTokens: number;
    responseTokens: number;
    cachedPromptTokens: number;
  } {
    return {
      promptTokens: this.promptTokens,
      responseTokens: this.responseTokens,
      cachedPromptTokens: this.cachedPromptTokens,
    };
  }
}
