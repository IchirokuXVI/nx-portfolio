import { Injectable } from '@angular/core';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { AssistantServiceI } from './assistant-service';

/**
 * The assistant, in memory. Asked for by name, never a default.
 *
 * It does **not** pretend to be a model: it matches a handful of words and answers a
 * canned sentence, because the thing worth exercising here is the shape of a turn and
 * the references that come back with it, not language. The real service is built now
 * (backend `0039`), so this is for specs and for a run with no backend, which is what
 * every other `*Memory` in this library is for.
 *
 * The three canned answers are the three tools (backend `0039` section 6), so the
 * empty state's three example sentences each reach a reply with the references that
 * kind of turn would genuinely produce.
 *
 * `failNextWith` is how a spec or a backend-less run reaches the two states that are
 * otherwise a matter of luck: a dead network and a busy provider. The second carries a
 * `retryAfterSeconds`, which is the field rule A5 is about.
 */
@Injectable()
export class AssistantMemory implements AssistantServiceI {
  private _nextTurnFails: { code: GatewayError['code']; wait?: number } | null =
    null;

  private _heardNothing = false;

  async ask(
    _transcript: readonly AssistantTurn[],
    message: string
  ): Promise<AssistantReply> {
    const failure = this._nextTurnFails;
    if (failure !== null) {
      this._nextTurnFails = null;
      throw memoryFailure(failure.code, failure.wait);
    }

    return answerFor(message);
  }

  /**
   * A spoken turn, without transcribing anything.
   *
   * It cannot hear, so it answers as though it heard a sentence about adding
   * something, and says so in `heard`. That is enough to exercise the one behaviour
   * the panel has that a typed turn does not: the caller's own bubble starts as a
   * placeholder and is rewritten to the words the service reports.
   *
   * `heardNothing` is how a spec reaches the other branch, which is a recording with
   * nothing recognisable in it.
   */
  async askAloud(
    _transcript: readonly AssistantTurn[],
    _recording: Blob
  ): Promise<AssistantReply> {
    const failure = this._nextTurnFails;
    if (failure !== null) {
      this._nextTurnFails = null;
      throw memoryFailure(failure.code, failure.wait);
    }

    if (this._heardNothing) {
      this._heardNothing = false;
      return {
        text: 'I did not catch that. Could you say it again?',
        references: [],
        heard: '',
      };
    }

    const heard = 'add milk to the weekly shop';
    return { ...answerFor(heard), heard };
  }

  /** Make the next spoken turn come back having heard nothing. */
  hearNothingNext(): void {
    this._heardNothing = true;
  }

  /** Make the next turn fail. One turn, then it forgets, so a retry succeeds. */
  failNextWith(code: GatewayError['code'], retryAfterSeconds?: number): void {
    this._nextTurnFails = { code, wait: retryAfterSeconds };
  }
}

/**
 * One canned reply per tool, chosen by the plainest possible match.
 *
 * Anything unmatched gets the redirect, which is what backend `0039` section 7 says an
 * off topic turn produces: a short friendly sentence and no tool call, and therefore
 * no references.
 */
function answerFor(said: string): AssistantReply {
  const text = said.toLocaleLowerCase();

  if (text.includes('add')) {
    return {
      text: 'Added. Milk on the weekly shop.',
      listResolution: 'named',
      references: [
        {
          kind: 'line',
          zoneId: 'zone-flat',
          listId: 'list-weekly',
          lineId: 'ln-w-01',
          label: 'Milk · 2 l',
        },
      ],
    };
  }

  if (text.includes('?')) {
    return {
      text: 'Yes. There are 2 litres of milk on the weekly shop, still to buy.',
      references: [
        {
          kind: 'list',
          zoneId: 'zone-flat',
          listId: 'list-weekly',
          label: 'Weekly shop',
        },
      ],
    };
  }

  if (text.includes('call me')) {
    return {
      text: 'Done. You are Marta in your groups now.',
      references: [{ kind: 'zone', zoneId: 'zone-flat', label: 'Flat 3B' }],
    };
  }

  return {
    text: 'I only know about your lists, I am afraid. I can add something, tell you what is on one, or change your name.',
    references: [],
  };
}

function memoryFailure(
  code: GatewayError['code'],
  retryAfterSeconds?: number
): GatewayError {
  return new GatewayError({
    code,
    status: code === 'rate_limited' ? 429 : 500,
    correlationId: `memory-${Math.random().toString(36).slice(2, 10)}`,
    detail: 'produced by AssistantMemory, no request was sent',
    retryAfterSeconds,
  });
}
