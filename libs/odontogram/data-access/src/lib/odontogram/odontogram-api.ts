import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Odontogram } from '@portfolio/odontogram/models';
import {
  ApiConsumer,
  NotFoundResourceError,
  OwnApiUrlResolver,
} from '@portfolio/shared/data-access';
import { catchError } from 'rxjs';
import { throwError } from 'rxjs/internal/observable/throwError';
import {
  OdontogramGetListFilter,
  OdontogramServiceI,
} from './odontogram-service';

@Injectable({ providedIn: 'root' })
export class OdontogramApi extends ApiConsumer implements OdontogramServiceI {
  private _http: HttpClient = inject(HttpClient);

  private _endpoint = '/odontograms';

  constructor() {
    super(inject(OwnApiUrlResolver));
  }

  getList(filter?: OdontogramGetListFilter) {
    return this._http.get<Odontogram[]>(this._url + this._endpoint, {
      params: { ...filter },
    });
  }

  getById(id: string) {
    return this._http
      .get<Odontogram>(`${this._url + this._endpoint}/${id}`)
      .pipe(
        catchError((error) => {
          let newError: Error = error;

          if (error.status === 404) {
            newError = new NotFoundResourceError(
              `Odontogram with id ${id} not found`
            );
          }

          return throwError(() => newError);
        })
      );
  }

  create(odontogram: Odontogram) {
    return this._http.post<Odontogram>(
      `${this._url + this._endpoint}`,
      odontogram
    );
  }

  update(odontogram: Odontogram) {
    return this._http
      .put<Odontogram>(
        `${this._url + this._endpoint}/${odontogram.id}`,
        odontogram
      )
      .pipe(
        catchError((error) => {
          let newError: Error = error;

          if (error.status === 404) {
            newError = new NotFoundResourceError(
              `Odontogram with id ${odontogram.id} not found`
            );
          }

          return throwError(() => newError);
        })
      );
  }

  delete(id: string) {
    return this._http.delete<void>(`${this._url + this._endpoint}/${id}`);
  }
}
