import { CommonModule } from '@angular/common';
import {
  Component,
  computed,
  ElementRef,
  inject,
  input,
  model,
  OnInit,
  output,
  signal,
  Signal,
  ViewChild,
} from '@angular/core';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  OdontogramMemory,
  ToothTreatmentMemory,
  TreatmentMemory,
} from '@portfolio/odontogram/data-access';
import {
  Odontogram,
  TeethNumbers,
  Tooth,
  ToothTreatment,
  Treatment,
} from '@portfolio/odontogram/models';
import { WithRequired } from '@portfolio/shared/util';
import { map, of, ReplaySubject, switchMap } from 'rxjs';
import { SingleToothImage } from '../single-tooth-image/single-tooth-image';

@Component({
  selector: 'lib-tooth-treatments-modal',
  imports: [
    CommonModule,
    SingleToothImage,
    FormsModule,
    ReactiveFormsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatAutocompleteModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatInputModule,
  ],
  templateUrl: './tooth-treatments-modal.html',
  styleUrls: ['./tooth-treatments-modal.scss'],
  providers: [],
})
export class ToothTreatmentsModal implements OnInit {
  tooth = input.required<Tooth>();
  toothConfirmedChanges = output<Tooth>();

  /**
   * Usado para cargar el historial del cliente
   */
  client = input<string>();

  selectedTooth = signal<Tooth | null>(null);

  toothHistory: Tooth[] = [];

  treatments: ToothTreatment[] = [];

  initialSuggestedTreatments: ReplaySubject<Treatment[]> = new ReplaySubject();

  /**
   * Se guarda de forma temporal el formulario original
   * para no perder los cambios al cambiar en el historial
   */
  tempTreatments?: ToothTreatment[];
  disableForms = model(false);

  teeth: Signal<{ number: string; disabled: boolean }[]>;

  @ViewChild('historyBar') historyBar?: ElementRef<HTMLDivElement>;

  private _treatmentServ = inject(TreatmentMemory);
  private _toothTreatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);

  constructor() {
    this.teeth = computed(() =>
      TeethNumbers.map((toothNumber) => ({
        number: toothNumber,
        disabled: toothNumber == this.tooth().number,
      }))
    );
  }

  ngOnInit() {
    this.selectedTooth.set(this.tooth());

    // Search for initial treatments to show suggestions
    // ahead of time, preventing the user from having to wait
    // for the first loading
    this._treatmentServ.getList({ limit: 10 }).subscribe((treatments) => {
      this.initialSuggestedTreatments.next(treatments);
      this.initialSuggestedTreatments.complete();
    });
  }

  onOpenHistory() {
    this.loadHistory().subscribe(() => {
      setTimeout(() => {
        this.historyBar?.nativeElement.scrollTo({
          left: this.historyBar.nativeElement.scrollWidth,
        });
      }, 0);
    });
  }

  loadHistory() {
    if (this.toothHistory && this.toothHistory.length)
      return of(this.toothHistory);

    const client = this.client();

    if (!client) {
      return of([this.tooth()]);
    }

    return this._odontogramServ.getList({ client }).pipe(
      switchMap((historicalOdontograms) => {
        // Using a set in case the same odontogram appears multiple times
        // because a tooth could have multiple treatments in the same odontogram
        const ids: Set<string> = new Set();

        for (const odontogram of historicalOdontograms) {
          ids.add(odontogram.id);
        }

        return this._toothTreatmentServ
          .getList({
            odontogram: Array.from(ids),
            teeth: [this.tooth().number],
          })
          .pipe(
            map(
              (historicalTreatments) =>
                [
                  historicalOdontograms,
                  historicalTreatments as WithRequired<
                    ToothTreatment,
                    'odontogram'
                  >[],
                ] as const
            )
          );
      }),
      map(([historicalOdontograms, historicalTreatments]) => {
        const treatmentsByOdontogram = new Map<
          Odontogram,
          WithRequired<ToothTreatment, 'odontogram'>[]
        >();

        const sortedOdontograms = historicalOdontograms.sort(
          (a, b) =>
            (a.effectiveDate?.getTime() || a.createdAt?.getTime() || 0) -
            (b.effectiveDate?.getTime() || b.createdAt?.getTime() || 0)
        );

        for (const odontogram of sortedOdontograms) {
          const treatments = historicalTreatments.filter(
            (treatment) => treatment.odontogram === odontogram.id
          );

          if (
            treatments.length ||
            odontogram.id === this.tooth()?.odontogram?.id
          ) {
            treatmentsByOdontogram.set(odontogram, treatments);
          }
        }

        return treatmentsByOdontogram;
      }),
      map((treatmentsByOdontogram) => {
        console.log(treatmentsByOdontogram);
        const inputTooth = this.tooth();

        for (const [
          odontogram,
          treatments,
        ] of treatmentsByOdontogram.entries()) {
          this.toothHistory.push({
            odontogram,
            number: inputTooth.number,
            treatments,
          });
        }

        if (!inputTooth.odontogram) {
          this.toothHistory.push(structuredClone(inputTooth));
        }

        return this.toothHistory;
      })
    );
  }

  selectTooth(newSelectedTooth: Tooth) {
    const originalTooth = this.tooth();
    const currentSelectedTooth = this.selectedTooth();

    // If a tooth from the history is selected, save the current forms state to restore it later
    if (
      currentSelectedTooth?.odontogram === originalTooth.odontogram &&
      newSelectedTooth.odontogram !== originalTooth.odontogram
    ) {
      this.tempTreatments = this.treatments;
    }

    this.treatments = [];

    if (
      newSelectedTooth.odontogram === originalTooth.odontogram &&
      this.tempTreatments
    ) {
      this.treatments = this.tempTreatments;
      this.disableForms.set(false);
      delete this.tempTreatments;
    } else {
      newSelectedTooth.treatments?.forEach((treatment) =>
        this.addToothTreatment(treatment)
      );
    }

    this.selectedTooth.set(newSelectedTooth);

    // Disable the forms if a tooth from the history is selected
    if (newSelectedTooth.odontogram !== originalTooth.odontogram) {
      this.disableForms.set(true);
    }
  }

  addToothTreatment(toothTreatment?: ToothTreatment) {
    this.treatmentsForm.push(toothTreatment);

    return group;
  }

  removeTreatment(index: number) {
    this.treatments.splice.removeAt(index);
  }

  saveTooth() {
    const tooth = this.tooth();

    const treatments: ToothTreatment[] = [];

    this.toothConfirmedChanges.emit({ ...tooth, treatments });
  }
}
