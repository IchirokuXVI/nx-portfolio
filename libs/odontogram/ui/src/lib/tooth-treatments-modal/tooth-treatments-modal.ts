import { Component, computed, ElementRef, inject, input, OnInit, Signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Odontogram, TeethNumbers, Tooth, ToothTreatment, ToothZones, Treatment, ToothTreatmentStatus, TreatmentType } from '@portfolio/odontogram/models';
import { FormArray, FormControl, FormGroup, FormsModule, ReactiveFormsModule, UntypedFormArray, UntypedFormGroup } from '@angular/forms';
import { map, of, Subject, switchMap } from 'rxjs';
import { OdontogramMemory, ToothTreatmentMemory, TreatmentMemory } from '@portfolio/odontogram/data-access';
import { WithRequired } from '@portfolio/shared/util';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { SingleToothImage } from '../single-tooth-image/single-tooth-image';

@Component({
  selector: 'lib-tooth-treatments-modal',
  imports: [CommonModule, SingleToothImage, FormsModule, ReactiveFormsModule, MatExpansionModule, MatFormFieldModule, MatIconModule, MatAutocompleteModule],
  templateUrl: './tooth-treatments-modal.html',
  styleUrls: ['./tooth-treatments-modal.scss'],
  providers: []
})
export class ToothTreatmentModal implements OnInit {
  tooth = input.required<Tooth>();

  /**
   * Usado para cargar el historial del cliente
   */
  client = input<string>();

  selectedTooth?: Tooth;

  toothHistory: Tooth[] = [];
  hideHistory = true;

  form: UntypedFormGroup;
  get treatments() {
    return this.form.get('treatments') as FormArray;
  }

  /**
   * Se guarda de forma temporal el formulario original
   * para no perder los cambios al cambiar en el historial
   */
  tempTreatments?: ToothTreatment[];

  treatmentSearchTerm?: string;
  treatmentSuggestions?: Treatment[];

  teeth: Signal<{ number: string, disabled: boolean }[]>;

  private savedTreatments: Subject<ToothTreatment[]> = new Subject();
  savedTreatments$ = this.savedTreatments.asObservable();

  @ViewChild('historyBar') historyBar?: ElementRef<HTMLDivElement>;

  private _treatmentServ = inject(TreatmentMemory);
  private _toothTreatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);

  constructor() {
    this.form = new UntypedFormGroup({
      treatments: new UntypedFormArray([])
    });

    this.teeth = computed(() =>
      TeethNumbers.map((toothNumber) =>
        ({ number: toothNumber, disabled: toothNumber == this.tooth().number })
      )
    );

    // this.bsModalRef.onHidden.subscribe(() => {
    //   this.savedTreatments.complete();
    // });
  }

  ngOnInit() {
    this.selectTooth(this.tooth());
  }

  async toggleHistory() {
    const clientId = this.client();

    if (clientId && this.hideHistory) {
      this.loadHistory().subscribe(() => {
        setTimeout(() => {
          this.hideHistory = false;
          this.historyBar?.nativeElement.scrollTo({ left: this.historyBar.nativeElement.scrollWidth });
        }, 0);
      });
    } else {
      this.hideHistory = true;
    }
  }

  loadHistory() {
    if (this.toothHistory && this.toothHistory.length) return of(this.toothHistory);

    const client = this.client();

    if (!client) {
      return of([this.tooth()]);
    }

    return this._toothTreatmentServ.getList({ teeth: [this.tooth().number], client }).pipe(
      map((treatments) => treatments.filter((treatment) => treatment.odontogram !== undefined) as WithRequired<ToothTreatment, 'odontogram'>[]),
      switchMap((historicalTreatments) => {
        // Using a set in case the same odontogram appears multiple times
        // because a tooth could have multiple treatments in the same odontogram
        const ids: Set<string> = new Set();

        for (const treatment of historicalTreatments) {
          ids.add(treatment.odontogram);
        }

        const odontogramsRequest = this._odontogramServ.getList({ ids: Array.from(ids) }).pipe(
          map((historicalOdontograms) => {
            const treatmentsByOdontogram = new Map<Odontogram, ToothTreatment[]>();

            for (const odontogram of historicalOdontograms.sort((a, b) => (a.effectiveDate?.getTime() || a.createdAt?.getTime() || 0) - (b.effectiveDate?.getTime() || b.createdAt?.getTime() || 0))) {
              treatmentsByOdontogram.set(odontogram, historicalTreatments.filter(treatment => treatment.odontogram === odontogram.id));
            }

            return treatmentsByOdontogram;
          })
        );

        return odontogramsRequest;
      }),
      map((treatmentsByOdontogram) => {
        const inputTooth = this.tooth();

        for (const [odontogram, treatments] of treatmentsByOdontogram.entries()) {
          this.toothHistory.push({ odontogram, number: inputTooth.number, treatments });
        }

        if (!inputTooth.treatments || !inputTooth.treatments.length || !inputTooth.odontogram) {
          this.toothHistory.push(structuredClone(inputTooth));
        }

        return this.toothHistory;
      })
    )
  }

  selectTooth(tooth: Tooth) {
    const inputTooth = this.tooth();

    // If a tooth from the history is selected, save the current form state to restore it later
    if (this.selectedTooth?.odontogram === inputTooth.odontogram && tooth.odontogram !== inputTooth.odontogram) {
      this.tempTreatments = this.treatments.value;
    }

    let treatments: ToothTreatment[] | undefined;

    if (tooth.odontogram === inputTooth.odontogram && this.tempTreatments) {
      treatments = this.tempTreatments;
      this.treatments.enable();
      delete this.tempTreatments;
    } else {
      treatments = tooth.treatments;
    }

    this.treatments.clear();
    this.selectedTooth = tooth;

    treatments?.forEach((treatment) => this.addToothTreatment(treatment));

    // Disable the form if a tooth from the history is selected
    if (tooth.odontogram !== inputTooth.odontogram)
      this.treatments.disable();
  }


  searchTreatment(searchTerm: string) {
    this._treatmentServ.getList({ searchTerm: searchTerm, limit: 10 })
      .subscribe((treatments: Treatment[]) => {
        this.treatmentSuggestions = treatments;
      });
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
      groupTeeth: true
    });

    this.treatmentSearchTerm = '';
  }

  addToothTreatment(toothTreatment: ToothTreatment) {
    const group = new UntypedFormGroup({
      odontogram: new FormControl<string | undefined>(toothTreatment.odontogram),
      treatment: new FormControl<string | undefined>(toothTreatment.treatment),
      groupTeeth: new FormControl<boolean>(toothTreatment.groupTeeth ?? true),
      teeth: new FormControl<(typeof TeethNumbers[number])[]>([...toothTreatment.teeth]),
      zones: new FormControl<ToothZones[]>([...toothTreatment.zones]),
      status: new FormControl<ToothTreatmentStatus>(toothTreatment.status ?? ToothTreatmentStatus.PENDING),
      type: new FormControl<TreatmentType>(toothTreatment.type ?? TreatmentType.STANDARD),
      additionalInformation: new FormControl<string>(toothTreatment.additionalInformation ?? ''),
    });

    this.treatments.push(group);

    if (toothTreatment.type === TreatmentType.EXTRACTION || toothTreatment.type === TreatmentType.IMPLANT) {
      this.toggleZone(group, ToothZones.ROOT);
    }

    return group;
  }

  toggleZone(treatment: FormGroup, zone: ToothZones) {
    const zones: ToothZones[] = treatment.get('zones')?.value;

    const index = zones.findIndex((currZone) => currZone === zone);

    if (index === -1) {
      zones.push(zone)
    } else {
      zones.splice(index, 1)
    }
  }

  setStatus(treatment: FormGroup, status: ToothTreatmentStatus) {
    treatment.get('status')?.setValue(status);
  }

  saveTooth() {
    const tooth = this.tooth();

    this._treatmentServ.create({ odontogram: tooth.odontogram?.id, number: tooth.number, ...this.treatments.value }).subscribe(() => {
      this.savedTreatments.next(this.treatments.value);
    });
  }

  removeTreatment(index: number) {
    this.treatments.removeAt(index);
  }

  get toothZones() {
    return ToothZones;
  }
}
