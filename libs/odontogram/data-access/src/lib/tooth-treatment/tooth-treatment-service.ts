import { inject } from '@angular/core';
import { TeethNumbers, ToothTreatment } from '@portfolio/odontogram/models';
import { serviceToken } from '@portfolio/shared/data-access';
import { Optional, WithRequired } from '@portfolio/shared/util';
import { Observable } from 'rxjs';
import { ToothTreatmentMemory } from './tooth-treatment-memory';

export interface ToothTreatmentGetListFilter {
  ids?: string[];
  odontogram?: string | string[];
  client?: string;
  teeth?: Array<(typeof TeethNumbers)[number]>;
}

export interface ToothTreatmentServiceI {
  getList(filter?: ToothTreatmentGetListFilter): Observable<ToothTreatment[]>;

  getById(id: string): Observable<ToothTreatment>;

  create(treatment: Optional<ToothTreatment, 'id'>): Observable<ToothTreatment>;

  update(
    treatment: WithRequired<Partial<ToothTreatment>, 'id'>
  ): Observable<ToothTreatment>;

  delete(id: string): Observable<void>;
}

/**
 * DI token for the tooth-treatment service, defaulting to the in-memory
 * implementation. Inject this instead of a concrete class.
 */
export const TOOTH_TREATMENT_SERVICE = serviceToken<ToothTreatmentServiceI>(
  'TOOTH_TREATMENT_SERVICE',
  () => inject(ToothTreatmentMemory)
);
