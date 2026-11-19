import { inject, Injectable, signal } from '@angular/core';
import type { ResourcePage, Wire } from '@portfolio/luna-shopper-admin/models';
import { ADMIN_ADMINS_PATH } from '../directory/directory-paths';
import {
  RESOURCE_GATEWAYS,
  type ResourceSource,
} from '../resource/resource-gateways';

/**
 * The accounts of the memory back end, for a run reverted with no server.
 *
 * The one copy of these rows: the People section builds its `ADMIN_SEED` from
 * this array. The memory gateway keeps one table per path and seeds it from
 * the first source that asks, so two copies that drifted would let the screen
 * opened first decide what the other shows. A feature library may import data
 * access, and not the reverse, so the rows live here.
 */
export const ADMIN_NAME_SEED: readonly Wire.AdminAuthAdminIdentityView[] = [
  {
    adminId: 'admin-ichiroku',
    username: 'ichiroku',
    displayName: 'Ichiroku',
    lastLoginAt: '2026-09-02T07:30:00.000Z',
    disabledAt: null,
  },
  {
    adminId: 'admin-retired',
    username: 'retired',
    displayName: null,
    lastLoginAt: '2026-04-11T15:00:00.000Z',
    disabledAt: '2026-05-01T00:00:00.000Z',
  },
];

/**
 * `GET /v1/admin/admins`, read for names alone (admin plan 0074, section 2).
 *
 * The route answers `{ admins }` and no cursor. The rows are kept as the
 * server sent them, and {@link adminNamesOf} reads each one from `unknown`.
 */
export const ADMIN_NAMES_SOURCE: ResourceSource = {
  path: ADMIN_ADMINS_PATH,
  idField: 'adminId',
  seed: ADMIN_NAME_SEED,
  page: (body: unknown): ResourcePage => {
    const admins = isRecord(body) ? body['admins'] : undefined;
    return {
      items: Array.isArray(admins) ? admins.filter(isRecord) : [],
      nextCursor: null,
    };
  },
};

/**
 * What each admin is called, by id: the display name when it is a non empty
 * string, else the username. A row with no id, or with neither name, names
 * nobody and is left out.
 */
export function adminNamesOf(
  rows: readonly unknown[]
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const row of rows) {
    if (!isRecord(row)) {
      continue;
    }
    const id = text(row['adminId']);
    const name = text(row['displayName']) ?? text(row['username']);
    if (id !== null && name !== null) {
      names.set(id, name);
    }
  }
  return names;
}

/** Where a page stands with the list of admins. */
export type AdminNamesState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * Who an admin id is, for the harvest pages (admin plan 0074, section 2).
 *
 * The harvester stores the id of the admin who reverted a run and no name. The
 * gateway already lists the admins, so the name is read from there and needs
 * no field on the run.
 *
 * Provided by each page that asks, and not at the root: the list is read once
 * for the page, and a failed read is not tried again while the page lives.
 * Nothing is read until a page calls {@link load}, which it does only when a
 * run it shows was reverted.
 */
@Injectable()
export class AdminNames {
  private readonly _gateway = inject(RESOURCE_GATEWAYS).for(ADMIN_NAMES_SOURCE);
  private readonly _names = signal<ReadonlyMap<string, string>>(new Map());
  private readonly _state = signal<AdminNamesState>('idle');

  /** `ready` or `failed` once the read has answered, either way. */
  readonly state = this._state.asReadonly();

  /** The admin's name, or `null` while unread, after a failure, or unknown. */
  nameOf(adminId: string): string | null {
    return this._names().get(adminId) ?? null;
  }

  /** Read the list, once. A second call does nothing, a failure included. */
  async load(): Promise<void> {
    if (this._state() !== 'idle') {
      return;
    }
    this._state.set('loading');

    try {
      const page = await this._gateway.list({});
      this._names.set(adminNamesOf(page.items));
      this._state.set('ready');
    } catch {
      this._state.set('failed');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}
