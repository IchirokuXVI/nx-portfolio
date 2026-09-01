import { Injectable } from '@angular/core';
import type { AssistantReply, AssistantTurn } from '@portfolio/velista/models';
import { GatewayError } from '../errors';
import type { AssistantServiceI } from './assistant-service';

/**
 * The assistant, in memory. Asked for by name, never a default.
 *
 * It does **not** pretend to be a model: it matches a handful of words and answers a
 * canned sentence, because the thing worth exercising here is the shape of a turn and
 * what comes back with it, not language. The real service is built now (backend
 * `0039`), so this is for specs and for a run with no backend, which is what every
 * other `*Memory` in this library is for.
 *
 * The canned answers are the three tools (backend `0039` section 6) plus the turn that
 * ends by asking, so the empty state's example sentences each reach a reply carrying
 * what that kind of turn would genuinely produce: a link, a question with answers under
 * it, or neither.
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
        link: null,
        choices: [],
        heard: '',
      };
    }

    const heard = 'add milk to the weekly shop';
    return { ...answerFor(heard), heard };
  }

  /**
   * A recording spoken into a list's own composer (velista `0038`).
   *
   * The same canned answers, and the scope is accepted rather than checked: this
   * fake stands in for a gateway, and what a scope actually buys is enforced on
   * the server by the tool catalog a scoped turn is given.
   */
  async askAboutList(
    _zoneId: string,
    _listId: string,
    recording: Blob
  ): Promise<AssistantReply> {
    return this.askAloud([], recording);
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
 * nowhere to go.
 */
function answerFor(said: string): AssistantReply {
  const text = said.toLocaleLowerCase();

  // A turn that ended by asking, which is the one branch that sends choices and no
  // link (velista `0042`, section 4). It matches on the word "list" precisely because
  // naming no particular list is what leaves the assistant with nothing to resolve.
  if (text.includes('list')) {
    return {
      text: 'Which list did you mean?',
      listResolution: 'asked',
      link: null,
      choices: [
        { label: 'Weekly shop · Flat 3B', message: 'the weekly shop' },
        { label: 'Shopping · Office', message: 'the office one' },
      ],
    };
  }

  if (text.includes('add')) {
    return {
      text: 'Added. Milk on the weekly shop.',
      listResolution: 'named',
      link: {
        zoneId: 'zone-flat',
        listId: 'list-weekly',
        label: 'Weekly shop',
        zoneLabel: null,
      },
      choices: [],
    };
  }

  if (text.includes('?')) {
    return {
      text: 'Yes. There are 2 litres of milk on the weekly shop, still to buy.',
      // With a zone named, which is what the panel reads as "Go to Weekly shop, in
      // Flat 3B". The decision is the server's and the fake makes both readings
      // reachable rather than composing either of them here.
      link: {
        zoneId: 'zone-flat',
        listId: 'list-weekly',
        label: 'Weekly shop',
        zoneLabel: 'Flat 3B',
      },
      choices: [],
    };
  }

  // Changing a name touches no list, so it sends nobody anywhere. There is no zone
  // link to offer any more, and inventing a list to point at would be worse than the
  // sentence standing on its own.
  if (text.includes('call me')) {
    return {
      text: 'Done. You are Marta in your groups now.',
      link: null,
      choices: [],
    };
  }

  return {
    text: 'I only know about your lists, I am afraid. I can add something, tell you what is on one, or change your name.',
    link: null,
    choices: [],
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
