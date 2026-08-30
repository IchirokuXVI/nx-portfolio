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
  ASSISTANT_AUDIO_MAX_BYTES,
  ASSISTANT_AUDIO_MIME_TYPES,
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

  /**
   * A typed turn, or one the platform keyboard dictated into the field.
   *
   * The words are known on this side, so the caller's bubble carries them from the
   * moment the button is pressed and settles to `said` when the answer lands.
   */
  async say(text: string): Promise<void> {
    await this._turn({ text, kind: 'pending' }, (transcript) =>
      this._assistant.ask(transcript, text)
    );
  }

  /**
   * A turn the caller spoke (backend `0041`).
   *
   * The one behaviour that differs from a typed turn, and it is section 8.4's: **the
   * client does not know the words.** The service transcribes, so the caller's bubble
   * starts as a `spoken` placeholder saying that something was said and is being
   * listened to, and is rewritten to `heard` when the response lands.
   *
   * What it must not do is **invent** them. There is nothing on this side to invent
   * them from, and a bubble showing a guess at what somebody said is worse than one
   * showing that it is waiting. So a reply with no `heard` leaves the placeholder
   * where it is rather than settling to an empty bubble.
   *
   * Both refusals below happen before anything is uploaded, and both are messages in
   * the transcript rather than banners (plan 0032, section 3). The service applies the
   * same two rules to what actually arrives, because a limit the client could have
   * chosen is not a limit — this copy exists so that somebody who cannot easily type
   * is told at once, and with the number in it, rather than after an upload.
   */
  async speak(recording: Blob): Promise<void> {
    if (this.composerDisabled()) {
      return;
    }

    if (recording.size > ASSISTANT_AUDIO_MAX_BYTES) {
      this._append({
        speaker: 'bot',
        text: '',
        kind: 'tooLong',
        references: [],
      });
      return;
    }

    if (!ASSISTANT_AUDIO_MIME_TYPES.includes(containerOf(recording))) {
      this._append({
        speaker: 'bot',
        text: '',
        kind: 'badFormat',
        references: [],
      });
      return;
    }

    await this._turn({ text: '', kind: 'spoken' }, (transcript) =>
      this._assistant.askAloud(transcript, recording)
    );
  }

  /**
   * One turn, whichever way it started.
   *
   * The two callers differ in exactly two places — what the caller's own bubble says
   * while the answer is out, and which method is called — and everything else about a
   * turn is the same, which is worth having in one place rather than in two that drift.
   */
  private async _turn(
    pending: { text: string; kind: 'pending' | 'spoken' },
    ask: (transcript: readonly AssistantTurn[]) => Promise<AssistantReply>
  ): Promise<void> {
    if (this.composerDisabled()) {
      return;
    }

    // The conversation **so far**, read before the new message joins it: the gateway
    // takes `message` as its own field and `transcript` as what came before, so the
    // thing being answered must not also appear in the history of the question.
    const transcript = this._transcript();

    const pendingId = this._append({
      speaker: 'caller',
      text: pending.text,
      kind: pending.kind,
      references: [],
    });

    this._busy.set(true);

    try {
      const reply = await ask(transcript);
      this._settleCaller(pendingId, pending.kind, reply.heard);
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
      this._settleCaller(pendingId, pending.kind, undefined);
      this._appendFailure(failure);
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * The caller's own bubble, once the turn is over.
   *
   * A typed turn always settles: the words were on screen before the request left. A
   * spoken one settles **only** when the service said what it heard, and otherwise
   * stays a placeholder, because the alternative is an empty bubble or a guess.
   */
  private _settleCaller(
    id: string,
    kind: 'pending' | 'spoken',
    heard: string | undefined
  ): void {
    if (kind === 'pending') {
      this._settle(id, 'said');
      return;
    }

    if (heard !== undefined && heard.length > 0) {
      this._settle(id, 'said', heard);
    }
  }

  /**
   * The conversation so far, capped.
   *
   * Only entries somebody actually said. A turn that failed carries no meaning for the
   * model and a countdown certainly does not, so `failed`, `throttled` and the panel's
   * own `dropped` notice are all left out — the model is answering a conversation, not
   * reading this app's diary.
   */
  private _transcript(): readonly AssistantTurn[] {
    const said = this._entries().filter((entry) => entry.kind === 'said');

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

    // The one failure that must not say "try again". This deployment has no model
    // provider, so the route answers 501 and will keep answering 501 (backend plan
    // 0026): nobody did anything wrong and no amount of pressing send will help.
    if (failure instanceof GatewayError && failure.code === 'not_configured') {
      this._append({
        speaker: 'bot',
        text: '',
        kind: 'unconfigured',
        references: [],
      });
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
    text?: string
  ): void {
    this._entries.update((entries) =>
      entries.map((entry) =>
        entry.id === id ? { ...entry, kind, text: text ?? entry.text } : entry
      )
    );
  }
}

/**
 * A recording's container, without the codec parameters a browser tacks on.
 *
 * `audio/webm;codecs=opus` and `audio/webm` are the same file, and only one of them is
 * a browser's idea of how to say so. Matching the whole string would refuse Chrome's
 * own output.
 */
function containerOf(recording: Blob): string {
  return recording.type.split(';')[0].trim().toLowerCase();
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
