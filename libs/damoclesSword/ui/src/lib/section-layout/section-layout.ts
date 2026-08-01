import { Component, input } from '@angular/core';
import { DoubleBorderedTitle } from '../double-bordered-title/double-bordered-title';
import { BorderAlignment } from '../enums/border-alignment';

@Component({
  selector: 'lib-damocles-sword-section-layout',
  imports: [DoubleBorderedTitle],
  templateUrl: './section-layout.html',
  styleUrl: './section-layout.scss',
})
export class SectionLayout {
  /** Already-translated title text; the parent component owns translation. */
  title = input<string | undefined>(undefined);
  borderAlignment = input(BorderAlignment.LEFT);
}
