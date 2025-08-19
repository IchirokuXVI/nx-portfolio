import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OdontogramSectorsView } from '@portfolio/odontogram/ui';
import { TreatmentMemory } from '@portfolio/odontogram/data-access';
import { ToothTreatment } from '@portfolio/odontogram/models';

@Component({
  selector: 'lib-odontogram-feature-full-odontogram-crud',
  imports: [CommonModule, OdontogramSectorsView],
  templateUrl: './feature-full-odontogram-crud.html',
  styleUrl: './feature-full-odontogram-crud.scss',
})
export class OdontogramFeatureFullOdontogramCrud implements OnInit {
  private _treatmentServ = inject(TreatmentMemory);

  treatments?: ToothTreatment[];

  ngOnInit() {
    this._treatmentServ.getList().subscribe((treatments) => {
      this.treatments = treatments;
    });
  }
}
