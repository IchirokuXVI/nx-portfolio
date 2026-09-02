import { GENERATED_LIST_LIMITS } from '@portfolio/luna-shopper/contracts';
import { ValidationException } from '@portfolio/luna-shopper/platform';
import { Repository } from 'typeorm';
import { GeneratedListLine } from '../entities';

/**
 * The bounds every write that puts a line in a basket satisfies, wherever the
 * write came from (plan 0050, section 5; plan 0055, section 7).
 *
 * They lived as private helpers on `GeneratedListLineService` while the owner's
 * account surface was the only way to create a line. Plan 0055 section 3 adds a
 * second way, reachable by anybody holding a forwarded link, and section 7 is
 * explicit that the same caps carry it: `checkRoom` is now also the thing that
 * stops one participant filling a basket with rubbish.
 *
 * Shared functions rather than copies, because a cap that exists in two places
 * is a cap that will be raised in one of them. The one thing the two surfaces do
 * differently is who may name a target list, and that is decided by the caller
 * rather than here.
 */

/** Trimmed and capped. An empty line is not a line. */
export function checkContent(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    throw new ValidationException('a line needs some text', {
      messageArgs: { field: 'content' },
    });
  }
  if (trimmed.length > GENERATED_LIST_LIMITS.contentMaxLength) {
    throw new ValidationException(
      `a line can be at most ${GENERATED_LIST_LIMITS.contentMaxLength} characters`,
      { messageArgs: { field: 'content' } }
    );
  }
  return trimmed;
}

/**
 * The bounds a basket line's quantity satisfies.
 *
 * Zero is allowed on an **edit** and not on an add, which mirrors the zone line
 * rule plan 0047 section 2.2 states: a line at zero is one the household knows
 * about and does not currently need, and adding a line you do not want is not a
 * gesture anybody makes.
 */
export function checkQuantity(
  quantity: number,
  opts: { allowZero?: boolean } = {}
): number {
  const floor = opts.allowZero ? 0 : 1;
  if (!Number.isInteger(quantity) || quantity < floor) {
    throw new ValidationException(
      `a quantity must be a whole number of at least ${floor}`,
      { messageArgs: { field: 'quantity' } }
    );
  }
  if (quantity > GENERATED_LIST_LIMITS.maxQuantity) {
    throw new ValidationException(
      `a quantity can be at most ${GENERATED_LIST_LIMITS.maxQuantity}`,
      { messageArgs: { field: 'quantity' } }
    );
  }
  return quantity;
}

/**
 * The products a line may be switched between, deduplicated and capped (plan
 * 0055, section 7).
 *
 * The only unbounded array on a write plan 0055 makes reachable by anybody
 * holding a link, so it is bounded here rather than left to the DTO alone: the
 * gateway validates what an HTTP caller sent, and this is what holds for every
 * caller including a future one.
 */
export function checkOptions(options: string[] | undefined): string[] {
  const unique = [...new Set(options ?? [])];
  if (unique.length > GENERATED_LIST_LIMITS.maxOptions) {
    throw new ValidationException(
      `a line can offer at most ${GENERATED_LIST_LIMITS.maxOptions} products`,
      { messageArgs: { field: 'options' } }
    );
  }
  return unique;
}

/**
 * How many lines one basket may hold.
 *
 * Since plan 0055 this is doing a second job it was not written for: it is the
 * limit on how much rubbish one participant can put in somebody else's basket.
 * Revocation is the real control (section 7), and this is what bounds the damage
 * before anybody notices they need to use it.
 */
export async function checkRoom(
  lines: Repository<GeneratedListLine>,
  generatedListId: string
): Promise<void> {
  const count = await lines.count({ where: { generatedListId } });
  if (count >= GENERATED_LIST_LIMITS.maxLines) {
    throw new ValidationException(
      `a generated list can hold at most ${GENERATED_LIST_LIMITS.maxLines} lines`,
      { messageArgs: { field: 'content' } }
    );
  }
}

/** The end of the basket, which is where a line somebody just typed belongs. */
export async function nextPosition(
  lines: Repository<GeneratedListLine>,
  generatedListId: string
): Promise<number> {
  const max = await lines
    .createQueryBuilder('l')
    .select('COALESCE(MAX(l.position), 0)', 'max')
    .where('l."generatedListId" = :generatedListId', { generatedListId })
    .getRawOne<{ max: string }>();
  return Number(max?.max ?? 0) + 1;
}
