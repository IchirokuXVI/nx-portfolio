import {
  AssistantReferenceKind,
  type AssistantReference,
} from '@portfolio/luna-shopper/contracts';
import type { ContextList } from './list-resolution';

/**
 * Rule A3, made into an object (plan 0039, section 8).
 *
 * > References are emitted from the tool results the service actually executed.
 *
 * The client draws links to the zones, lists and lines an answer mentions
 * (velista 0032). Those links are **not** parsed out of the reply, and the model
 * is never asked to write a link or an id. Instead a tool that read or wrote
 * something records it here, and what comes out is what the turn genuinely
 * touched.
 *
 * An id in this list came back from the gateway during this turn, so it exists,
 * the caller can see it, and the link cannot 404. An id the model wrote into a
 * sentence has none of those properties. This is the cheapest defence against the
 * one failure that would make the feature untrustworthy, and it costs one field.
 *
 * The collector deduplicates, because two tools naming the same list in one turn
 * is ordinary and two identical chips are not.
 */
export class ReferenceCollector {
  private readonly seen = new Map<string, AssistantReference>();

  zone(zoneId: string, label: string): void {
    this.add({
      kind: AssistantReferenceKind.ZONE,
      zoneId,
      listId: null,
      lineId: null,
      label,
    });
  }

  list(list: ContextList): void {
    this.add({
      kind: AssistantReferenceKind.LIST,
      zoneId: list.zoneId,
      listId: list.listId,
      lineId: null,
      label: list.listName,
    });
  }

  line(list: ContextList, lineId: string, label: string): void {
    // The list comes along with the line, because a chip for a line the reader
    // cannot place is not much of an answer, and it costs nothing here.
    this.list(list);
    this.add({
      kind: AssistantReferenceKind.LINE,
      zoneId: list.zoneId,
      listId: list.listId,
      lineId,
      label,
    });
  }

  all(): AssistantReference[] {
    return [...this.seen.values()];
  }

  private add(reference: AssistantReference): void {
    const key = `${reference.kind}:${reference.zoneId}:${reference.listId ?? ''}:${
      reference.lineId ?? ''
    }`;
    if (!this.seen.has(key)) {
      this.seen.set(key, reference);
    }
  }
}
