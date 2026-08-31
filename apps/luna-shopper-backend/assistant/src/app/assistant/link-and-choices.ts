import type {
  AssistantChoice,
  AssistantListLink,
} from '@portfolio/luna-shopper/contracts';
import { normalize, type ContextList } from './list-resolution';

/**
 * At most six chips (plan 0046, section 4.4).
 *
 * Past that the tool emits none and the model asks in prose, as it always did.
 * Chips are a shortcut past typing a list name, not a menu system, and twenty of
 * them under a one sentence question is a worse thing to hand somebody standing
 * in a shop than the question on its own.
 */
export const MAX_CHOICES = 6;

/**
 * Rule A3, made into an object (plan 0039 section 8, narrowed by plan 0046
 * section 2).
 *
 * > A link is emitted from the tool results the service actually executed.
 *
 * The client draws one link under the answer, and it is **not** parsed out of the
 * reply: the model is never asked to write a link, an id, or markdown. Instead a
 * tool that read or wrote a list records it here, and what comes out is a list
 * the turn genuinely touched.
 *
 * A `listId` that reaches {@link ListLinkCollector.link} came back from the
 * gateway during this turn, so the list exists, the caller can see it, and the
 * link cannot 404. A list the model wrote into a sentence has none of those
 * properties. That guarantee is unchanged and is still the whole reason this is a
 * collector rather than a regex over the reply.
 *
 * What plan 0046 changed is how many links an answer may carry:
 *
 * > A link is emitted only when every list the turn touched is the same list.
 *
 * So a turn that read one list links to it, and a turn that read every list links
 * to none. The second is the case that used to produce a row of chips leading
 * nowhere in particular, and the honest answer there is that there is no single
 * place to go.
 *
 * Lines are not collected at all any more. A line reference addressed the list it
 * sits on plus a query parameter, so a chip for a line and a chip for its list
 * led to the same screen. The reply already says the thing; the link is for going
 * to where it is true.
 */
export class ListLinkCollector {
  /** Keyed by listId, so two tools naming the same list is one list. */
  private readonly touched = new Map<string, ContextList>();

  /**
   * @param namesZones whether the caller is in more than one zone, which is the
   * one fact that decides whether a list is named with its zone (section 3.1).
   */
  constructor(private readonly namesZones: boolean) {}

  list(list: ContextList): void {
    this.touched.set(list.listId, list);
  }

  /** The one list this turn touched, or null when it was not exactly one. */
  link(): AssistantListLink | null {
    if (this.touched.size !== 1) {
      return null;
    }

    const [list] = this.touched.values();
    return {
      zoneId: list.zoneId,
      listId: list.listId,
      label: list.listName,
      zoneLabel: this.namesZones ? list.zoneName : null,
    };
  }
}

/**
 * The answers to a question the turn asked (plan 0046, section 4).
 *
 * Rule A3 again, applied to a question instead of an answer:
 *
 * > A choice is emitted by the tool result that asked the question. The model
 * > never writes one.
 *
 * A chip therefore always names a list that exists, that the caller can see, and
 * that list resolution will match when it comes back. A chip the model invented
 * would have none of those properties, and the failure would be silent: the
 * person taps it, the next turn cannot resolve what came back, and the assistant
 * asks the same question again.
 *
 * Candidates reach here and **never** the link collector. They are the lists the
 * turn could not choose between, so treating them as lists it touched would put
 * "several lists" on exactly the turn that most needs the person to pick one.
 */
export class ChoiceCollector {
  private offered: AssistantChoice[] = [];

  /** @param namesZones as {@link ListLinkCollector}, from the same count. */
  constructor(private readonly namesZones: boolean) {}

  /**
   * Offer one chip per candidate, in the order the context index holds them,
   * which is zone order and then list order.
   *
   * Over the cap it offers none rather than the first six: six of twenty is an
   * arbitrary six, and a question in prose is a better answer than a menu that
   * quietly hides most of what it is asking about.
   */
  lists(candidates: ContextList[]): void {
    if (candidates.length === 0 || candidates.length > MAX_CHOICES) {
      this.offered = [];
      return;
    }

    this.offered = candidates.map((candidate) => ({
      label: this.namesZones
        ? `${candidate.listName} · ${candidate.zoneName}`
        : candidate.listName,
      // The parentheses are for the resolver rather than for the reader.
      // `resolveList` normalizes punctuation away and matches a candidate name
      // contained in what was said, and the zone is the only thing that
      // separates two lists both called "Compra". Naming the zone when nothing
      // is ambiguous would put it in the transcript for no one's benefit.
      message: sharesName(candidates, candidate)
        ? `${candidate.listName} (${candidate.zoneName})`
        : candidate.listName,
    }));
  }

  all(): AssistantChoice[] {
    return this.offered;
  }
}

/** Whether another candidate goes by the same name, which is what a zone settles. */
function sharesName(candidates: ContextList[], one: ContextList): boolean {
  const name = normalize(one.listName);
  return candidates.some(
    (other) => other.listId !== one.listId && normalize(other.listName) === name
  );
}
