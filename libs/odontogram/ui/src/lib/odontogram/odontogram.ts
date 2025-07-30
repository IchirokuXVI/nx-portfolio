import { Component, Input, OnInit, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Tooth, Odontogram as OdontogramModel, ToothTreatment, TeethNumbers } from '@portfolio/odontogram/models';
import { Product } from '@portfolio/shared/models';
import { BehaviorSubject, filter, Observable, Subject } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'lib-odontogram',
  imports: [CommonModule],
  templateUrl: './odontogram.html',
  styleUrl: './odontogram.scss',
})
export class Odontogram implements OnInit {
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

  private _odontogram = new BehaviorSubject<OdontogramModel | undefined>(undefined);
  odontogram$ = this._odontogram.asObservable().pipe(takeUntilDestroyed());
  @Input() set odontogram(odontogram: OdontogramModel) {
    this._odontogram.next(odontogram);
  }
  @Output() odontogramChange: Observable<OdontogramModel | undefined> = this.odontogram$;

  productSuggestions: Product[] = [];
  productSearchTerm?: string;

  @Input() treatments?: ToothTreatment[];
  @Output() treatmentsOnChange: Subject<ToothTreatment[]> = new Subject();

  @Input() showPediatricCheckbox = true;
  @Input() showPediatricSectors = true;
  @Output() showPediatricSectorsChange: Subject<boolean> = new BehaviorSubject(this.showPediatricSectors);

  @Output() toothSelected: Subject<Tooth> = new Subject();

  ngOnInit() {
    this.formatTeeth();

    this.odontogram$.pipe(filter((odont) => odont !== undefined)).subscribe((odontogram) => {
      for (const tooth of Object.values(this.teeth)) {
        tooth.odontogram = odontogram.id;
      }
    });
  }

  private formatTeeth() {
    // this.loadingServ.startLoading('teeth')

    for (let i = 0; i < this.sectors.length; i++) {
      for (let j = 0; j < this.sectors[i]; j++) {
        const teethNumb = ((i + 1).toString() + (j + 1).toString()) as typeof TeethNumbers[number];

        this.teeth[teethNumb] = {
          number: teethNumb,
          treatments: [],
        };
      }
    }

    // this.loadingServ.completeLoading('teeth')
  }

  switchPediatricSectors(state: boolean) {
    this.showPediatricSectors = state;
    this.showPediatricSectorsChange.next(state);
  }

  selectTooth(tooth: Tooth) {
    this.toothSelected.next(tooth);
  }
}
