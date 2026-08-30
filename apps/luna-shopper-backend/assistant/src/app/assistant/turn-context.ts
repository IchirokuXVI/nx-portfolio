import { Injectable } from '@nestjs/common';
import type { LineView } from '@portfolio/luna-shopper/contracts';
import { GatewayApiClient, type ApiCaller } from './gateway-api.client';
import type { ContextList } from './list-resolution';

/**
 * What the bot is allowed to know this turn (plan 0039, section 5).
 *
 * Every field here came back from the gateway during **this turn**, fetched with
 * the caller's own token, which is the guarantee rule A1 buys: the bot cannot see
 * a row its caller could not.
 *
 * That guarantee has a price, paid in latency and gateway requests, and the two
 * consequences the plan draws from it are both implemented here:
 *
 * - **Fetch lazily.** The zone and list index resolves almost anything, so it is
 *   fetched up front; a list's lines are fetched only when a tool asks for them.
 *   A turn that turns out to be "hello" should not have cost four gateway calls.
 * - **Nothing is cached across callers.** There is nowhere to cache it, which is
 *   rule A1 doing its job rather than a limitation to work around. This object
 *   lives for one turn and is dropped with it.
 */
export interface ContextZone {
  zoneId: string;
  zoneName: string;
}

@Injectable()
export class TurnContextFactory {
  constructor(private readonly api: GatewayApiClient) {}

  async open(caller: ApiCaller): Promise<TurnContext> {
    const zones = await this.api.listZones(caller);

    // One request per zone. Bounded by how many zones a person is in, which the
    // domain keeps small, and it is the only way to see every list rather than
    // the three newest a zone summary previews.
    const lists: ContextList[] = [];
    for (const zone of zones) {
      for (const list of await this.api.listLists(caller, zone.id)) {
        lists.push({
          listId: list.id,
          listName: list.name,
          zoneId: zone.id,
          zoneName: zone.name,
        });
      }
    }

    return new TurnContext(
      this.api,
      caller,
      zones.map((zone) => ({ zoneId: zone.id, zoneName: zone.name })),
      lists
    );
  }
}

export class TurnContext {
  /** Lines already fetched this turn, so two tools do not pay for them twice. */
  private readonly linesByList = new Map<string, LineView[]>();

  constructor(
    private readonly api: GatewayApiClient,
    readonly caller: ApiCaller,
    readonly zones: ContextZone[],
    readonly lists: ContextList[]
  ) {}

  /** Lazily, and once per list per turn. */
  async lines(listId: string): Promise<LineView[]> {
    const cached = this.linesByList.get(listId);
    if (cached) {
      return cached;
    }
    const lines = await this.api.listLines(this.caller, listId);
    this.linesByList.set(listId, lines);
    return lines;
  }

  /** Forget what a write just invalidated, so a later read in the same turn is true. */
  invalidate(listId: string): void {
    this.linesByList.delete(listId);
  }

  find(listId: string): ContextList | undefined {
    return this.lists.find((list) => list.listId === listId);
  }

  /**
   * The index as the model sees it: names and nothing else.
   *
   * **No ids.** The model never receives one and therefore cannot write one into
   * a tool argument or a sentence; ids are resolved from names on this side and
   * emitted as references from tool results (rule A3). It is one fewer thing that
   * can be hallucinated into a link that 404s.
   */
  describeForModel(): string {
    if (this.lists.length === 0 && this.zones.length === 0) {
      return 'This person belongs to no zones and can see no lists yet.';
    }

    const byZone = this.zones.map((zone) => {
      const names = this.lists
        .filter((list) => list.zoneId === zone.zoneId)
        .map((list) => `"${list.listName}"`);
      return names.length > 0
        ? `- zone "${zone.zoneName}": ${names.join(', ')}`
        : `- zone "${zone.zoneName}": no lists this person can see`;
    });

    return [`This person's zones and lists:`, ...byZone].join('\n');
  }
}
