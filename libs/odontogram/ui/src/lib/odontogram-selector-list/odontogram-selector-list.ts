import { CommonModule } from '@angular/common';
import { Component, input, model } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { Odontogram } from '@portfolio/odontogram/models';

@Component({
  selector: 'lib-odontogram-selector-list',
  standalone: true,
  imports: [CommonModule, RokuTranslatorPipe],
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
