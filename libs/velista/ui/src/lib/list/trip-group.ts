import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { TripGroupVm } from '@portfolio/velista/models';
import { ChevronRightIcon } from '../icons/icons';
import { TripRow } from './trip-row';

/**
 * One shopping trip on the zone list, folded until somebody opens it (velista `0088`,
 * section 4).
 *
 * ## The disclosure pattern
 *
 * The label is a heading one level below the page title, and the heading wraps a real
 * button carrying `aria-expanded` and `aria-controls`. The count and the live words are
 * inside the button, so they are part of its name. The live dot is decoration.
 *
 * ## The fold
 *
 * The region animates `grid-template-rows` between `0fr` and `1fr` over
 * `--app-motion-slow`, and the caret turns a quarter. Both durations come from the
 * token, which is zero under `prefers-reduced-motion`. While closed the region is
 * `inert`, so nothing inside it takes focus or is read, and opening it moves neither
 * focus nor the scroll position.
 *
 * Until the rows arrive the region holds as many skeleton rows as the trip has lines, at
 * the line row's height, so the fold opens to its final height once.
 */
@Component({
  selector: 'lib-trip-group',
  imports: [RokuTranslatorPipe, ChevronRightIcon, TripRow],
  template: `
    @let vm = group();
    <section [class.live]="vm.live" class="group">
      <h2 class="heading">
        <button
          (click)="toggled.emit(vm.key)"
          [attr.aria-controls]="regionId()"
          [attr.aria-expanded]="vm.open"
          class="head"
          type="button"
        >
          <lib-chevron-right-icon aria-hidden="true" class="caret" />
          <span class="label">
            <span class="name">
              @if (vm.kind === 'SESSION') {
                {{
                  'list.trips.labelNamed'
                    | rokuT: { name: 'list.trips.loose' | rokuT, date: vm.date }
                }}
              } @else if (vm.name !== null) {
                {{
                  'list.trips.labelNamed'
                    | rokuT: { name: vm.name, date: vm.date }
                }}
              } @else {
                {{ vm.date }}
              }
            </span>
            @if (vm.live) {
              <span class="live-chip">
                <span aria-hidden="true" class="dot"></span>
                @if (vm.liveBy !== null) {
                  {{ 'list.trips.liveBy' | rokuT: { name: vm.liveBy } }}
                } @else {
                  {{ 'list.trips.live' | rokuT }}
                }
              </span>
            }
          </span>
          <span class="count">{{ vm.countKey | rokuT: vm.countArgs }}</span>
        </button>
      </h2>

      <div
        [attr.inert]="vm.open ? null : ''"
        [class.open]="vm.open"
        [id]="regionId()"
        class="fold"
      >
        <div class="inner">
          <ul class="rows">
            @if (vm.rows === null) {
              @for (placeholder of skeletons(); track $index) {
                <li aria-hidden="true" class="skeleton"></li>
              }
            } @else {
              @for (row of vm.rows; track row.lineId) {
                <li>
                  <lib-trip-row (opened)="opened.emit($event)" [row]="row" />
                </li>
              }
            }
          </ul>
        </div>
      </div>
    </section>
  `,
  styleUrl: './trip-group.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TripGroup {
  readonly group = input.required<TripGroupVm>();

  /** The head was pressed. The container owns what is open. */
  readonly toggled = output<string>();

  /** A row was tapped, which opens its line. */
  readonly opened = output<string>();

  protected readonly regionId = computed(
    () => `trip-${this.group().key.replace(/[^A-Za-z0-9_-]/g, '-')}`
  );

  /** `@for` needs something to iterate. The values are never read. */
  protected readonly skeletons = computed(() =>
    Array.from({ length: this.group().skeletonCount })
  );
}
