/**
 * What a turn with the assistant is made of (plan 0032, and backend `0039`).
 *
 * The service is stateless (backend rule A2), so the conversation lives on this side
 * and is sent whole on every turn. These are therefore both a request shape and the
 * thing the panel renders, which is why they sit here rather than inside
 * `data-access`: `ui` renders a turn and may not import that library (rule D1).
 */

/** Who said it. Two speakers, and there will not be a third. */
export type AssistantSpeaker = 'caller' | 'bot';

/**
 * Something a turn genuinely read or wrote, and therefore something the panel may
 * link to (backend rule A3).
 *
 * **The reply text is never parsed for ids.** An id here came back from the gateway
 * during the turn that produced it, so the target exists and the caller can see it. An
 * id inside a sentence has neither property, and a link to a list that was never there
 * is worse than no link at all (plan 0032, section 7).
 *
 * A discriminated union rather than one shape with optional ids, because a `line`
 * without a `listId` is not a reference this app can build a URL from, and a type that
 * admits one is a type that pushes the same check into every caller.
 */
export type AssistantReference =
  | { readonly kind: 'zone'; readonly zoneId: string; readonly label: string }
  | {
      readonly kind: 'list';
      readonly zoneId: string;
      readonly listId: string;
      readonly label: string;
    }
  | {
      readonly kind: 'line';
      readonly zoneId: string;
      readonly listId: string;
      readonly lineId: string;
      readonly label: string;
    };

/**
 * One entry in the transcript.
 *
 * This app's own shape, not the wire's. The gateway takes
 * `{ role: 'USER' | 'ASSISTANT', content }` and the mapper in `data-access` is the only
 * place that knows it, which is rule D4: the client owns its models and its words, and
 * a backend rename is a mapper edit rather than a rename through every template.
 */
export interface AssistantTurn {
  readonly speaker: AssistantSpeaker;
  readonly text: string;
}

/**
 * Which of the four branches decided the list a write went to (backend `0039`,
 * section 6.1).
 *
 * `asked` is the one worth knowing about: none of the other three answered, so the
 * turn ended with a question and **wrote nothing**. The other three all wrote.
 */
export type ListResolution = 'named' | 'conversation' | 'onlyList' | 'asked';

/**
 * What the service answered.
 *
 * `references` is always an array, empty when the turn read nothing — which is exactly
 * right for a redirect, a refusal, or a turn that called no tool. An absent field and
 * an empty one mean the same thing to the panel, so the mapper collapses them rather
 * than making every reader ask.
 */
export interface AssistantReply {
  readonly text: string;
  readonly references: readonly AssistantReference[];

  /**
   * What the service heard, on a spoken turn (backend `0041`, section 3.1).
   *
   * The panel puts it in the caller's own bubble, so the person can see the sentence
   * the machine believed and check the answer against it. Mishearing is the
   * characteristic failure of a voice interface, and an answer to a question you
   * cannot see is an answer you cannot check.
   *
   * **Optional, and the panel must never invent it.** A typed turn carries none, and
   * a service that sends none on a spoken turn is not broken: the bubble falls back to
   * a neutral placeholder, because a guess at what somebody said is worse than showing
   * that the words are not known.
   */
  readonly heard?: string;

  /**
   * Present when the turn resolved a list for a write, absent otherwise.
   *
   * **Nothing in this app's behaviour turns on it yet**, and it is carried rather than
   * dropped on purpose: the backend put it on the response instead of leaving it in a
   * log line because the client is expected to distinguish a write from a question
   * eventually, and a field the mapper silently discards is a field the next plan has
   * to rediscover. Plan 0032 section 3 is explicit that the panel draws a transcript, a
   * composer and one button and nothing else, so acting on it is not this plan's work.
   */
  readonly listResolution?: ListResolution;
}

/**
 * A turn the panel is holding, which is a transcript entry plus what became of it.
 *
 * `pending` is the caller's message while its answer is in flight. `failed` and
 * `throttled` are the bot's side of a turn that produced no reply, and they are
 * **messages in the transcript rather than banners** (plan 0032, section 3): one kind
 * of thing, in one place, whatever went wrong.
 *
 * `retryAfterSeconds` is the server's own number and is never invented here. Absent
 * means the service did not say, which the panel renders as busy with no clock
 * (section 3.1).
 *
 * `unconfigured` is the one failure that must not say "try again": this deployment has
 * no model provider (a 501, backend plan 0026), so nobody did anything wrong and no
 * amount of retrying will help. It is separate from `failed` for that reason alone.
 *
 * `dropped` is not a speaker's turn at all: it is the line the panel writes on its own
 * when the cap bites, so that losing the oldest turns is something a person sees
 * happen rather than something that happened somewhere they cannot look (section 5).
 *
 * `spoken` is the caller's own bubble for a turn they **said**, before the words come
 * back. It carries no text on purpose: the client has nothing to write there, because
 * the service transcribes (backend `0041`, section 8.4). It becomes a `said` carrying
 * `heard` when the reply lands, and stays a `spoken` when the reply carries none —
 * showing a placeholder is right, and showing a guess at what somebody said is not.
 *
 * `tooLong` and `badFormat` are the two recordings that never left: over the byte cap,
 * and in a container this deployment cannot read. Both are the app speaking, both say
 * so in a sentence in the transcript rather than a banner, and `tooLong` names the
 * limit (backend `0041`, section 9).
 */
export interface AssistantEntry {
  readonly id: string;
  readonly speaker: AssistantSpeaker;
  readonly text: string;
  readonly references: readonly AssistantReference[];
  readonly kind:
    | 'said'
    | 'pending'
    | 'spoken'
    | 'failed'
    | 'throttled'
    | 'unconfigured'
    | 'tooLong'
    | 'badFormat'
    | 'dropped';
  readonly retryAfterSeconds?: number;
}
