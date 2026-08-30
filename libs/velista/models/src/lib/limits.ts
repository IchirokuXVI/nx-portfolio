/**
 * The lengths the gateway's DTOs enforce, so a field cannot overrun one.
 *
 * Copied rather than imported, for rule D4's reason (plan 0004, section 4.1): these
 * are `class-validator` decorators on server side DTO classes, so there is no type to
 * import even in principle, and a runtime import of the contracts barrel would pull
 * ajv into the bundle (section 9.3).
 *
 * They are worth having on the client at all because the alternative is letting
 * somebody type a name, tap the button and be handed a `validation_failed` for a limit
 * nothing on screen mentioned. A `maxlength` on the input is a smaller, earlier and
 * kinder version of the same rule.
 *
 * **The client's copy is never the authority.** The gateway validates every one of
 * these again, and a mismatch here is a worse field rather than an open door.
 */

/** `UpdateZoneDto.name` and `CreateZoneDto.name`. */
export const ZONE_NAME_MAX_LENGTH = 80;

/** `CreateListDto.name` and `UpdateListDto.name`. */
export const LIST_NAME_MAX_LENGTH = 120;

/**
 * `SetMembershipUsernameDto.username`, which is the per zone name.
 *
 * A minimum as well as a maximum, which most fields in this app do not have: an empty
 * per zone name would render as a blank row in a members list that other people read.
 */
export const USERNAME_MIN_LENGTH = 2;
export const USERNAME_MAX_LENGTH = 40;

/**
 * `AddLineDto.content` and `UpdateLineDto.content`.
 *
 * The counter appears only near the cap rather than always, because a running character
 * count under a field somebody is typing a shopping item into is noise for the 350
 * characters before it could possibly matter (plan 0012, section 4.8).
 */
export const LINE_CONTENT_MAX_LENGTH = 400;
export const LINE_CONTENT_COUNTER_FROM = 350;

/** `AddLineDto.quantity`. The stepper simply cannot be driven past either end. */
export const LINE_QUANTITY_MIN = 1;
export const LINE_QUANTITY_MAX = 100000;

/**
 * `AddCommentDto.body`.
 *
 * Longer than a line, because a line is a thing to buy and a comment is a sentence
 * about one.
 */
export const COMMENT_BODY_MAX_LENGTH = 2000;

/**
 * How much conversation one turn may carry (backend `0039`, `ASSISTANT_MAX_TURNS` and
 * `ASSISTANT_MAX_CHARS`).
 *
 * The assistant stores nothing between turns, so the transcript is sent whole every
 * time and the client is the thing that holds it (plan 0032, section 5). It is capped
 * on **both** sides, at the same numbers, for two different reasons: the server caps
 * because the client is untrusted, and the client caps so that a person sees the cap
 * happen instead of having a turn silently truncated somewhere they cannot see.
 *
 * The same paragraph as the rest of this file applies: the client's copy is never the
 * authority, and a mismatch is a worse panel rather than an open door.
 *
 * Turns are counted as entries, caller's and bot's alike, because that is what the
 * service counts. Characters are the sum across the transcript that is actually sent.
 */
export const ASSISTANT_MAX_TURNS = 20;
export const ASSISTANT_MAX_CHARS = 8000;

/**
 * `AssistantTurnDto.message`, which is what the caller just said.
 *
 * The gateway's own `@MaxLength(2000)`. Long for a shopping instruction on purpose:
 * this field takes a **dictated** message as well as a typed one, and five minutes of
 * somebody listing a week's shopping is a great deal longer than anybody types.
 */
export const ASSISTANT_MESSAGE_MAX_LENGTH = 2000;

/**
 * The gateway's outer caps on the transcript itself: `@MaxLength(4000)` per entry and
 * `@ArrayMaxSize(100)` on the array.
 *
 * Deliberately **not** the numbers the panel enforces. These are the gateway refusing
 * what is plainly beyond any conversation, and the assistant service applies its own
 * configured caps on arrival regardless, because a limit the client could have chosen
 * is not a limit. `ASSISTANT_MAX_TURNS` and `ASSISTANT_MAX_CHARS` above are the ones
 * that bite first and the ones a person actually sees happen.
 *
 * They are written down so that a transcript this app trims can never be one the
 * gateway would reject outright, which would turn a long conversation into a 400
 * instead of a shorter conversation.
 */
export const ASSISTANT_ENTRY_MAX_LENGTH = 4000;
export const ASSISTANT_TRANSCRIPT_MAX_ENTRIES = 100;

/**
 * What a recording may weigh, in bytes (backend `0041`, sections 4.2 and 5).
 *
 * `ASSISTANT_AUDIO_MAX_BYTES`, which the gateway's multipart interceptor enforces and
 * the assistant applies again to what crossed the broker. The same paragraph as the
 * rest of this file applies twice over here: **the client's copy is never the
 * authority**, and a mismatch is a worse panel rather than an open door.
 *
 * It is worth having on this side because of what the alternative looks like: a person
 * who cannot easily type speaks for five minutes, presses stop, waits for an upload,
 * and is told it was too big. Checked here, the sentence arrives at once and with the
 * limit in it.
 *
 * In practice nothing should ever reach it. `MediaRecorderCapture` records speech at
 * 24 kbps, so five minutes — the longest recording the panel permits — is roughly
 * 900 KB, and the limit a person runs into is their own five minutes.
 */
export const ASSISTANT_AUDIO_MAX_BYTES = 2 * 1024 * 1024;

/** The same number as megabytes, for the sentence that names it. */
export const ASSISTANT_AUDIO_MAX_MB = 2;

/**
 * The containers the service will forward to its provider.
 *
 * A superset of what `MediaRecorderCapture` asks for, because a browser is free to
 * ignore the preference and record in something of its own choosing — Safari does
 * exactly that. Compared against the container alone: `audio/webm;codecs=opus` and
 * `audio/webm` are the same file, and only one of them is a browser's idea of how to
 * say so.
 */
export const ASSISTANT_AUDIO_MIME_TYPES: readonly string[] = [
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/wav',
  'audio/mpeg',
  'audio/aac',
  'audio/flac',
];

/**
 * What the list page asks for in one request.
 *
 * The gateway's `MAX_PAGE_SIZE`, and asking for all of it is what makes reordering
 * available on the first frame: rule L4 refuses to reorder a list the client has not
 * finished reading, and a shopping list with more than a hundred lines is not the case
 * this product is for (plan 0012, section 4.5).
 */
export const LINES_PAGE_SIZE = 100;
