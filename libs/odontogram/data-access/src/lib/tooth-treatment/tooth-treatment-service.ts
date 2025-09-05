import { ToothTreatment, TeethNumbers } from '@portfolio/odontogram/models';
import { Optional, WithRequired } from '@portfolio/shared/util';
import { Observable } from 'rxjs';

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
