import { Injectable } from '@angular/core';
import { Optional } from '@portfolio/shared/util';
import { Odontogram } from '@portfolio/odontogram/models';
import { OdontogramServiceI } from './odontogram-service';
import { ODONTOGRAMS } from './static-odontograms-data';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { of, throwError } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable({ providedIn: 'root' })
export class OdontogramMemory implements OdontogramServiceI {
  private _odontograms: Map<string, Odontogram>;

  constructor() {
    this._odontograms = new Map<string, Odontogram>(ODONTOGRAMS.map(od => [od.id, od]));
  }

  getList() {
    return of(Array.from(this._odontograms.values()));
  }

  getById(id: string) {
    const odontogram = this._odontograms.get(id);

    if (!odontogram) {
      return throwError(() => new NotFoundResourceError(`Odontogram with id ${id} not found`));
    }

    return of(odontogram);
  }

  create(odontogram: Optional<Odontogram, 'id'>) {
    const newOdont = { ...odontogram, id: odontogram.id || uuidv4() } as Odontogram;
    this._odontograms.set(newOdont.id, newOdont);

    return of(newOdont);
  }

  update(odontogram: Odontogram) {
    if (this._odontograms.has(odontogram.id)) {
      this._odontograms.set(odontogram.id, odontogram);
    } else {
      return throwError(() => new NotFoundResourceError(`Odontogram with id ${odontogram.id} not found`));
    }

    return of(odontogram);
  }

  delete(id: string) {
    this._odontograms.delete(id);

    return of(undefined as void);
  }
}
