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

/** One entry in the transcript, as it goes over the wire. */
export interface AssistantTurn {
  readonly speaker: AssistantSpeaker;
  readonly text: string;
}

/**
 * What the service answered.
 *
 * `references` is always an array, empty when the turn read nothing. An absent field
 * and an empty one mean the same thing to the panel, so the mapper collapses them
 * rather than making every reader ask.
 */
export interface AssistantReply {
  readonly text: string;
  readonly references: readonly AssistantReference[];

  /**
   * What the service transcribed, on a spoken turn only.
   *
   * The client records audio and knows nothing about the words in it (plan 0032,
   * section 10), so without this the caller's own bubble can say only that they spoke.
   * For the people this feature is for, a reply that answers a question they cannot
   * see is a reply they cannot check, and mishearing is the failure that matters most
   * with a voice interface.
   *
   * Optional, and the panel falls back to a neutral placeholder when it is absent, so
   * a service that never sends it is not broken. It is **never invented**: the client
   * has nothing to invent it from.
   */
  readonly heard?: string;
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
 * `dropped` is not a speaker's turn at all: it is the line the panel writes on its own
 * when the cap bites, so that losing the oldest turns is something a person sees
 * happen rather than something that happened somewhere they cannot look (section 5).
 */
export interface AssistantEntry {
  readonly id: string;
  readonly speaker: AssistantSpeaker;
  readonly text: string;
  readonly references: readonly AssistantReference[];
  readonly kind: 'said' | 'pending' | 'failed' | 'throttled' | 'dropped';
  readonly retryAfterSeconds?: number;
}
