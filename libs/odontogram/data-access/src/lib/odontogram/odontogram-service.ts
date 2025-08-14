import { HttpClient } from "@angular/common/http";
import { Odontogram } from '@portfolio/odontogram/models';
import { Observable } from "rxjs";

export interface OdontogramServiceI {
  _http: HttpClient;

  getList(): Observable<Odontogram[]>;

  getById(id: string): Observable<Odontogram | undefined>;

  create(odontogram: Odontogram): Observable<Odontogram | undefined>;

  update(odontogram: Odontogram): Observable<Odontogram | undefined>;
}
