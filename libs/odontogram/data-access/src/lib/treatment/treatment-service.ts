import { ToothTreatment, TeethNumbers } from '@portfolio/odontogram/models';
import { Optional, WithRequired } from "@portfolio/shared/util";
import { Observable } from "rxjs";

export interface TreatmentGetListFilter {
  ids?: string[];
  odontogram?: string;
  teeth?: Array<typeof TeethNumbers[number]>;
}

export interface TreatmentServiceI {
  getList(): Observable<ToothTreatment[]>;

  getById(id: string): Observable<ToothTreatment>;

  create(treatment: Optional<ToothTreatment, 'id'>): Observable<ToothTreatment>;

  update(treatment: WithRequired<Partial<ToothTreatment>, 'id'>): Observable<ToothTreatment>;

  delete(id: string): Observable<void>;
}
