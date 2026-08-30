import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLIENT_VERSION_HEADER,
  ClientTooOldException,
  isOlderThan,
  MIN_CLIENT_VERSION_HEADER,
} from '@portfolio/luna-shopper/platform';
import type { Request, Response } from 'express';
import type { GatewayConfig } from '../config/app-config';

/**
 * Advertises the oldest client this deployment serves, and refuses the ones below
 * it (velista plan 0034, D5 and D9).
 *
 * URI versioning already protects the *shape* of a request: a v2 that wants a
 * different body is a different URL, so an old client keeps talking to the v1 it
 * knows and nothing misreads anything. What versioning cannot do is retire a client.
 * A build old enough to predate a required field or a change in what an existing one
 * means goes on sending requests that parse and mean the wrong thing, and without
 * this there is no channel through which the server can say so.
 *
 * **Off unless `MIN_CLIENT_VERSION` is set**, which it is in neither cluster by
 * default. With no floor configured this returns true before touching the request,
 * so the mechanism costs a property read per request until somebody decides there is
 * a version worth retiring.
 *
 * A guard rather than middleware, and that is not a style preference: a
 * `DomainException` thrown inside Nest's execution context reaches
 * `GlobalExceptionFilter` and comes back as a localized problem document, which is
 * the entire point of refusing this way rather than with a bare status. One thrown
 * from Express middleware reliably does neither.
 *
 * The header it sets is the half that does the useful work in practice. A client
 * reads it off any response, sees it is behind, and asks its service worker for a new
 * version; by the time a refusal would have mattered it has usually already reloaded.
 * The refusal is what makes "an old client cannot keep sending old requests" a
 * guarantee rather than a strong likelihood.
 */
@Injectable()
export class MinClientVersionGuard implements CanActivate {
  /** The floor, or an empty string when this deployment sets none. */
  private readonly _floor: string;

  constructor(config: ConfigService) {
    this._floor = config.getOrThrow<GatewayConfig>('gateway').minClientVersion;
  }

  canActivate(context: ExecutionContext): boolean {
    if (this._floor === '') {
      return true;
    }

    // Guards run for HTTP and for broker messages alike, and a NATS message has no
    // response to set a header on and no client version to read. Only the public
    // HTTP surface is in scope here.
    if (context.getType() !== 'http') {
      return true;
    }

    const http = context.switchToHttp();
    const response = http.getResponse<Response>();

    // Set on every response, including the refusal below and including every error
    // the filter renders, so a client learns the floor from whatever it happened to
    // ask for. Readable cross origin only because `main.ts` names it in
    // `exposedHeaders`; without that a browser on velista.app would never see it.
    response.setHeader(MIN_CLIENT_VERSION_HEADER, this._floor);

    const claimed = http.getRequest<Request>().header(CLIENT_VERSION_HEADER);

    // `isOlderThan` is false whenever either side fails to parse (plan 0034 D6), so
    // a request with no version header, a staging build calling itself `staging`, and
    // a curl by hand are all served. Only a client that states a real version, and
    // states one below the floor, is turned away.
    if (!isOlderThan(claimed, this._floor)) {
      return true;
    }

    throw new ClientTooOldException(
      `client version ${claimed} is below the supported minimum ${this._floor}`
    );
  }
}
