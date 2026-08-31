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

/**
 * The scoped list is not one the caller can use (plan 0044, section 3).
 *
 * Thrown before the model is called, so a bad scope costs no provider request.
 * The gateway is the authority on why, and the three reasons it could be, in
 * another zone, deleted, or never there, are the same fact from here.
 */
export class ScopeUnavailableError extends Error {
  constructor(readonly listId: string) {
    super(`the scoped list ${listId} is not available to this caller`);
    this.name = 'ScopeUnavailableError';
  }
}

@Injectable()
export class TurnContextFactory {
  constructor(private readonly api: GatewayApiClient) {}

  /**
   * The context for a turn that may only touch one list (plan 0044, section 2.3).
   *
   * **One fetch, not two.** The unscoped path below reads the caller's zones and
   * then every list in each of them, because almost anything needs the index to
   * resolve against. Here the list is in the request, so the index buys nothing
   * and the whole of it collapses into reading that one list. That is a real
   * saving on the path that most needs it: a voice turn already pays for a
   * transcription call before the turn call, so it has the most latency in it and
   * the fewest fetches to spare.
   *
   * **The fetch is what authorizes the turn**, which is why it is not skipped as
   * an optimisation when the scope names a list the model never asks about. The
   * scope is a claim by a browser; reading the list with the caller's own token
   * is what turns it into a fact, and a caller who cannot read it gets the
   * gateway's refusal here, before a provider request is spent on them. Skipping
   * it would make the scope a statement the server simply believed.
   */
  async openScoped(
    caller: ApiCaller,
    scope: { zoneId: string; listId: string }
  ): Promise<TurnContext> {
    // One request, against the zone the caller states, which answers both
    // questions at once: whether they may be here at all, and whether the list
    // they named is one they can see. `GET /v1/lists/:id` does not exist, and
    // adding it for this would be a gateway route, a core handler and a contract
    // for a fact this route already carries. A zone somebody is not a member of
    // is the gateway's own refusal, thrown from here before a provider request
    // is spent.
    const lists = await this.api.listLists(caller, scope.zoneId);
    const list = lists.find((one) => one.id === scope.listId);

    // A list that is not in the answer is not a list this caller can use, whether
    // it is in another zone, was deleted, or never existed. All three are the
    // same fact from here and none of them is worth a different sentence: the
    // scope did not hold, so there is no turn to run.
    if (list === undefined) {
      throw new ScopeUnavailableError(scope.listId);
    }

    // The zone's name is not on a `ListView`, and fetching the zone index to
    // learn it would undo the whole saving this method exists for. It is not
    // needed either: the prompt names the list, and a scoped turn's references
    // are to the list and its lines rather than to the zone.
    const zone: ContextZone = { zoneId: list.zoneId, zoneName: '' };

    return new TurnContext(
      this.api,
      caller,
      [zone],
      [
        {
          listId: list.id,
          listName: list.name,
          zoneId: list.zoneId,
          zoneName: '',
        },
      ],
      list.id
    );
  }

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
    readonly lists: ContextList[],
    /**
     * The one list this turn may touch, or null on an ordinary turn.
     *
     * Read by the tools to refuse a call that named a different list, and by the
     * prompt to say where it is. Null is the whole of plan 0039's behaviour.
     */
    readonly scopedListId: string | null = null
  ) {}

  /** The scoped list itself, when there is one. */
  get scopedList(): ContextList | undefined {
    return this.scopedListId === null
      ? undefined
      : this.find(this.scopedListId);
  }

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
    // A scoped turn is looking at one list and the model is told so plainly, in
    // place of an index it has no use for. There is nothing to resolve and
    // therefore nothing to ask about (plan 0044, section 2.1).
    const scoped = this.scopedList;
    if (scoped !== undefined) {
      return `This person is looking at one list right now, "${scoped.listName}", and it is the only list you can see or touch this turn.`;
    }

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
