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
  Signal,
  ViewChild,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  UntypedFormGroup,
} from '@angular/forms';
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
  ToothTreatmentStatus,
  ToothZones,
  Treatment,
  TreatmentType,
} from '@portfolio/odontogram/models';
import { WithRequired } from '@portfolio/shared/util';
import { map, of, switchMap } from 'rxjs';
import { SingleToothImage } from '../single-tooth-image/single-tooth-image';
import {
  mapFormToToothTreatment,
  ToothTreatmentForm,
} from './tooth-treatment-form';

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
  toothZones = ToothZones;
  toothTreatmentStatus = ToothTreatmentStatus;
  toothTreatmentStatusArr = Object.values(ToothTreatmentStatus);

  toothTreatmentStatusToCssClass: { [key in ToothTreatmentStatus]: string } = {
    [ToothTreatmentStatus.PENDING]: 'pending',
    [ToothTreatmentStatus.COMPLETED]: 'finished',
  };

  tooth = input<Tooth>({ number: '11', treatments: [] });
  toothConfirmedChanges = output<Tooth>();

  /**
   * Usado para cargar el historial del cliente
   */
  client = input<string>();

  selectedTooth?: Tooth;

  toothHistory: Tooth[] = [];
  hideHistory = true;

  treatmentsForm = new FormArray<FormGroup<ToothTreatmentForm>>([]);
  mainForm = new FormGroup<{
    treatments: FormArray<FormGroup<ToothTreatmentForm>>;
  }>({ treatments: this.treatmentsForm });

  /**
   * Se guarda de forma temporal el formulario original
   * para no perder los cambios al cambiar en el historial
   */
  tempTreatments?: FormGroup<ToothTreatmentForm>[];

  treatmentSearchTerm = model<string | Treatment | null>();
  treatmentSuggestions?: Treatment[];

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

    // Filters the treatment suggestions as the user types
    this.treatmentSearchTerm.subscribe((term) => {
      if (typeof term === 'string' || term === null) {
        this.searchTreatment(term);
      }
    });

    // this.bsModalRef.onHidden.subscribe(() => {
    //   this.savedTreatments.complete();
    // });
  }

  ngOnInit() {
    this.selectTooth(this.tooth());

    // Search for initial treatments to show suggestions
    // ahead of time, preventing the user from having to wait
    // for the first loading
    this.treatmentSearchTerm.set(null);
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

  selectTooth(tooth: Tooth) {
    const inputTooth = this.tooth();

    // If a tooth from the history is selected, save the current form state to restore it later
    if (
      this.selectedTooth?.odontogram === inputTooth.odontogram &&
      tooth.odontogram !== inputTooth.odontogram
    ) {
      this.tempTreatments = this.treatmentsForm.controls;
    }

    this.treatmentsForm.clear();

    if (tooth.odontogram === inputTooth.odontogram && this.tempTreatments) {
      this.treatmentsForm.controls = this.tempTreatments;
      this.treatmentsForm.enable();
      delete this.tempTreatments;
    } else {
      tooth.treatments?.forEach((treatment) =>
        this.addToothTreatment(treatment)
      );
    }

    this.selectedTooth = tooth;

    // Disable the form if a tooth from the history is selected
    if (tooth.odontogram !== inputTooth.odontogram) {
      this.treatmentsForm.disable();
    }
  }

  searchTreatment(searchTerm?: string | null | RegExp) {
    let regexSearchTerm;

    if (searchTerm != null) {
      regexSearchTerm = new RegExp(searchTerm, 'i');
    }

    this._treatmentServ
      .getList({ searchTerm: regexSearchTerm, limit: 10 })
      .subscribe((treatments: Treatment[]) => {
        this.treatmentSuggestions = treatments;
      });
  }

  displayTreatmentOption(treatment: Treatment) {
    return treatment?.name || '';
  }

  addTreatment(treatment: Treatment) {
    const tooth = this.tooth();

    this.addToothTreatment({
      odontogram: tooth.odontogram?.id,
      description: treatment.name,
      additionalInformation: treatment.description,
      treatment: treatment.id,
      teeth: [tooth.number],
      zones: [],
      status: ToothTreatmentStatus.PENDING,
      type: treatment.treatmentType || TreatmentType.STANDARD,
      groupTeeth: true,
    });
  }

  addToothTreatment(toothTreatment: ToothTreatment) {
    const group = new UntypedFormGroup({
      odontogram: new FormControl<string | undefined>(
        toothTreatment.odontogram
      ),
      treatment: new FormControl<string | undefined>(toothTreatment.treatment),
      groupTeeth: new FormControl<boolean>(toothTreatment.groupTeeth ?? true),
      teeth: new FormControl<(typeof TeethNumbers)[number][]>([
        ...toothTreatment.teeth,
      ]),
      zones: new FormControl<ToothZones[]>([...toothTreatment.zones]),
      status: new FormControl<ToothTreatmentStatus>(
        toothTreatment.status ?? ToothTreatmentStatus.PENDING
      ),
      type: new FormControl<TreatmentType>(
        toothTreatment.type ?? TreatmentType.STANDARD
      ),
      additionalInformation: new FormControl<string>(
        toothTreatment.additionalInformation ?? ''
      ),
    });

    this.treatmentsForm.push(group);

    if (
      toothTreatment.type === TreatmentType.EXTRACTION ||
      toothTreatment.type === TreatmentType.IMPLANT
    ) {
      this.toggleZone(group, ToothZones.ROOT);
    }

    return group;
  }

  toggleZone(treatment: FormGroup, zone: ToothZones) {
    const zones: ToothZones[] = treatment.get('zones')?.value;

    const index = zones.findIndex((currZone) => currZone === zone);

    if (index === -1) {
      zones.push(zone);
    } else {
      zones.splice(index, 1);
    }
  }

  setStatus(treatment: FormGroup, status: ToothTreatmentStatus) {
    treatment.get('status')?.setValue(status);
  }

  removeTreatment(index: number) {
    this.treatmentsForm.removeAt(index);
  }

  saveTooth() {
    const tooth = this.tooth();

    const treatments: ToothTreatment[] = [];

    for (const treatmentForm of this.treatmentsForm.controls) {
      treatments.push(mapFormToToothTreatment(treatmentForm));
    }

    this.toothConfirmedChanges.emit({ ...tooth, treatments });
  }
}
