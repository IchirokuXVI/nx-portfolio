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
 * What the list page asks for in one request.
 *
 * The gateway's `MAX_PAGE_SIZE`, and asking for all of it is what makes reordering
 * available on the first frame: rule L4 refuses to reorder a list the client has not
 * finished reading, and a shopping list with more than a hundred lines is not the case
 * this product is for (plan 0012, section 4.5).
 */
export const LINES_PAGE_SIZE = 100;
