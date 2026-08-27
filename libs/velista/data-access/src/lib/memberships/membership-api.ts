import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type {
  MemberOrder,
  Membership,
  MembershipStatus,
  Page,
  Zone,
} from '@portfolio/velista/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { operation } from '../auth/http-context';
import { toDeletedId, toMembership, toPage, toZone } from '../mapping/mappers';
import { required } from '../mapping/required';
import type { AssignableRole, MembershipServiceI } from './membership-service';

/**
 * Memberships, over HTTP. The default behind `MEMBERSHIP_SERVICE`.
 *
 * Provided by the app layer and never at root (rule D5, plan 0004 section 9): it
 * depends on the `HttpClient` the app configures, so it can only be built in the app's
 * own injector.
 *
 * Every write answers a `MembershipView`, and every one of them is mapped rather than
 * trusted (rule D4). The one exception is `reject`, which answers `{ id }`: there is no
 * membership left to describe.
 */
@Injectable()
export class MembershipApi implements MembershipServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async listMembers(
    zoneId: string,
    options?: {
      statuses?: readonly MembershipStatus[];
      cursor?: string;
      limit?: number;
      order?: MemberOrder;
    }
  ): Promise<Page<Membership>> {
    let params = new HttpParams();

    if (options?.statuses !== undefined && options.statuses.length > 0) {
      // The DTO splits a comma separated string as readily as it takes an array, and
      // one parameter is easier to read in a network log than four repeated ones.
      params = params.set('statuses', options.statuses.join(','));
    }
    if (options?.cursor !== undefined) {
      params = params.set('cursor', options.cursor);
    }
    if (options?.limit !== undefined) {
      // Validated to [1, 100], and out of range is a 400 rather than a clamp.
      params = params.set('limit', clampLimit(options.limit));
    }
    if (options?.order !== undefined) {
      params = params.set('order', options.order);
    }

    const body = await firstValueFrom(
      this._http.get<unknown>(this._members(zoneId), {
        params,
        context: operation('members.list'),
      })
    );

    return toPage(body, toMembership);
  }

  approve(zoneId: string, membershipId: string): Promise<Membership> {
    return this._act(zoneId, membershipId, 'approve');
  }

  async reject(zoneId: string, membershipId: string): Promise<string> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._member(zoneId, membershipId)}/reject`,
        {},
        { context: operation('members.reject') }
      )
    );

    // The membership this addressed is the one that was rejected, so falling back to
    // it costs nothing and keeps a readable answer from being the difference between
    // the row leaving and the row staying.
    return toDeletedId(body) ?? membershipId;
  }

  kick(zoneId: string, membershipId: string): Promise<Membership> {
    return this._act(zoneId, membershipId, 'kick');
  }

  ban(zoneId: string, membershipId: string): Promise<Membership> {
    return this._act(zoneId, membershipId, 'ban');
  }

  async setRole(
    zoneId: string,
    membershipId: string,
    role: AssignableRole
  ): Promise<Membership> {
    const body = await firstValueFrom(
      this._http.patch<unknown>(
        `${this._member(zoneId, membershipId)}/role`,
        { role },
        { context: operation('members.setRole') }
      )
    );

    return required(toMembership(body), 'members.setRole');
  }

  async transferOwnership(zoneId: string, membershipId: string): Promise<Zone> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._member(zoneId, membershipId)}/transfer-ownership`,
        {},
        { context: operation('members.transferOwnership') }
      )
    );

    return required(toZone(body), 'members.transferOwnership');
  }

  async setUsername(
    zoneId: string,
    membershipId: string,
    username: string
  ): Promise<Membership> {
    const body = await firstValueFrom(
      this._http.patch<unknown>(
        `${this._member(zoneId, membershipId)}/username`,
        { username },
        { context: operation('members.setUsername') }
      )
    );

    return required(toMembership(body), 'members.setUsername');
  }

  /** The four `POST` verbs that answer a membership and take no body. */
  private async _act(
    zoneId: string,
    membershipId: string,
    verb: 'approve' | 'kick' | 'ban'
  ): Promise<Membership> {
    const body = await firstValueFrom(
      this._http.post<unknown>(
        `${this._member(zoneId, membershipId)}/${verb}`,
        {},
        { context: operation(`members.${verb}`) }
      )
    );

    return required(toMembership(body), `members.${verb}`);
  }

  private _members(zoneId: string): string {
    return this._urls.gateway(`/v1/zones/${zoneId}/members`);
  }

  private _member(zoneId: string, membershipId: string): string {
    return `${this._members(zoneId)}/${membershipId}`;
  }
}

function clampLimit(limit: number): string {
  return String(Math.min(100, Math.max(1, Math.trunc(limit))));
}
