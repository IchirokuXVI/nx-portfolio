import { Treatment, TreatmentType } from '@portfolio/odontogram/models';
import { Optional, WithRequired } from '@portfolio/shared/util';
import { Observable } from 'rxjs';

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
