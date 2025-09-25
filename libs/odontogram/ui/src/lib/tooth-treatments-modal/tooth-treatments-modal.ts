import { CommonModule } from '@angular/common';
import {
  afterNextRender,
  Component,
  ComponentRef,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnInit,
  output,
  Signal,
  signal,
  untracked,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
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
import { LoadingIcon } from '@portfolio/shared/ui';
import { WithRequired } from '@portfolio/shared/util';
import { filter, first, map, of, ReplaySubject, switchMap } from 'rxjs';
import { SingleToothImage } from '../single-tooth-image/single-tooth-image';
import { ToothTreatmentDetailedForm } from '../tooth-treatment-detailed-form/tooth-treatment-detailed-form';

@Component({
  selector: 'lib-tooth-treatments-modal',
  imports: [
    CommonModule,
    SingleToothImage,
    FormsModule,
    RokuTranslatorPipe,
    ReactiveFormsModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatIconModule,
    MatAutocompleteModule,
    MatButtonToggleModule,
    MatSelectModule,
    MatInputModule,
    MatButtonModule,
    LoadingIcon,
  ],
  templateUrl: './tooth-treatments-modal.html',
  styleUrls: ['./tooth-treatments-modal.scss'],
  providers: [],
})
export class ToothTreatmentsModal implements OnInit {
  compReady = signal(false);

  tooth = input.required<Tooth>();
  prevTooth = signal<Tooth | null>(null);

  toothConfirmedChanges = output<Tooth>();

  /**
   * Usado para cargar el historial del cliente
   */
  client = input<string>();

  selectedTooth = signal<Tooth | null>(null);

  toothHistory: Tooth[] = [];

  treatments: Map<ComponentRef<ToothTreatmentDetailedForm>, ToothTreatment> =
    new Map();

  initialSuggestedTreatments: ReplaySubject<Treatment[]> = new ReplaySubject();

  /**
   * Se guarda de forma temporal el formulario original
   * para no perder los cambios al cambiar en el historial
   */
  tempTreatments?: ToothTreatment[];
  disableForms: Signal<boolean>;

  @ViewChild('historyBar') historyBar?: ElementRef<HTMLDivElement>;
  @ViewChild('treatmentsContainer', { read: ViewContainerRef })
  treatmentsContainer?: ViewContainerRef;

  private _treatmentServ = inject(TreatmentMemory);
  private _toothTreatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);

  private _injector = inject(Injector);

  private _translateServ = inject(RokuTranslatorService);

  constructor() {
    this._translateServ.loaded$.pipe(first()).subscribe(() => {
      this.compReady.set(true);
    });

    effect(() => {
      if (!this.compReady()) return;

      afterNextRender(
        () => {
          toObservable(this.compReady, { injector: this._injector })
            .pipe(
              filter((r) => r),
              first()
            )
            .subscribe(() => {
              const prevTooth = untracked(this.prevTooth);
              const selectedTooth = untracked(this.selectedTooth);

              if (!prevTooth || selectedTooth?.number === prevTooth?.number) {
                this.selectTooth(this.tooth());
              }

              this.prevTooth.set(selectedTooth);
            });
        },
        { injector: this._injector }
      );
    });

    this.disableForms = computed(
      () => this.tooth().odontogram !== this.selectedTooth()?.odontogram
    );
  }

  ngOnInit() {
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
    const currentSelectedTooth = untracked(this.selectedTooth);

    // Skip if the same tooth is selected
    if (
      newSelectedTooth === currentSelectedTooth ||
      (newSelectedTooth.odontogram === currentSelectedTooth?.odontogram &&
        newSelectedTooth.number === currentSelectedTooth?.number)
    ) {
      return;
    }

    // If a tooth from the history is selected, save the current forms state to restore it later
    if (
      currentSelectedTooth?.odontogram === originalTooth.odontogram &&
      newSelectedTooth.odontogram !== originalTooth.odontogram
    ) {
      this.tempTreatments = Array.from(this.treatments.values());
    }

    this.treatments.clear();
    this.treatmentsContainer?.clear();

    let treatmentsToAdd: ToothTreatment[];

    if (
      newSelectedTooth.odontogram === originalTooth.odontogram &&
      this.tempTreatments
    ) {
      treatmentsToAdd = this.tempTreatments;

      delete this.tempTreatments;
    } else {
      treatmentsToAdd = newSelectedTooth.treatments || [];
    }

    this.selectedTooth.set(newSelectedTooth);

    treatmentsToAdd.forEach((treatment) => {
      this.addToothTreatment(treatment);
    });
  }

  addToothTreatment(toothTreatment?: ToothTreatment) {
    if (!this.treatmentsContainer) {
      throw new Error(
        'Treatments container was not found. Maybe it was not rendered yet.'
      );
    }

    const comp = this.treatmentsContainer.createComponent(
      ToothTreatmentDetailedForm
    );

    comp.setInput('disabled', this.disableForms());
    comp.setInput('toothTreatment', toothTreatment);
    comp.setInput('disabledTeeth', this.tooth().number);

    comp.instance.deleteTreatment.subscribe(() => {
      this.treatments.delete(comp);
      comp.destroy();
    });

    comp.instance.toothTreatmentChange.subscribe((toothTreatment) => {
      this.treatments.set(comp, toothTreatment);
    });
  }

  saveTooth() {
    const tooth = this.tooth();

    const treatments: ToothTreatment[] = [];

    this.toothConfirmedChanges.emit({ ...tooth, treatments });
  }
}
