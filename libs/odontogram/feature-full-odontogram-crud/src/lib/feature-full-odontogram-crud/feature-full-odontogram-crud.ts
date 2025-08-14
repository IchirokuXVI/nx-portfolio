import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OdontogramSectorsView } from '@portfolio/odontogram/ui';

@Component({
  selector: 'lib-odontogram-feature-full-odontogram-crud',
  imports: [CommonModule, OdontogramSectorsView],
  templateUrl: './feature-full-odontogram-crud.html',
  styleUrl: './feature-full-odontogram-crud.scss',
})
export class OdontogramFeatureFullOdontogramCrud {}
