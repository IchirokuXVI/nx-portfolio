import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  OdontogramSectorsView,
  ToothTreatmentsModal,
} from '@portfolio/odontogram/ui';
import {
  OdontogramMemory,
  ToothTreatmentMemory,
} from '@portfolio/odontogram/data-access';
import {
  Odontogram,
  Tooth,
  ToothTreatment,
} from '@portfolio/odontogram/models';
import { MatDialog } from '@angular/material/dialog';

@Component({
  selector: 'lib-odontogram-feature-full-odontogram-crud',
  imports: [CommonModule, OdontogramSectorsView],
  templateUrl: './feature-full-odontogram-crud.html',
  styleUrl: './feature-full-odontogram-crud.scss',
})
export class OdontogramFeatureFullOdontogramCrud implements OnInit {
  private _treatmentServ = inject(ToothTreatmentMemory);
  private _odontogramServ = inject(OdontogramMemory);
  private _dialog = inject(MatDialog);

  odontograms?: Odontogram[];
  treatments?: ToothTreatment[];

  selectedOdontogram?: Odontogram;

  ngOnInit() {
    this._odontogramServ.getList().subscribe((odontograms) => {
      this.odontograms = odontograms;

      this.selectedOdontogram = odontograms[2];

      this._treatmentServ
        .getList({ odontogram: this.selectedOdontogram?.id })
        .subscribe((treatments) => {
          this.treatments = treatments;
        });
    });
  }

  onToothSelected(tooth: Tooth) {
    const ref = this._dialog.open(ToothTreatmentsModal);

    ref.componentRef?.setInput('tooth', tooth);
    ref.componentRef?.setInput('client', '1');
  }
}
