import { Odontogram } from '@portfolio/odontogram/models';
import { Optional, WithRequired } from "@portfolio/shared/util";
import { Observable } from "rxjs";

export interface OdontogramGetListFilter {
  ids?: string[];
  client?: string;
}

export interface OdontogramServiceI {
  getList(filter?: OdontogramGetListFilter): Observable<Odontogram[]>;

  getById(id: string): Observable<Odontogram>;

  create(odontogram: Optional<Odontogram, 'id'>): Observable<Odontogram>;

  update(odontogram: WithRequired<Partial<Odontogram>, 'id'>): Observable<Odontogram>;

  delete(id: string): Observable<void>;
}
