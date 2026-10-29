import {
  AllowanceReserveOutcome,
  type AllowanceRefusal,
  type AssistantAllowanceView,
  type ReadAllowanceRequest,
  type ReserveAllowanceRequest,
  type ReserveAllowanceResponse,
  type SettleAllowanceRequest,
  type SettleAllowanceResponse,
} from '@portfolio/luna-shopper/contracts';
import {
  AllowanceUnavailableError,
  type AllowanceClient,
} from './allowance.client';

/**
 * Core's allowance, as the assistant's specs see it (plan 0234, section 10.1).
 *
 * It records every reserve, settle and read in arrays, and answers what it was
 * told to: reserved by default, or a refusal, a turn in flight, or core not
 * answering at all. It holds no counts: the counting is core's, and its own
 * specs prove it against Postgres. Compiled into the app build, so it names no
 * `jest`.
 */
export class FakeAllowance {
  readonly reserves: ReserveAllowanceRequest[] = [];
  readonly settles: SettleAllowanceRequest[] = [];
  readonly reads: ReadAllowanceRequest[] = [];

  /** What the next reserves answer; reserved when unset. */
  answer:
    | { refused: AllowanceRefusal }
    | { turnInFlight: true }
    | { unavailable: true }
    | undefined;

  /** What a read answers. */
  view: AssistantAllowanceView | undefined;

  /** Every call, in order, so a spec can assert the reserve came first. */
  readonly log: string[] = [];

  private next = 0;

  async reserve(
    req: ReserveAllowanceRequest
  ): Promise<ReserveAllowanceResponse> {
    this.log.push('reserve');
    this.reserves.push(req);
    const answer = this.answer;
    if (answer && 'unavailable' in answer) {
      throw new AllowanceUnavailableError('core did not answer (fake)');
    }
    if (answer && 'refused' in answer) {
      return {
        outcome: AllowanceReserveOutcome.REFUSED,
        reservationId: null,
        refused: answer.refused,
      };
    }
    if (answer && 'turnInFlight' in answer) {
      return {
        outcome: AllowanceReserveOutcome.TURN_IN_FLIGHT,
        reservationId: null,
        refused: null,
      };
    }
    this.next += 1;
    return {
      outcome: AllowanceReserveOutcome.RESERVED,
      reservationId: `reservation-${this.next}`,
      refused: null,
    };
  }

  /** How many of the next settles fail as core not answering. */
  settleFailures = 0;

  async settle(req: SettleAllowanceRequest): Promise<SettleAllowanceResponse> {
    this.log.push('settle');
    this.settles.push(req);
    if (this.settleFailures > 0) {
      this.settleFailures -= 1;
      throw new AllowanceUnavailableError('core did not answer (fake)');
    }
    return { found: true };
  }

  async read(req: ReadAllowanceRequest): Promise<AssistantAllowanceView> {
    this.log.push('read');
    this.reads.push(req);
    if (!this.view) {
      throw new AllowanceUnavailableError('no view scripted (fake)');
    }
    return this.view;
  }

  asClient(): AllowanceClient {
    return this as unknown as AllowanceClient;
  }
}
