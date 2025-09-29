import { CommonModule } from '@angular/common';
import { Component, inject, Injector, OnInit, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import {
  OdontogramMemory,
  ToothTreatmentMemory,
  TreatmentMemory,
} from '@portfolio/odontogram/data-access';
import {
  Odontogram,
  Tooth,
  ToothTreatment,
  Treatment,
} from '@portfolio/odontogram/models';
import {
  OdontogramUiModule,
  ToothTreatmentsModal,
} from '@portfolio/odontogram/ui';
import { forkJoin, ReplaySubject, tap } from 'rxjs';

@Component({
  selector: 'lib-odontogram-feature-full-odontogram-crud',
  imports: [CommonModule, OdontogramUiModule],
  templateUrl: './feature-full-odontogram-crud.html',
  styleUrl: './feature-full-odontogram-crud.scss',
})
export class OdontogramFeatureFullOdontogramCrud implements OnInit {
  private _treatmentServ = inject(TreatmentMemory);
  private _toothTreatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);
  private _dialog = inject(MatDialog);
  private _injector = inject(Injector);

  odontograms = signal<Odontogram[] | undefined>(undefined);
  treatments = signal<ToothTreatment[] | undefined>(undefined);

  initialSuggestedTreatments?: ReplaySubject<Treatment[]>;

  selectedOdontogram?: Odontogram;

  ngOnInit() {
    this._odontogramServ.getList().subscribe((odontograms) => {
      this.odontograms.set(odontograms);

      this.selectedOdontogram = odontograms[2];

      this._toothTreatmentServ
        .getList({ odontogram: this.selectedOdontogram?.id })
        .subscribe((treatments) => {
          this.treatments.set(treatments);
        });
    });
  }

  onToothSelected(tooth: Tooth) {
    // When the first modal is opened, it fetches the initial suggested treatments
    // to avoid fetching them multiple times when opening more modals later
    // and also to eagerly load them so it is more responsive when searching the first time
    if (!this.initialSuggestedTreatments) {
      this.searchTreatments().subscribe((treatments) => {
        this.initialSuggestedTreatments = new ReplaySubject<Treatment[]>(1);
        this.initialSuggestedTreatments?.next(treatments);
      });
    }

    const ref = this._dialog.open(ToothTreatmentsModal, {
      maxWidth: '920px',
      width: '920px',
      minWidth: '340px',
      // The modal needs the injector to be able to inject the translation service
      // the instance used is the one that was already shared from other components,
      // it doesn't create a new one
      injector: this._injector,
    });

    ref.componentRef?.setInput('tooth', tooth);
    ref.componentRef?.setInput('client', '1');

    ref.componentRef?.setInput(
      'searchTreatment',
      this.searchTreatments.bind(this)
    );

    ref.componentInstance.toothConfirmedChanges.subscribe((tooth) => {
      const currentTreatments = [...(this.treatments() || [])];

      const currentToothTreatments = currentTreatments?.filter(
        (tt) => tt.teeth.some((t) => t === tooth.number) && tt.odontogram
      );

      if (tooth.treatments) {
        const requests = [];

        for (const toothTreatment of tooth.treatments) {
          const foundTreatment = currentToothTreatments?.find(
            (t) => t.id === toothTreatment.id
          );

          if (!foundTreatment) {
            const req = this._toothTreatmentServ.create(toothTreatment).pipe(
              tap((created) => {
                currentTreatments.push(created);
              })
            );

            requests.push(req);
          } else if (foundTreatment && toothTreatment.id) {
            const req = this._toothTreatmentServ
              .update({
                id: toothTreatment.id,
                ...toothTreatment,
              })
              .pipe(
                tap((updated) => {
                  if (currentToothTreatments.length) {
                    req.subscribe(() => {
                      const index = currentTreatments.findIndex(
                        (t) => t.id === toothTreatment.id
                      );

                      if (index === -1) return;

                      currentTreatments.splice(index, 1, updated);
                    });
                  }
                })
              );

            requests.push(req);
          }
        }

        if (currentToothTreatments.length) {
          for (const currTreatment of currentToothTreatments) {
            const found = tooth.treatments.find(
              (t) => t.id && t.id === currTreatment.id
            );

            if (!found && currTreatment.id) {
              const req = this._toothTreatmentServ
                .delete(currTreatment.id)
                .pipe(
                  tap(() => {
                    const index = currentTreatments.findIndex(
                      (t) => t.id === currTreatment.id
                    );

                    if (index === -1) return;

                    currentTreatments.splice(index, 1);
                  })
                );

              requests.push(req);
            }
          }
        }

        forkJoin(requests).subscribe(() => {
          this.treatments.set(currentTreatments);
        });
      }

      ref.close();
    });
  }

  searchTreatments(searchTerm?: string | null | RegExp) {
    if (!searchTerm && this.initialSuggestedTreatments) {
      return this.initialSuggestedTreatments.asObservable();
    }

    let regexSearchTerm;

    if (searchTerm != null) {
      regexSearchTerm = new RegExp(searchTerm, 'i');
    }

    return this._treatmentServ.getList({
      searchTerm: regexSearchTerm,
      limit: 10,
    });
  }
}
