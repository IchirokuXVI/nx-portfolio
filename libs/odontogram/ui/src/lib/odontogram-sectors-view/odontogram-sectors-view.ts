import {
  Component,
  computed,
  effect,
  inject,
  input,
  Input,
  model,
  OnInit,
  output,
  Output,
  Signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Tooth,
  Odontogram,
  ToothTreatment,
  TeethNumbers,
} from '@portfolio/odontogram/models';
import { Product } from '@portfolio/shared/models';
import { BehaviorSubject, filter, Observable, Subject } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { NgLetDirective } from '@portfolio/shared/util';
import { LoadingNotifier } from '@portfolio/shared/util';
import { SingleToothImage } from '../single-tooth-image/single-tooth-image';
import { LoadingIcon } from '@portfolio/shared/ui';

export const loadable = ['teeth', 'image'] as const;

@Component({
  selector: 'lib-odontogram-sectors-view',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NgLetDirective,
    SingleToothImage,
    LoadingIcon,
  ],
  templateUrl: './odontogram-sectors-view.html',
  styleUrl: './odontogram-sectors-view.scss',
  providers: [
    { provide: LoadingNotifier.LOADABLE_ENTRIES, useValue: loadable },
    LoadingNotifier,
  ],
})
export class OdontogramSectorsView {
  pediatricSectors = [4, 5, 6, 7];

  // The array position is also the identifier of each sector
  // Sectors 0-3 are for adults, 4-7 are for pediatric use
  // Amount of teeth in each sector (8 for adults, 5 for pediatrics)
  sectors = [8, 8, 8, 8, 5, 5, 5, 5];
  maxTeethNumber = Math.max(...this.sectors);

  // Turns the array into a map for easier access when using conditions
  // on the template (ngIf, styles...)
  // The key of the map will be the tooth number (11-18, 21-28, 31-38...)
  public teeth: Signal<{ [key: number]: Tooth }>;

  odontogram = model<Odontogram | undefined>();

  treatments = model.required<ToothTreatment[]>();

  showPediatricCheckbox = input(false);
  showPediatricSectors = model(false);
  displayedSectors: Signal<number[]>;

  toothSelected = output<Tooth>();

  public loadingNotf: LoadingNotifier<typeof loadable> =
    inject(LoadingNotifier);

  constructor() {
    this.teeth = computed(() => {
      return this.formatTeeth(this.treatments());
    });

    effect(() => {
      const odont = this.odontogram();

      if (odont) {
        for (const tooth of Object.values(this.teeth())) {
          tooth.odontogram = odont;
        }
      }
    });

    this.displayedSectors = computed(() => {
      const showPediatric = this.showPediatricSectors();

      return this.sectors
        .map((_val, i) => i)
        .filter(
          (_val, i) => showPediatric || !this.pediatricSectors.includes(i)
        );
    });
  }

  private formatTeeth(treatments: ToothTreatment[]) {
    this.loadingNotf.startLoading('teeth');

    const teeth: { [key: number]: Tooth } = {};

    for (let i = 0; i < this.sectors.length; i++) {
      for (let j = 0; j < this.sectors[i]; j++) {
        const teethNumb = ((i + 1).toString() +
          (j + 1).toString()) as (typeof TeethNumbers)[number];

        teeth[teethNumb] = {
          number: teethNumb,
          treatments:
            treatments?.filter((treatment) =>
              treatment.teeth.includes(teethNumb)
            ) || [],
        };
      }
    }

    this.loadingNotf.completeLoading('teeth');

    return teeth;
  }

  switchPediatricSectors(state: boolean) {
    this.showPediatricSectors.set(state);
  }

  selectTooth(tooth: Tooth) {
    this.toothSelected.emit(tooth);
  }
}
