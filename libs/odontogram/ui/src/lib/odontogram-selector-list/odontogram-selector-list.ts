import { CommonModule } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Odontogram } from '@portfolio/odontogram/models';
import { InPlaceCrud } from '@portfolio/shared/ui';

@Component({
  selector: 'lib-odontogram-selector-list',
  standalone: true,
  imports: [CommonModule, FormsModule, InPlaceCrud],
  templateUrl: './odontogram-selector-list.html',
  styleUrl: './odontogram-selector-list.scss',
  providers: [],
})
export class OdontogramSelectorList {
  odontograms = input.required<Odontogram[]>();

  selectedOdontogram = model<Odontogram | undefined>();

  trackByOdontogramId(index: number, odontogram: Odontogram) {
    return odontogram.id;
  }
}
