import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Wire } from '@portfolio/luna-shopper-admin/models';
import { firstValueFrom } from 'rxjs';
import { ApiUrl } from '../api-url';
import { toGatewayError } from '../gateway-error';
import {
  ADMIN_LISTS_PATH,
  ADMIN_USERS_PATH,
  ADMIN_ZONES_PATH,
} from './directory-paths';
import type { DirectoryServiceI, LineApproval } from './directory-service';

/**
 * The seven named actions, over HTTP (plan 0007, section 1).
 *
 * Each one is a single request to the route backend plan 0074 built for it, and
 * each of those routes delegates to the service the user facing route uses. So
 * the whole of what this class knows is which URL stands for which action;
 * everything about what an action *means* is in core or in auth, which is the
 * point of naming them rather than offering a row editor.
 *
 * Provided by the app layer and never at root: it depends on the `HttpClient`
 * the app configures, which is the one carrying the bearer token.
 */
@Injectable()
export class DirectoryApi implements DirectoryServiceI {
  private readonly _http = inject(HttpClient);
  private readonly _urls = inject(ApiUrl);

  async deleteUser(userId: string): Promise<void> {
    await this._send('delete', `${ADMIN_USERS_PATH}/${part(userId)}`);
  }

  async resendVerification(userId: string, locale?: string): Promise<void> {
    await this._send(
      'post',
      `${ADMIN_USERS_PATH}/${part(userId)}/resend-verification`,
      // An absent locale is left out of the body rather than sent as null: the
      // gateway's rule is that a missing one means the request's own language,
      // and null is not the same claim.
      locale === undefined || locale === '' ? {} : { locale }
    );
  }

  async deleteZone(zoneId: string): Promise<void> {
    await this._send('delete', `${ADMIN_ZONES_PATH}/${part(zoneId)}`);
  }

  async regenerateJoinCode(zoneId: string): Promise<string> {
    const zone = await this._send<Wire.ZoneZoneView>(
      'post',
      `${ADMIN_ZONES_PATH}/${part(zoneId)}/join-code`,
      {}
    );
    return zone.joinCode;
  }

  async transferOwnership(zoneId: string, membershipId: string): Promise<void> {
    await this._send(
      'post',
      this._member(zoneId, membershipId, 'ownership'),
      {}
    );
  }

  async kickMember(zoneId: string, membershipId: string): Promise<void> {
    await this._send('post', this._member(zoneId, membershipId, 'kick'), {});
  }

  async banMember(zoneId: string, membershipId: string): Promise<void> {
    await this._send('post', this._member(zoneId, membershipId, 'ban'), {});
  }

  /**
   * The two directions of the mark, as the two routes the gateway has for it.
   *
   * `POST` sets it and `DELETE` clears it, and both reach the one service method
   * that writes `status` and `markedForDeletionAt` in a single transaction.
   */
  async setZoneDeletionMark(zoneId: string, marked: boolean): Promise<void> {
    const path = `${ADMIN_ZONES_PATH}/${part(zoneId)}/deletion-mark`;
    await (marked ? this._send('post', path, {}) : this._send('delete', path));
  }

  async approveMember(zoneId: string, membershipId: string): Promise<void> {
    await this._send('post', this._member(zoneId, membershipId, 'approve'), {});
  }

  async rejectMember(zoneId: string, membershipId: string): Promise<void> {
    await this._send('post', this._member(zoneId, membershipId, 'reject'), {});
  }

  async setLineApproval(
    listId: string,
    lineId: string,
    status: LineApproval
  ): Promise<void> {
    await this._send(
      'post',
      `${ADMIN_LISTS_PATH}/${part(listId)}/lines/${part(lineId)}/approval`,
      { status }
    );
  }

  private _member(
    zoneId: string,
    membershipId: string,
    action: string
  ): string {
    return `${ADMIN_ZONES_PATH}/${part(zoneId)}/members/${part(membershipId)}/${action}`;
  }

  /**
   * One request, with every failure arriving as a `GatewayError`.
   *
   * The screens above never see an `HttpErrorResponse` and never switch on a
   * status number, which is what lets one confirmation dialog report the
   * refusal of any of the seven.
   */
  private async _send<R>(
    method: 'post' | 'delete' | 'patch',
    path: string,
    body?: unknown
  ): Promise<R> {
    try {
      return await firstValueFrom(
        this._http.request<R>(method, this._urls.gateway(path), { body })
      );
    } catch (error) {
      throw toGatewayError(error);
    }
  }
}

/** One path segment, from a value that arrived as data. */
function part(value: string): string {
  return encodeURIComponent(value);
}
