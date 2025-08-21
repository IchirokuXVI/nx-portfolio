import { Component, computed, ElementRef, inject, input, OnInit, Signal, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Odontogram, TeethNumbers, Tooth, ToothTreatment, ToothZones, Treatment, TreatmentStatus, TreatmentType } from '@portfolio/odontogram/models';
import { FormArray, FormControl, FormGroup, UntypedFormArray, UntypedFormGroup } from '@angular/forms';
import { Product } from '@portfolio/shared/models';
import { map, of, Subject, switchMap } from 'rxjs';
import { OdontogramMemory, TreatmentMemory } from '@portfolio/odontogram/data-access';
import { WithRequired } from '@portfolio/shared/util';

@Component({
  selector: 'lib-tooth-treatments-modal',
  imports: [CommonModule],
  templateUrl: './tooth-treatments-modal.html',
  styleUrls: ['./tooth-treatments-modal.scss'],
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

  productSearchTerm?: string;
  productSuggestions?: Product[];

  teeth: Signal<{ number: string, disabled: boolean }[]>;

  private savedTreatments: Subject<ToothTreatment[]> = new Subject();
  savedTreatments$ = this.savedTreatments.asObservable();

  @ViewChild('historyBar') historyBar?: ElementRef<HTMLDivElement>;

  private _productServ = inject(ProductService);
  private _treatmentServ = inject(TreatmentMemory);
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

    return this._treatmentServ.getList({ teeth: [this.tooth().number], client }).pipe(
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

    treatments?.forEach((treatment) => this.addTreatment(treatment));

    // Disable the form if a tooth from the history is selected
    if (tooth.odontogram !== inputTooth.odontogram)
      this.treatments.disable();
  }


  searchProduct(searchTerm: string) {
    this._productServ.getProductos({ searchTerm: searchTerm, limit: 10 })
      .subscribe((products: Product[]) => {
        this.productSuggestions = products;
      });
  }

  addTreatment(treatment: Treatment) {
    const tooth = this.tooth();

    const treatmentForm = this.addToothTreatment({
      odontogram: tooth.odontogram?.id,
      description: treatment.name,
      additionalInformation: treatment.description,
      treatment: treatment.id,
      teeth: [tooth.number],
      zones: [],
      status: TreatmentStatus.PENDING,
      type: treatment.treatmentType || TreatmentType.STANDARD,
      groupedTeeth: true
    });

    if (treatment.treatmentType === TreatmentType.EXTRACTION || treatment.treatmentType === TreatmentType.IMPLANT) {
      this.toggleZone(treatmentForm, ToothZones.ROOT);
    }

    this.productSearchTerm = '';
  }

  addToothTreatment(toothTreatment: ToothTreatment) {
    const group = new UntypedFormGroup({
      odontogram: new FormControl(toothTreatment.odontogram),
      treatment: new FormControl(toothTreatment.treatment),
      groupedTeeth: new FormControl(toothTreatment.groupedTeeth ?? true),
      teeth: new FormControl([...toothTreatment.teeth]),
      zones: new FormControl([...toothTreatment.zones]),
      status: new FormControl(toothTreatment.status ?? 'pending'),
      type: new FormControl(toothTreatment.type ?? TreatmentType.STANDARD),
      additionalInformation: new FormControl(toothTreatment.additionalInformation ?? ''),
    });

    this.treatments.push(group);

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

  setStatus(treatment: FormGroup, status: TreatmentStatus) {
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
