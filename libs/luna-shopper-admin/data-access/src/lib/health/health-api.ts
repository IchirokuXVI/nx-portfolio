import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { ADMIN_REACHABILITY_POLICY } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom, timeout } from 'rxjs';
import { ApiUrl } from '../api-url';
import type { HealthServiceI } from './health-service';
import { probeContext } from './probe-http-context';

/**
 * `GET /health/live`, the one request this app makes about the server rather
 * than about the data (plan 0008, section 1).
 *
 * Liveness rather than readiness. The question is whether the network path and
 * the process exist, not whether every dependency behind them is warm, and
 * `/health/ready` answers a different question that Kubernetes asks.
 *
 * The endpoint is unauthenticated and exempt from the gateway's rate limiter, so
 * a client is allowed to ask it every two minutes for as long as an outage
 * lasts. Nothing else in this app is.
 *
 * `responseType: 'text'` because the body is Terminus's own shape and nothing
 * here reads it. What is being asked is whether a 2xx arrives, so parsing the
 * answer could only introduce a way to fail while succeeding.
 */
@Injectable()
export class HealthApi implements HealthServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);
  private readonly _policy = inject(ADMIN_REACHABILITY_POLICY);

  async probe(): Promise<boolean> {
    try {
      await firstValueFrom(
        this._http
          .get(this._urls.gateway('/health/live'), {
            context: probeContext(),
            responseType: 'text',
          })
          // Its own, much shorter timeout. The interceptor's applies to it as
          // well, and thirty seconds of waiting to find out whether a server is
          // there is a question already answered by the waiting.
          .pipe(timeout({ each: this._policy.probeTimeoutMs }))
      );
      return true;
    } catch {
      // A refusal, a timeout, a 502 from a proxy in front of a restarting
      // gateway, a 500 from a gateway that cannot answer its own liveness
      // check. All of them are one answer: not a server this operator can work
      // against.
      return false;
    }
  }
}
