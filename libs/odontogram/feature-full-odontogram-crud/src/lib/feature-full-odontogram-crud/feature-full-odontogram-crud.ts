import { CommonModule } from '@angular/common';
import { Component, inject, OnInit } from '@angular/core';
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
  OdontogramSectorsView,
  ToothTreatmentsModal,
} from '@portfolio/odontogram/ui';

@Component({
  selector: 'lib-odontogram-feature-full-odontogram-crud',
  imports: [CommonModule, OdontogramSectorsView],
  templateUrl: './feature-full-odontogram-crud.html',
  styleUrl: './feature-full-odontogram-crud.scss',
})
export class OdontogramFeatureFullOdontogramCrud implements OnInit {
  private _treatmentServ = inject(TreatmentMemory);
  private _toothTreatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);
  private _dialog = inject(MatDialog);

  odontograms?: Odontogram[];
  treatments?: ToothTreatment[];

  selectedOdontogram?: Odontogram;

  ngOnInit() {
    this._odontogramServ.getList().subscribe((odontograms) => {
      this.odontograms = odontograms;

      this.selectedOdontogram = odontograms[2];

      this._toothTreatmentServ
        .getList({ odontogram: this.selectedOdontogram?.id })
        .subscribe((treatments) => {
          this.treatments = treatments;
        });
    });
  }

  onToothSelected(tooth: Tooth) {
    const ref = this._dialog.open(ToothTreatmentsModal, {
      maxWidth: '920px',
      width: '920px',
      minWidth: '340px',
    });

    ref.componentRef?.setInput('tooth', tooth);
    ref.componentRef?.setInput('client', '1');
  }

  searchTreatments(searchTerm?: string | null | RegExp) {
    let regexSearchTerm;

    if (searchTerm != null) {
      regexSearchTerm = new RegExp(searchTerm, 'i');
    }

    this._treatmentServ
      .getList({ searchTerm: regexSearchTerm, limit: 10 })
      .subscribe((treatments: Treatment[]) => {
        // Somehow return this data to the autocomplete like 2 levels below
      });
  }
}
