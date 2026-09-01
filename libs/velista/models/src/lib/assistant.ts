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
 * The one place an answer can send somebody (plan 0042, and luna `0046`).
 *
 * **The reply text is never parsed for ids.** The ids here came back from the gateway
 * during the turn that produced them, so the target exists and the caller can see it.
 * An id inside a sentence has neither property, and a link to a list that was never
 * there is worse than no link at all (plan 0032, section 7).
 *
 * It is always a list, and there is at most one. A row of chips, one per thing a turn
 * touched, is a bill of materials rather than a set of links: what somebody wants after
 * "there is no milk on the weekly shop" is to go to the weekly shop, not to choose
 * between two chips that open the same screen.
 */
export interface AssistantListLink {
  readonly zoneId: string;
  readonly listId: string;
  readonly label: string;

  /**
   * The zone's name, when the server says it is worth saying. **Never composed here.**
   *
   * Whether to name the zone is one rule about how many zones somebody is in, and the
   * server is where that rule lives (luna `0046`, section 3). This app renders what it
   * is handed and counts nothing.
   */
  readonly zoneLabel: string | null;
}

/**
 * One answer to a question the assistant just asked (plan 0042, section 4).
 *
 * `label` is what the chip reads and `message` is what tapping it **says**: the tap
 * goes through the same path a typed message takes, so there is no second request
 * shape and nothing new for the store to remember. The two differ because the chip is
 * short and the sentence it stands for need not be.
 */
export interface AssistantChoice {
  readonly label: string;
  readonly message: string;
}

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
 * `link` is null when the turn sent nobody anywhere, which is exactly right for a
 * redirect, a refusal, a question, or a turn that called no tool. `choices` is empty
 * unless the turn ended by asking something. An absent field and an empty one mean the
 * same thing to the panel, so the mapper collapses them rather than making every
 * reader ask, which is also what makes an older backend readable (plan 0042,
 * section 8).
 */
export interface AssistantReply {
  readonly text: string;
  readonly link: AssistantListLink | null;

  /**
   * The answers to the question this turn ended with, and empty when it asked none.
   *
   * A turn that asked a question sends no link, and a turn that sends a link asked
   * nothing (luna `0046`, section 2.4). Both are carried anyway, because a panel that
   * renders whatever it is handed is one fewer thing that can be wrong when the server
   * changes its mind.
   */
  readonly choices: readonly AssistantChoice[];

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
  readonly link: AssistantListLink | null;

  /**
   * The answers the panel offers under this message, and empty on every entry the
   * store writes on its own.
   *
   * Held on the entry rather than on the store, because only the **last** one may be
   * tapped: an answer to a question three turns ago is a wrong answer, and a chip that
   * is still tappable is a chip that invites it (plan 0042, section 4.3). The page is
   * what applies that rule; the entry keeps what it was given so the transcript stays
   * a record of what was offered.
   */
  readonly choices: readonly AssistantChoice[];
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
