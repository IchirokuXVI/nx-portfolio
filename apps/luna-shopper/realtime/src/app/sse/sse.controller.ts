import {
  Controller,
  Param,
  Query,
  Req,
  Sse,
  type MessageEvent,
} from '@nestjs/common';
import {
  listRoom,
  zoneRoom,
  type AccessTokenClaims,
} from '@portfolio/luna-shopper/contracts';
import { ForbiddenException } from '@portfolio/luna-shopper/platform';
import type { Request } from 'express';
import { defer, filter, map, Observable, switchMap } from 'rxjs';
import { TokenVerifierService } from '../auth/token-verifier.service';
import { CoreAccessClient } from '../messaging/core-access.client';
import { EventRelayService } from '../relay/event-relay.service';

/**
 * The read-only SSE fallback (plan 0009, section 3) for clients that cannot hold
 * a socket. It carries the same event stream as the WebSocket transport, off the
 * same relay, so a socket client and an SSE client see identical payloads.
 *
 * Authorization mirrors the socket rooms: the request is authenticated from its
 * access token and core confirms zone/list access before any event flows.
 * EventSource cannot set an Authorization header, so the token is also accepted
 * as a `token` query parameter.
 */
@Controller({ version: '1' })
export class SseController {
  constructor(
    private readonly tokenVerifier: TokenVerifierService,
    private readonly coreAccess: CoreAccessClient,
    private readonly relay: EventRelayService
  ) {}

  @Sse('zones/:id/stream')
  zoneStream(
    @Param('id') zoneId: string,
    @Req() req: Request,
    @Query('token') token?: string
  ): Observable<MessageEvent> {
    return this.authorizedStream(req, token, zoneRoom(zoneId), (userId) =>
      this.coreAccess.checkZone(userId, zoneId)
    );
  }

  @Sse('lists/:id/stream')
  listStream(
    @Param('id') listId: string,
    @Req() req: Request,
    @Query('token') token?: string
  ): Observable<MessageEvent> {
    return this.authorizedStream(req, token, listRoom(listId), (userId) =>
      this.coreAccess.checkList(userId, listId)
    );
  }

  /**
   * Authorize on subscribe, then relay the room's events. The authorization runs
   * inside `defer` so it happens per connection when the client subscribes; a
   * denial errors the stream and closes the connection before any event is sent.
   */
  private authorizedStream(
    req: Request,
    queryToken: string | undefined,
    room: string,
    check: (userId: string) => Promise<boolean>
  ): Observable<MessageEvent> {
    return defer(() => this.authorize(req, queryToken, check)).pipe(
      switchMap(() =>
        this.relay.stream$.pipe(
          filter((message) => message.rooms.includes(room)),
          map((message) => ({
            type: message.event,
            data: message.payload as string | object,
            id: message.correlationId,
          }))
        )
      )
    );
  }

  private async authorize(
    req: Request,
    queryToken: string | undefined,
    check: (userId: string) => Promise<boolean>
  ): Promise<AccessTokenClaims> {
    const claims = queryToken
      ? await this.tokenVerifier.verify(queryToken)
      : await this.tokenVerifier.verifyAuthHeader(req.headers.authorization);
    if (!(await check(claims.sub))) {
      throw new ForbiddenException('You do not have access to this stream');
    }
    return claims;
  }
}
