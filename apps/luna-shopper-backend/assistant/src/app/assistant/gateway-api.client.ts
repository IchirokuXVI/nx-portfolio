import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  LinePage,
  LineView,
  ListPage,
  ListView,
  MyZoneView,
  UserProfileView,
  ZonePage,
} from '@portfolio/luna-shopper/contracts';
import { UsernamePropagation } from '@portfolio/luna-shopper/contracts';
import {
  CORRELATION_ID_HEADER,
  DEFAULT_LOCALE,
  getRequestContext,
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
   */
  async listLines(caller: ApiCaller, listId: string): Promise<LineView[]> {
    const page = await this.request<LinePage>(
      caller,
      'GET',
      `/v1/lists/${encodeURIComponent(listId)}/lines?limit=200`
    );
    return page.items;
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
