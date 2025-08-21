import { Injectable } from '@angular/core';
import { InMemoryFilter, Optional, WithRequired } from '@portfolio/shared/util';
import { ToothTreatment } from '@portfolio/odontogram/models';
import { TreatmentGetListFilter, TreatmentServiceI } from './treatment-service';
import { TREATMENTS } from './static-treatments-data';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { Observable, of, throwError } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';

@Injectable({ providedIn: 'root' })
export class TreatmentMemory implements TreatmentServiceI {
  private _treatments: Map<string, ToothTreatment>;
  private _inMemoryFilter = new InMemoryFilter<ToothTreatment, TreatmentGetListFilter>();

  constructor() {
    this._treatments = new Map<string, ToothTreatment>(TREATMENTS.map(od => [od.id, od]));
    this._inMemoryFilter.setFilterConfig({
      ids: { check: this._inMemoryFilter.checks.filterIncludes, dataField: 'id' },
      odontogram: { check: this._inMemoryFilter.checks.strictEquals },
      client: { check: this._inMemoryFilter.checks.strictEquals },
      teeth: { check: (val, filterVal) => val.teeth.every((t) => filterVal?.includes(t)) },
    });
  }

  getList(filter?: TreatmentGetListFilter) {
    return of(this._inMemoryFilter.applyFilter(Array.from(this._treatments.values()), filter));
  }

  getById(id: string) {
    const treatment = this._treatments.get(id);

    if (!treatment) {
      return throwError(() => new NotFoundResourceError(`Treatment with id ${id} not found`));
    }

    return of(treatment);
  }

  create(treatment: Optional<ToothTreatment, 'id'>) {
    const newOdont: WithRequired<ToothTreatment, 'id'> = { ...treatment, id: treatment.id || uuidv4() };

    this._treatments.set(newOdont.id, newOdont);

    return of(newOdont);
  }

  update(treatment: WithRequired<Partial<ToothTreatment>, 'id'>): Observable<ToothTreatment> {
    const oldTreatment = this._treatments.get(treatment.id);

    if (oldTreatment) {
      this._treatments.set(treatment.id, { ...oldTreatment, ...treatment });
    } else {
      return throwError(() => new NotFoundResourceError(`Treatment with id ${treatment.id} not found`));
    }

    const newTreatment = this._treatments.get(treatment.id);

    if (!newTreatment) {
      return throwError(() => new Error(`Update failed: Treatment with id ${treatment.id} not found after updating`));
    }

    return of(newTreatment);
  }

  delete(id: string) {
    this._treatments.delete(id);

    return of(undefined as void);
  }
}
