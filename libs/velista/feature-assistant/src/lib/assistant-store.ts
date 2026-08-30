import {
  computed,
  DestroyRef,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import {
  ASSISTANT_SERVICE,
  GatewayError,
  type AssistantServiceI,
} from '@portfolio/velista/data-access';
import {
  ASSISTANT_MAX_CHARS,
  ASSISTANT_MAX_TURNS,
  type AssistantEntry,
  type AssistantReply,
  type AssistantTurn,
} from '@portfolio/velista/models';

/**
 * The conversation, and the one request that advances it (plan 0032, section 5).
 *
 * ## The client holds the transcript
 *
 * Backend rule A2 makes the service stateless, so this is where the conversation
 * lives, and it is sent whole on every turn. It is **provided by the route**, so
 * leaving the panel and coming back within a session keeps the conversation and a
 * reload does not. That is the backend's choice, stated in `0039` section 4 along with
 * what it costs, and this plan does not work around it.
 *
 * ## It caps, and it says that it capped
 *
 * At the same numbers as the server, read from `@portfolio/velista/models` so there is
 * one copy rather than two that can drift. The server caps because the client is
 * untrusted; **this caps so that a person sees it happen** instead of having a turn
 * silently truncated somewhere they cannot look. When the cap bites the oldest turns
 * drop and a line saying so goes in the column where they were.
 *
 * ## Every failure is a message
 *
 * There is no error signal here and no banner above the panel. A dead network, a 403
 * on a write the caller could not have made by hand, and a busy provider all become an
 * entry in the same list as everything else (section 3). The one of them with a number
 * is the rate limit, and the number is the server's: rule A5 puts `retryAfterSeconds`
 * in the problem body precisely so the panel can count it down, and if it is absent
 * this says the bot is busy and **invents nothing**.
 */
@Injectable()
export class AssistantStore {
  private readonly _assistant = inject<AssistantServiceI>(ASSISTANT_SERVICE);

  private readonly _entries = signal<readonly AssistantEntry[]>([]);
  private readonly _busy = signal(false);

  /** Seconds still to wait, or null. Ticked by this store's own timer. */
  private readonly _wait = signal<number | null>(null);

  private _timer: ReturnType<typeof setInterval> | null = null;
  private _nextId = 0;

  /** Everything to draw, oldest first. */
  readonly entries = this._entries.asReadonly();

  /** True while a turn is out. The composer is held for its duration. */
  readonly busy = this._busy.asReadonly();

  /**
   * Whether the composer may take anything.
   *
   * Two reasons and one answer, because they are the same to whoever is holding the
   * phone: a turn is in flight, or the service asked for a wait that has not run out.
   */
  readonly composerDisabled = computed(
    () => this._busy() || this._wait() !== null
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => this._stopCountdown());
  }

  /** A typed turn, or one the platform keyboard dictated into the field. */
  async say(text: string): Promise<void> {
    await this._turn(text, true, (transcript) =>
      this._assistant.ask(transcript)
    );
  }

  /**
   * A spoken turn.
   *
   * The caller's bubble starts as `placeholder`, because nothing on this side knows
   * what was said: transcription happens in the service (section 10). It is **not**
   * sent as part of the transcript for the same reason — a placeholder in the
   * conversation the model reads would be the client putting words in somebody's
   * mouth, which is exactly what rule A2's client held transcript must not do.
   *
   * When the reply carries `heard`, the bubble is rewritten to it, so the person can
   * see what they were understood to have said and check the answer against it.
   */
  async speak(recording: Blob, placeholder: string): Promise<void> {
    await this._turn(placeholder, false, (transcript) =>
      this._assistant.askAloud(transcript, recording)
    );
  }

  private async _turn(
    said: string,
    sendSaid: boolean,
    ask: (transcript: readonly AssistantTurn[]) => Promise<AssistantReply>
  ): Promise<void> {
    if (this.composerDisabled()) {
      return;
    }

    const pendingId = this._append({
      speaker: 'caller',
      text: said,
      kind: 'pending',
      references: [],
    });

    this._busy.set(true);

    try {
      const reply = await ask(this._transcript(sendSaid));
      this._settle(pendingId, 'said', reply.heard);
      this._append({
        speaker: 'bot',
        text: reply.text,
        kind: 'said',
        references: reply.references,
      });
    } catch (failure) {
      // The caller's message stays in the column whatever went wrong. It is what they
      // said, it is still true that they said it, and on a rate limit it is the thing
      // section 3.1 promises is "still here".
      this._settle(pendingId, 'said');
      this._appendFailure(failure);
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * What goes over the wire: the conversation, capped, with the pending turn last.
   *
   * A turn that failed carries no meaning for the model and a countdown certainly
   * does not, so only the entries somebody actually said are sent. The pending entry
   * **is** included when it holds the caller's words, because it is the message being
   * answered.
   */
  private _transcript(includePending: boolean): readonly AssistantTurn[] {
    const said = this._entries().filter(
      (entry) =>
        entry.kind === 'said' || (includePending && entry.kind === 'pending')
    );

    return capTranscript(
      said.map((entry) => ({ speaker: entry.speaker, text: entry.text }))
    );
  }

  /**
   * The cap, applied to what is held as well as to what is sent, and announced.
   *
   * Run after every turn rather than only before a request, so the line explaining it
   * lands in the column at the moment the turns leave rather than one turn later.
   */
  private _enforceCap(): void {
    const kept = this._entries();
    const said = kept.filter((entry) => entry.kind === 'said');
    const survivors = capTranscript(said);

    if (survivors.length === said.length) {
      return;
    }

    const dropped = said.length - survivors.length;
    const first = said[dropped];
    const from = first === undefined ? 0 : kept.indexOf(first);

    this._entries.set([
      {
        id: `drop-${this._nextId++}`,
        speaker: 'bot',
        text: '',
        references: [],
        kind: 'dropped',
      },
      ...kept.slice(from),
    ]);
  }

  /**
   * A turn that produced no reply, as an entry.
   *
   * The `text` is left empty on purpose for every kind this writes. A `failed`, a
   * `throttled` and a `dropped` say something the **app** is saying rather than
   * something anybody said, so their copy is localized by the page from a key, the way
   * every other string in this app is. Only a `said` entry carries text that came from
   * a person or from the service.
   */
  private _appendFailure(failure: unknown): void {
    if (failure instanceof GatewayError && failure.code === 'rate_limited') {
      this._append({
        speaker: 'bot',
        text: '',
        kind: 'throttled',
        references: [],
        retryAfterSeconds: failure.retryAfterSeconds,
      });
      this._startCountdown(failure.retryAfterSeconds);
      return;
    }

    // Everything else is one message. A `NetworkError`, a 500, a 403 the gateway
    // raised on a write the caller could not have made by hand: the panel has one
    // treatment because the person has one thing to do about it, which is try again.
    this._append({
      speaker: 'bot',
      text: '',
      kind: 'failed',
      references: [],
    });
  }

  /**
   * Count the server's seconds down and re-enable the composer at zero.
   *
   * **No number, no countdown.** An absent `retryAfterSeconds` leaves the composer
   * usable and the message says the bot is busy, because a clock the panel made up
   * would be a promise nobody can keep (section 3.1).
   */
  private _startCountdown(seconds: number | undefined): void {
    this._stopCountdown();

    if (seconds === undefined) {
      return;
    }

    this._wait.set(seconds);
    this._writeWait(seconds);

    this._timer = setInterval(() => {
      const left = (this._wait() ?? 0) - 1;

      if (left <= 0) {
        this._stopCountdown();
        this._writeWait(0);
        return;
      }

      this._wait.set(left);
      this._writeWait(left);
    }, 1000);
  }

  /** The countdown is displayed by the last throttled entry, so it is written there. */
  private _writeWait(left: number): void {
    this._entries.update((entries) => {
      const last = entries[entries.length - 1];

      return last === undefined || last.kind !== 'throttled'
        ? entries
        : [
            ...entries.slice(0, -1),
            { ...last, retryAfterSeconds: left > 0 ? left : undefined },
          ];
    });
  }

  private _stopCountdown(): void {
    if (this._timer !== null) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._wait.set(null);
  }

  private _append(entry: Omit<AssistantEntry, 'id'>): string {
    const id = `turn-${this._nextId++}`;
    this._entries.update((entries) => [...entries, { ...entry, id }]);
    this._enforceCap();

    return id;
  }

  private _settle(
    id: string,
    kind: AssistantEntry['kind'],
    heard?: string
  ): void {
    this._entries.update((entries) =>
      entries.map((entry) =>
        entry.id === id ? { ...entry, kind, text: heard ?? entry.text } : entry
      )
    );
  }
}

/**
 * The oldest turns go first, until the transcript is inside both caps.
 *
 * Two caps rather than one because the server enforces two (backend `0039`
 * section 11): a short conversation about long lists overruns the character budget
 * long before it reaches twenty turns, and twenty one-word turns overrun neither.
 *
 * Exported for the spec, which asserts the drop is from the front.
 */
export function capTranscript<T extends { readonly text: string }>(
  transcript: readonly T[]
): readonly T[] {
  let kept = transcript.slice(-ASSISTANT_MAX_TURNS);

  while (
    kept.length > 1 &&
    kept.reduce((total, turn) => total + turn.text.length, 0) >
      ASSISTANT_MAX_CHARS
  ) {
    kept = kept.slice(1);
  }

  return kept;
}
