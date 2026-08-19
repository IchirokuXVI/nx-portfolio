import { inject } from '@angular/core';
import { Odontogram } from '@portfolio/odontogram/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { Optional, WithRequired } from '@portfolio/shared/util';
import { Observable } from 'rxjs';
import { OdontogramMemory } from './odontogram-memory';

export interface OdontogramGetListFilter {
  ids?: string[];
  client?: string;
}

export interface OdontogramServiceI {
  getList(filter?: OdontogramGetListFilter): Observable<Odontogram[]>;

  getById(id: string): Observable<Odontogram>;

  create(odontogram: Optional<Odontogram, 'id'>): Observable<Odontogram>;

  update(
    odontogram: WithRequired<Partial<Odontogram>, 'id'>
  ): Observable<Odontogram>;

  delete(id: string): Observable<void>;
}

/**
 * DI token for the odontogram service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class; swap the default to
 * `OdontogramApi` here (or override per remote with `provideService`) to move
 * onto the real backend.
 */
export const ODONTOGRAM_SERVICE = serviceToken<OdontogramServiceI>(
  'ODONTOGRAM_SERVICE',
  () => inject(OdontogramMemory)
);
