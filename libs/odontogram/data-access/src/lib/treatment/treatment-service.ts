import { inject } from '@angular/core';
import { Treatment, TreatmentType } from '@portfolio/odontogram/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { Optional, WithRequired } from '@portfolio/shared/util';
import { Observable } from 'rxjs';
import { TreatmentMemory } from './treatment-memory';

export interface TreatmentGetListFilter {
  ids?: string[];
  searchTerm?: string | RegExp;
  treatmentTypes?: TreatmentType[];
  sort?: string;
  limit?: number;
}

export interface TreatmentServiceI {
  getList(filter?: TreatmentGetListFilter): Observable<Treatment[]>;

  getById(id: string): Observable<Treatment>;

  create(treatment: Optional<Treatment, 'id'>): Observable<Treatment>;

  update(
    treatment: WithRequired<Partial<Treatment>, 'id'>
  ): Observable<Treatment>;

  delete(id: string): Observable<void>;
}

/**
 * DI token for the treatment catalog service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class.
 */
export const TREATMENT_SERVICE = serviceToken<TreatmentServiceI>(
  'TREATMENT_SERVICE',
  () => inject(TreatmentMemory)
);
