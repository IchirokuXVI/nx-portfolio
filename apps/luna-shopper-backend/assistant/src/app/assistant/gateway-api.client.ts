import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LinePage,
  LineSettlementResult,
  LineView,
  ListPage,
  ListView,
  MyZoneView,
  UserProfileView,
  ZonePage,
} from '@portfolio/luna-shopper/contracts';
import {
  SettlementOutcome,
  UsernamePropagation,
} from '@portfolio/luna-shopper/contracts';
import {
  CORRELATION_ID_HEADER,
  DEFAULT_LOCALE,
  getRequestContext,
  MAX_PAGE_SIZE,
  type SupportedLocale,
} from '@portfolio/luna-shopper/platform';
import type { AssistantConfig } from '../config/app-config';

/**
 * The assistant's only door to application data, and therefore where rule A1
 * lives (plan 0039, section 2).
 *
 * > The assistant reads no application data except through the API, carrying the
 * > caller's own token.
 *
 * Everything in this class takes an {@link ApiCaller} as its first argument and
 * puts that caller's `Authorization` header on the wire verbatim. There is no
 * overload that omits it, no service account, no cached client and no
 * constructor that could hold one, which is the point: the rule is enforced by
 * there being nothing else to call rather than by remembering to pass a token.
 *
 * What the rule buys is that every authorization check, throttle, validation rule
 * and event emission built across plans 0004 to 0037 applies here without being
 * restated. A write the caller could not make by tapping comes back as the same
 * 403 the app gets, from the same code, and the bot says so in words.
 */
export interface ApiCaller {
  /** The caller's `Authorization` header, exactly as it arrived. */
  authorization: string;
  /** The caller's language, so the API's own error messages come back in it. */
  locale: SupportedLocale;
}

/**
 * What the API said when it said no.
 *
 * It carries the status and the API's own localized `message`, because the bot's
 * job in that case is to relay the answer rather than to invent one: "that name
 * is taken" is a sentence the platform already knows how to write, in the
 * caller's language, and rewriting it here would be a second translation of the
 * same fact.
 */
export class GatewayApiError extends Error {
  constructor(
    readonly status: number,
    /** The problem body's `message`, when the response carried one. */
    readonly apiMessage: string | undefined,
    readonly code: string | undefined
  ) {
    super(`gateway answered ${status}`);
    this.name = 'GatewayApiError';
  }
}

/**
 * How many pages of lines one turn will walk before it stops asking.
 *
 * Five is well past any real shopping list and is here as a bound rather than a
 * budget: a cursor that never runs out would otherwise hold a turn open.
 */
const MAX_LINE_PAGES = 5;

@Injectable()
export class GatewayApiClient {
  private readonly config: AssistantConfig;

  constructor(@Inject(ConfigService) configService: ConfigService) {
    this.config = configService.getOrThrow<AssistantConfig>('assistant');
  }

  /** The caller's zones. Page one only: the context index is meant to be small. */
  async listZones(caller: ApiCaller): Promise<MyZoneView[]> {
    const page = await this.request<ZonePage>(
      caller,
      'GET',
      '/v1/zones?limit=25'
    );
    return page.items;
  }

  /** The lists the caller can see in one zone. */
  async listLists(caller: ApiCaller, zoneId: string): Promise<ListView[]> {
    const page = await this.request<ListPage>(
      caller,
      'GET',
      `/v1/zones/${encodeURIComponent(zoneId)}/lists?limit=50`
    );
    return page.items;
  }

  /**
   * One list's lines. Fetched only when a tool asks for them (section 5): a turn
   * that turns out to be "hello" should not have cost four gateway calls.
   *
   * **Paged, and at `MAX_PAGE_SIZE` rather than a number written here.** This
   * asked for 200 in one go, which is over the cap every collection route shares,
   * so the gateway answered 400 and both tools that read lines failed: the reply
   * said it could not do it, and `upsert_line` never got as far as writing
   * because it reads the list first to decide between an edit and an add.
   *
   * Following the cursor rather than settling for one page, because this is what
   * the tools answer "is there milk on the list" from, and a page boundary is not
   * a reason to say no. Bounded all the same: a turn is a conversation, not a
   * report, and something has gone wrong if this is still going after five pages.
   */
  async listLines(caller: ApiCaller, listId: string): Promise<LineView[]> {
    const path = `/v1/lists/${encodeURIComponent(listId)}/lines`;
    const lines: LineView[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_LINE_PAGES; page += 1) {
      const query = new URLSearchParams({ limit: String(MAX_PAGE_SIZE) });
      if (cursor !== undefined) {
        query.set('cursor', cursor);
      }

      const answer = await this.request<LinePage>(
        caller,
        'GET',
        `${path}?${query.toString()}`
      );
      lines.push(...answer.items);

      if (!answer.nextCursor) {
        break;
      }
      cursor = answer.nextCursor;
    }

    return lines;
  }

  addLine(
    caller: ApiCaller,
    listId: string,
    body: { content: string; quantity?: number }
  ): Promise<LineView> {
    return this.request<LineView>(
      caller,
      'POST',
      `/v1/lists/${encodeURIComponent(listId)}/lines`,
      body
    );
  }

  /**
   * Several lines in one request (plan 0040, section 6).
   *
   * The reason is not round trips. The assistant reaches the gateway over the
   * cluster's internal service name with no TLS and no ingress, so ten sequential
   * calls cost single digit milliseconds each against a model call measured in
   * seconds, and nobody would ever perceive the difference. The reason is the
   * **throttle**: one bucket of 120 requests a minute, counted in Redis and
   * therefore shared across replicas, and every call made on somebody's behalf
   * spends from **their** bucket. A chatty bot makes the app the person is
   * holding answer 429 for reasons they cannot see and did not cause.
   */
  addLines(
    caller: ApiCaller,
    listId: string,
    items: { content: string; quantity?: number }[]
  ): Promise<LineView[]> {
    return this.request<LineView[]>(
      caller,
      'POST',
      `/v1/lists/${encodeURIComponent(listId)}/lines/batch`,
      { items }
    );
  }

  updateLine(
    caller: ApiCaller,
    lineId: string,
    body: { content?: string; quantity?: number }
  ): Promise<LineView> {
    return this.request<LineView>(
      caller,
      'PATCH',
      `/v1/lines/${encodeURIComponent(lineId)}`,
      body
    );
  }

  /**
   * "Two more bottles of milk", in one request (plan 0040, section 3).
   *
   * The alternative is what this replaces: read the list, find the line, add, and
   * `PATCH` the sum. That is a lost update between the read and the write with no
   * detector, and it means the count the bot reports is the one it decided rather
   * than the one the server holds. The response is the line as it now stands, so
   * the sentence is true rather than computed.
   */
  addLineQuantity(
    caller: ApiCaller,
    lineId: string,
    delta: number
  ): Promise<LineView> {
    return this.request<LineView>(
      caller,
      'POST',
      `/v1/lines/${encodeURIComponent(lineId)}/quantity`,
      { delta }
    );
  }

  /**
   * Say what happened to a line on a trip (plan 0047, section 4).
   *
   * It replaced `setLineStatus`, which moved a line between trip states a zone
   * line no longer carries. Buying decrements the quantity by what was bought;
   * "they had none" records that and moves nothing.
   *
   * A sub resource rather than a field on the `PATCH`, which is the gateway's own
   * shape and not a choice made here. It answers with the line as it now stands
   * **and** the settlement that moved it, so what the bot says about it is
   * reported rather than assumed.
   */
  settleLine(
    caller: ApiCaller,
    lineId: string,
    outcome: SettlementOutcome,
    quantity?: number
  ): Promise<LineSettlementResult> {
    return this.request<LineSettlementResult>(
      caller,
      'POST',
      `/v1/lines/${encodeURIComponent(lineId)}/settle`,
      { outcome, ...(quantity === undefined ? {} : { quantity }) }
    );
  }

  /**
   * Take one line off a list (plan 0043, section 3).
   *
   * One line per request, because that is the route that exists: there is no
   * batch delete and this plan adds no gateway route. The caller loops, and
   * section 3.5 is why it reports exactly which of those requests succeeded
   * rather than claiming a rollback nothing performed.
   */
  deleteLine(caller: ApiCaller, lineId: string): Promise<{ id: string }> {
    return this.request<{ id: string }>(
      caller,
      'DELETE',
      `/v1/lines/${encodeURIComponent(lineId)}`
    );
  }

  /**
   * The whole of `rename_me` (section 6.3). **One request**: plan 0018 already
   * built the cascade server side, so there is nothing here to orchestrate and
   * nothing that can half succeed.
   */
  setUsername(
    caller: ApiCaller,
    username: string,
    propagation: UsernamePropagation
  ): Promise<UserProfileView> {
    return this.request<UserProfileView>(caller, 'PATCH', '/v1/account/me', {
      username,
      propagation,
    });
  }

  private async request<T>(
    caller: ApiCaller,
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const correlationId = getRequestContext()?.correlationId;

    const response = await fetch(`${this.config.gatewayInternalUrl}${path}`, {
      method,
      headers: {
        // Verbatim. Rule A1's entire content is this line.
        authorization: caller.authorization,
        'accept-language': caller.locale ?? DEFAULT_LOCALE,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        // One id threads the user action across the nested pair section 3
        // describes: the client's request to the gateway, and the gateway request
        // the assistant makes back on its behalf.
        ...(correlationId ? { [CORRELATION_ID_HEADER]: correlationId } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      throw await readProblem(response);
    }

    return (await response.json()) as T;
  }
}

/** Lifts the house error envelope off a failed response, tolerating its absence. */
async function readProblem(response: Response): Promise<GatewayApiError> {
  let message: string | undefined;
  let code: string | undefined;
  try {
    const problem = (await response.json()) as {
      message?: unknown;
      code?: unknown;
    };
    message = typeof problem.message === 'string' ? problem.message : undefined;
    code = typeof problem.code === 'string' ? problem.code : undefined;
  } catch {
    // A non JSON body from something in front of the gateway. The status is
    // still the answer, and it is enough for the bot to say what happened.
  }
  return new GatewayApiError(response.status, message, code);
}
