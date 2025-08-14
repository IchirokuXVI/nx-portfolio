import { Component, inject, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tooth, Odontogram, ToothTreatment, TeethNumbers } from '@portfolio/odontogram/models';
import { Product } from '@portfolio/shared/models';
import { BehaviorSubject, filter, Observable, Subject } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { NgLetDirective } from '@portfolio/shared/util';
import { LoadingNotifier } from '@portfolio/shared/util';
import { SingleToothImage } from "../single-tooth-image/single-tooth-image";
import { LoadingIcon } from '@portfolio/shared/ui';

export const loadable = ['teeth', 'image'] as const;

@Component({
  selector: 'lib-odontogram-sectors-view',
  standalone: true,
  imports: [CommonModule, FormsModule, NgLetDirective, SingleToothImage, LoadingIcon],
  templateUrl: './odontogram-sectors-view.html',
  styleUrl: './odontogram-sectors-view.scss',
  providers: [
    { provide: LoadingNotifier.LOADABLE_ENTRIES, useValue: loadable },
    LoadingNotifier
  ],
})
export class OdontogramSectorsView implements OnInit {
  pediatricSectors = [4, 5, 6, 7];

  // The array position is also the identifier of each sector
  // Sectors 0-3 are for adults, 4-7 are for pediatric use
  // Amount of teeth in each sector (8 for adults, 5 for pediatrics)
  sectors = [8, 8, 8, 8, 5, 5, 5, 5];
  maxTeethNumber = Math.max(...this.sectors);

  // Turns the array into a map for easier access when using conditions
  // on the template (ngIf, styles...)
  // The key of the map will be the tooth number (11-18, 21-28, 31-38...)
  public teeth: { [key: number]: Tooth } = {};

  private _odontogram = new BehaviorSubject<Odontogram | undefined>(undefined);
  odontogram$: Observable<Odontogram | undefined> = this._odontogram.asObservable();
  @Input() set odontogram(odontogram: Odontogram) {
    this._odontogram.next(odontogram);
  }
  @Output() odontogramChange: Observable<Odontogram | undefined> = this.odontogram$;

  productSuggestions: Product[] = [];
  productSearchTerm?: string;

  @Input() treatments?: ToothTreatment[];
  @Output() treatmentsOnChange: Subject<ToothTreatment[]> = new Subject();

  @Input() showPediatricCheckbox = false;
  @Input() showPediatricSectors = true;
  @Output() showPediatricSectorsChange: Subject<boolean> = new BehaviorSubject(this.showPediatricSectors);

  @Output() toothSelected: Subject<Tooth> = new Subject();

  public loadingNotf: LoadingNotifier<typeof loadable> = inject(LoadingNotifier);

  ngOnInit() {
    this.formatTeeth();

    this.odontogram$.pipe(filter((odont) => odont !== undefined)).subscribe((odontogram) => {
      for (const tooth of Object.values(this.teeth)) {
        tooth.odontogram = odontogram.id;
      }
    });

    this.loadingNotf.loadings$.image?.subscribe((a) => {
      console.log('loading image', a)
    })
  }

  private formatTeeth() {
    this.loadingNotf.startLoading('teeth')

    for (let i = 0; i < this.sectors.length; i++) {
      for (let j = 0; j < this.sectors[i]; j++) {
        const teethNumb = ((i + 1).toString() + (j + 1).toString()) as typeof TeethNumbers[number];

        this.teeth[teethNumb] = {
          number: teethNumb,
          treatments: [],
        };
      }
    }

    this.loadingNotf.completeLoading('teeth')
  }

  switchPediatricSectors(state: boolean) {
    this.showPediatricSectors = state;
    this.showPediatricSectorsChange.next(state);
  }

  selectTooth(tooth: Tooth) {
    this.toothSelected.next(tooth);
  }

  get displayedSectors() {
    return this.sectors.map((_val, i) => i).filter((_val, i) => this.showPediatricSectors || !this.pediatricSectors.includes(i))
  }
}
