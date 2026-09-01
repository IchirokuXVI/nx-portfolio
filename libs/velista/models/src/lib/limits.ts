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

/**
 * `AddLineDto.quantity`. The reel simply cannot be driven past either end.
 *
 * **The floor is zero**, and it moved there with the trip status (backend plan
 * 0047). Zero is not an empty line waiting to be deleted, it is the household
 * saying it is stocked: the line stays exactly where it is holding everything it
 * knows about itself, and somebody drags it back up in a fortnight. A floor of
 * one would make the ordinary end of the gesture impossible.
 */
export const LINE_QUANTITY_MIN = 0;
export const LINE_QUANTITY_MAX = 100000;

/**
 * How far the thumb travels per unit on the quantity reel (velista plan 0043,
 * section 4).
 *
 * The reel is **positional**: it follows the finger one to one, with no
 * acceleration and no auto repeat, so this number is the whole of its feel. At
 * 40px a 390px phone leaves roughly 280px of comfortable travel, which covers
 * about seven units in one uninterrupted drag. That is what makes two to five a
 * single gesture rather than three, which is the difference between a control
 * somebody uses and one they avoid.
 */
export const QUANTITY_REEL_PX_PER_UNIT = 40;

/**
 * How long the reel's overlay stays up after the thumb lifts, in milliseconds.
 *
 * The gesture does not end at the release. The overlay lingers so a second drag
 * continues from the snapped number, and **the close is what commits**: one
 * signed delta for the whole adjustment, however many times the thumb went back
 * for more inside the window (section 4.1). Long enough to reach for again,
 * short enough not to sit over the row.
 */
export const QUANTITY_REEL_IDLE_MS = 1600;

/** How far a page key moves the quantity, for the reel's keyboard equivalent. */
export const QUANTITY_REEL_PAGE_STEP = 5;

/**
 * How far a pointer may wander and still count as a tap on the reel, in pixels.
 *
 * The reel answers two gestures at once: a drag that carries the number along, and
 * a tap on one of the numbers on show that goes straight to it. Six pixels is
 * about the tremor a thumb has while standing still, and it is far short of the
 * forty a single unit of travel takes, so nothing that reads as a tap can also
 * have moved the number under it.
 */
export const QUANTITY_REEL_TAP_SLOP_PX = 6;

/**
 * How long a press may last and still count as a tap on the reel, in milliseconds.
 *
 * A tap goes to the number under the finger. A hold does not, because a hold is
 * how a drag begins, and somebody who pressed, thought better of it and lifted
 * without moving did not ask for the number they happened to be resting on.
 */
export const QUANTITY_REEL_TAP_MAX_MS = 350;

/**
 * How long a line stays deaf to a tap after the reel closes on its own, in
 * milliseconds.
 *
 * The overlay sits over the row it belongs to, so a finger already on its way down
 * when {@link QUANTITY_REEL_IDLE_MS} runs out lands on a row that was covered a
 * frame ago. For this beat the line behaves exactly as it does while the reel is
 * up: the tap is swallowed rather than opening the detail sheet. It does not apply
 * when somebody closed the reel themselves by tapping elsewhere on the line, since
 * then they were aiming at the row and they get the row, minus that one tap.
 */
export const QUANTITY_REEL_CLICK_SHIELD_MS = 250;

/**
 * How many characters the composer waits for before asking the catalog, and how
 * long it waits after the last one (velista plan 0043, section 6).
 *
 * Three, because one or two characters match most of a supermarket and the list
 * that comes back is noise under the field somebody is still typing into. The
 * debounce is what stops a request per keystroke on a phone in a shop.
 */
export const SUGGEST_MIN_CHARS = 3;
export const SUGGEST_DEBOUNCE_MS = 200;

/**
 * `AddCommentDto.body`.
 *
 * Longer than a line, because a line is a thing to buy and a comment is a sentence
 * about one.
 */
export const COMMENT_BODY_MAX_LENGTH = 2000;

/**
 * How long a voice comment may run before the recorder stops itself (plan 0039,
 * section 2.1).
 *
 * Longer than the line composer's ceiling, because a message is longer than a
 * line: somebody leaving a comment pauses to think, and a minute is enough for
 * anything that is not really a phone call.
 *
 * **The cap stops rather than sends**, which is plan 0032 section 4.4's rule and
 * holds for the same reason: a message that leaves on its own is a message nobody
 * agreed to send. The recording is held and the stop is still there to press,
 * which since plan 0041 is also the press that sends it.
 */
export const VOICE_COMMENT_MAX_SECONDS = 60;

/**
 * How long the list composer will listen before it stops itself (plan 0038).
 *
 * Much shorter than anything else that records here, because this is one
 * sentence about a shopping list rather than a message: "half a dozen eggs and
 * some bread" is five seconds, and thirty is generous for somebody who paused to
 * look in the fridge.
 *
 * The short cap is also what keeps every recording comfortably inside the
 * service's byte limit without the client having to think about bytes at all.
 * The silence detector normally ends a recording long before this; the cap is
 * there because a microphone left open in a kitchen is a bill and a privacy
 * problem.
 */
export const LINE_VOICE_MAX_SECONDS = 30;

/**
 * When a voice comment starts saying how long is left (plan 0041, section 6.2).
 *
 * Fifteen seconds of notice, which is the same proportion the assistant gives at
 * five minutes, rounded to something somebody mid sentence can actually act on.
 * The warning grows the composer and nothing moves under the thumb.
 */
export const VOICE_COMMENT_WARN_SECONDS = 45;

/**
 * The byte cap the gateway enforces (backend `VOICE_COMMENT_MAX_BYTES`).
 *
 * The client's copy is never the authority and a mismatch is a worse message
 * rather than an open door, which is the same paragraph as the rest of this file.
 * It is here so somebody sees the limit named in words with the recording still
 * in the composer, instead of watching an upload fail.
 *
 * At the speech grade bitrate the recorder asks for, a minute is roughly 180 KB,
 * so this is an order of magnitude of headroom rather than a limit anybody meets
 * by talking.
 */
export const VOICE_COMMENT_MAX_BYTES = 2 * 1024 * 1024;

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

/**
/**
 * What a history section asks for in one request (velista plan 0043, section 5.3).
 *
 * Far smaller than a page of lines, and for the opposite reason. A list is read whole
 * so it can be reordered; a history is read to be **looked at**, newest first, and
 * nobody scrolls a year of shopping. Twenty is a screenful and a bit, so the section
 * offers more only when there genuinely is more.
 *
 * The cross list section multiplies this by the number of products on the line, since
 * it reads one page per product and merges them. That is another reason to keep it
 * small: a line carrying six brands of milk would otherwise fetch six hundred rows to
 * draw ten.
 */
export const SETTLEMENTS_PAGE_SIZE = 20;

/**
 * `CreateGeneratedListDto.name` and `UpdateGeneratedListDto.name`, which is
 * `GENERATED_LIST_LIMITS.nameMaxLength` in the contracts (backend plan 0050).
 *
 * The field it guards is optional, unlike every other name in this file: an unnamed
 * basket is displayed as its generation date, so the limit only ever applies to
 * somebody who chose to type one.
 */
export const GENERATED_LIST_NAME_MAX_LENGTH = 120;
