import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { MapArea } from '@portfolio/luna-shopper/shop-map/model';
import { ThemeStore } from '@portfolio/velista/platform';
import { areaKindKey, areaName, swatchStyle } from './map-edits';

/**
 * The controls under a selected area (velista `0123`, target 4; the `EditCells`
 * board): its colour, its name and kind with "drag a corner to resize", Done,
 * and the "Snap to the squares" switch, off by default.
 *
 * It holds no page state: the host passes the area and the switch and reads
 * what was pressed, so the recording screen of velista `0126` shows the same
 * controls while walking. The name row opens the area's sheet.
 */
@Component({
  selector: 'lib-resize-controls',
  imports: [RokuTranslatorPipe],
  templateUrl: './resize-controls.html',
  styleUrl: './resize-controls.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResizeControls {
  /** The selected area. */
  readonly area = input.required<MapArea>();

  /** Whether corners snap to the half metre squares. */
  readonly snap = input(false);

  /** The switch was turned. */
  readonly snapChanged = output<boolean>();

  /** Done: the host clears the selection. */
  readonly finished = output<void>();

  /** The name row was tapped: the host opens the area's sheet. */
  readonly opened = output<void>();

  private readonly _theme = inject(ThemeStore).theme;

  protected readonly name = computed(() => areaName(this.area()));
  protected readonly kindKey = computed(() => areaKindKey(this.area()));
  protected readonly swatch = computed(() =>
    swatchStyle(this.area().colour, this.area().kind, this._theme())
  );

  protected toggled(event: Event): void {
    this.snapChanged.emit((event.target as HTMLInputElement).checked);
  }
}
