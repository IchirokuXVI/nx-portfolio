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
  output,
  Signal,
  signal,
  untracked,
  ViewChild,
  ViewContainerRef,
} from '@angular/core';
import { outputToObservable, toObservable } from '@angular/core/rxjs-interop';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';
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
} from '@portfolio/odontogram/data-access';
import {
  Odontogram,
  Tooth,
  ToothTreatment,
  Treatment,
} from '@portfolio/odontogram/models';
import { LoadingIcon } from '@portfolio/shared/ui';
import { ObservableMap, WithRequired } from '@portfolio/shared/util';
import {
  combineLatest,
  debounceTime,
  filter,
  first,
  map,
  Observable,
  of,
  startWith,
  switchMap,
} from 'rxjs';
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
    MatDialogModule,
  ],
  templateUrl: './tooth-treatments-modal.html',
  styleUrls: ['./tooth-treatments-modal.scss'],
  providers: [],
})
export class ToothTreatmentsModal {
  readonly compReady = signal(false);

  readonly tooth = input.required<Tooth>();
  readonly prevTooth = signal<Tooth | null>(null);

  readonly toothConfirmedChanges = output<Tooth>();

  /**
   * Usado para cargar el historial del cliente
   */
  readonly client = input<string>();

  readonly selectedTooth = signal<Tooth | null>(null);

  toothHistory: Tooth[] = [];

  readonly treatments: ObservableMap<
    ComponentRef<ToothTreatmentDetailedForm>,
    Partial<ToothTreatment>
  > = new ObservableMap();

  readonly searchTreatment =
    input<(term: string | null | undefined) => Observable<Treatment[]>>();

  /**
   * Se guarda de forma temporal el formulario original
   * para no perder los cambios al cambiar en el historial
   */
  tempTreatments?: Partial<ToothTreatment>[];
  disableForms: Signal<boolean>;

  @ViewChild('historyBar') readonly historyBar?: ElementRef<HTMLDivElement>;
  @ViewChild('treatmentsContainer', { read: ViewContainerRef })
  readonly treatmentsContainer?: ViewContainerRef;

  private readonly _toothTreatmentServ = inject(ToothTreatmentMemory);
  private readonly _odontogramServ = inject(OdontogramMemory);

  private readonly _injector = inject(Injector);

  private readonly _translateServ = inject(RokuTranslatorService);

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

    // Disabled for now in favor of a Save button to avoid too many requests
    // and also to give the user more control over when to save and thus allow
    // to cancel changes more easily
    // Might work right away but it will make way more requests than it should
    // because the ObservableMap emits changes when a form is added
    // before it is even initialized
    const enableAutoSave = false;
    if (enableAutoSave) {
      const treatmentsAddedOrDeleted$ = this.treatments.onChange$.pipe(
        filter(({ type }) => type === 'add' || type === 'delete')
      );

      treatmentsAddedOrDeleted$
        .pipe(
          filter(() => !this.disableForms()),
          switchMap(() => {
            const comps = Array.from(this.treatments.keys());

            // combineLatest only emits when all observables emit at least once
            // so we use startWith to emit an initial value for each observable
            // this way we ensure that combineLatest emits even if some forms
            // have not been touched yet
            return combineLatest(
              comps.map((comp) =>
                outputToObservable(comp.instance.toothTreatmentChange).pipe(
                  startWith(undefined)
                )
              )
            ).pipe(
              debounceTime(250) // wait until silence across all streams
            );
          })
        )
        .subscribe((treatments) => {
          // Request a save for the changed treatments...
        });
    }
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

    let treatmentsToAdd: Partial<ToothTreatment>[];

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

  addToothTreatment(toothTreatment?: Partial<ToothTreatment>) {
    if (!this.treatmentsContainer) {
      throw new Error(
        'Treatments container was not found. Maybe it was not rendered yet.'
      );
    }

    const teeth = toothTreatment ? toothTreatment.teeth : [];

    if (!toothTreatment?.teeth?.includes(this.tooth().number)) {
      teeth?.push(this.tooth().number);
    }

    const comp = this.treatmentsContainer.createComponent(
      ToothTreatmentDetailedForm
    );

    const formattedTreatment: Partial<ToothTreatment> = {
      ...toothTreatment,
      teeth,
      odontogram: this.tooth().odontogram?.id,
    };

    comp.setInput('disabled', this.disableForms());
    comp.setInput('toothTreatment', formattedTreatment);
    comp.setInput('disabledTeeth', this.tooth().number);

    comp.instance.deleteTreatment.subscribe(() => {
      this.treatments.delete(comp);
      comp.destroy();
    });

    comp.instance.searchTreatmentSuggestions.subscribe((searchTerm) => {
      if (!this.searchTreatment()) return;

      this.searchTreatment()?.(searchTerm).subscribe((treatments) => {
        comp.setInput('treatmentSuggestions', treatments);
      });
    });

    this.treatments.set(comp, formattedTreatment);

    comp.instance.toothTreatmentChange.subscribe((toothTreatment) => {
      this.treatments.set(comp, toothTreatment);
    });
  }

  saveTooth() {
    const tooth = this.tooth();

    const treatments: ToothTreatment[] = Array.from(
      this.treatments.values()
    ) as ToothTreatment[];

    this.toothConfirmedChanges.emit({ ...tooth, treatments });
  }
}
