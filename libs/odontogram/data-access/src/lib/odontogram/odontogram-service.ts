import { Odontogram } from '@portfolio/odontogram/models';
import { Optional } from "@portfolio/shared/util";
import { Observable } from "rxjs";

export interface OdontogramGetListFilter {
  ids?: string[];
  client?: string;
}

export interface OdontogramServiceI {
  getList(filter?: OdontogramGetListFilter): Observable<Odontogram[]>;

  getById(id: string): Observable<Odontogram | undefined>;

  create(odontogram: Optional<Odontogram, 'id'>): Observable<Odontogram | undefined>;

  update(odontogram: Odontogram): Observable<Odontogram | undefined>;

  delete(id: string): Observable<void>;
}
