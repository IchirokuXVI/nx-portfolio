import { Injectable } from '@angular/core';
import { ToothTreatment } from '@portfolio/odontogram/models';
import { NotFoundResourceError } from '@portfolio/shared/data-access';
import { InMemoryFilter, Optional, WithRequired } from '@portfolio/shared/util';
import { Observable, of, throwError } from 'rxjs';
import { v4 as uuidv4 } from 'uuid';
import { TOOTH_TREATMENTS } from './static-tooth-treatments-data';
import {
  ToothTreatmentGetListFilter,
  ToothTreatmentServiceI,
} from './tooth-treatment-service';

@Injectable({ providedIn: 'root' })
export class ToothTreatmentMemory implements ToothTreatmentServiceI {
  private _toothTreatments: Map<string, ToothTreatment>;
  private _inMemoryFilter = new InMemoryFilter<
    ToothTreatment,
    ToothTreatmentGetListFilter
  >();

  constructor() {
    this._toothTreatments = new Map<string, ToothTreatment>(
      TOOTH_TREATMENTS.map((od) => [od.id, od])
    );
    this._inMemoryFilter.setFilterConfig({
      ids: {
        check: this._inMemoryFilter.checks.filterIncludesAny,
        dataField: 'id',
      },
      odontogram: { check: this._inMemoryFilter.checks.filterIncludesAny },
      client: { check: this._inMemoryFilter.checks.strictEquals },
      teeth: {
        check: (val, filterVal) =>
          val.teeth.every((t) => filterVal?.includes(t)),
      },
    });
  }

  getList(filter?: ToothTreatmentGetListFilter) {
    return of(
      this._inMemoryFilter.applyFilter(
        Array.from(this._toothTreatments.values()),
        filter
      )
    );
  }

  getById(id: string) {
    const treatment = this._toothTreatments.get(id);

    if (!treatment) {
      return throwError(
        () => new NotFoundResourceError(`Treatment with id ${id} not found`)
      );
    }

    return of(treatment);
  }

  create(treatment: Optional<ToothTreatment, 'id'>) {
    const newOdont: WithRequired<ToothTreatment, 'id'> = {
      ...treatment,
      id: treatment.id || uuidv4(),
    };

    this._toothTreatments.set(newOdont.id, newOdont);

    return of(newOdont);
  }

  update(
    treatment: WithRequired<Partial<ToothTreatment>, 'id'>
  ): Observable<ToothTreatment> {
    const oldTreatment = this._toothTreatments.get(treatment.id);

    if (oldTreatment) {
      this._toothTreatments.set(treatment.id, {
        ...oldTreatment,
        ...treatment,
      });
    } else {
      return throwError(
        () =>
          new NotFoundResourceError(
            `Treatment with id ${treatment.id} not found`
          )
      );
    }

    const newTreatment = this._toothTreatments.get(treatment.id);

    if (!newTreatment) {
      return throwError(
        () =>
          new Error(
            `Update failed: Treatment with id ${treatment.id} not found after updating`
          )
      );
    }

    return of(newTreatment);
  }

  delete(id: string) {
    this._toothTreatments.delete(id);

    return of(undefined as void);
  }
}
