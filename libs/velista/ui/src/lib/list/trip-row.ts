import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { TripRowVm } from '@portfolio/velista/models';
import { CheckIcon, XCircleIcon } from '../icons/icons';

/**
 * One line as one trip left it (velista `0088`, section 5). **Read only.**
 *
 * A trip row is a fact about a trip, so its numbers never follow the line: the one
 * place the live quantity changes is To buy. Where a line row carries its reel, this
 * carries what the trip left, and under it what the trip bought.
 *
 * The row is a button, because a tap opens the line detail sheet exactly as a line row
 * does. Its name is the line, then the outcome, then the numbers in words (section 10).
 */
@Component({
  selector: 'lib-trip-row',
  imports: [RokuTranslatorPipe, CheckIcon, XCircleIcon],
  template: `
    @let vm = row();
    <button
      (click)="opened.emit(vm.lineId)"
      [attr.aria-label]="
        vm.content +
        ', ' +
        (markKey() | rokuT: markArgs()) +
        ', ' +
        ('list.trips.row.left' | rokuT: { count: vm.left ?? 0 }) +
        ', ' +
        (numbersKey() | rokuT: numbersArgs())
      "
      [attr.data-line-id]="vm.lineId"
      [class.quiet]="vm.quiet"
      class="row"
      type="button"
    >
      <span class="body">
        <span class="content">{{ vm.content }}</span>
        <span aria-hidden="true" class="marks">
          <span [class]="'mark mark-' + vm.mark">
            @switch (vm.mark) {
              @case ('bought') {
                <lib-check-icon class="glyph" />
              }
              @case ('partly') {
                <lib-check-icon class="glyph" />
              }
              @case ('notAvailable') {
                <lib-x-circle-icon class="glyph" />
              }
              @case ('claimed') {
                <span class="dot"></span>
              }
            }
            {{ markKey() | rokuT: markArgs() }}
          </span>
          @if (vm.nowAsks !== null) {
            <span class="now-asks">
              {{ 'list.trips.row.nowAsks' | rokuT: { count: vm.nowAsks } }}
            </span>
          }
        </span>
      </span>

      <span aria-hidden="true" class="tally">
        <span [class.zero]="(vm.left ?? 0) === 0" class="left">
          {{ vm.left ?? 0 }}
        </span>
        <span class="bought">{{ numbersKey() | rokuT: numbersArgs() }}</span>
      </span>
    </button>
  `,
  styleUrl: './trip-row.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TripRow {
  readonly row = input.required<TripRowVm>();

  /** A tap, which opens the line detail sheet. */
  readonly opened = output<string>();

  /** The outcome's words. A loose purchase names its buyer when one is known. */
  protected readonly markKey = computed(() => {
    const row = this.row();
    switch (row.mark) {
      case 'bought':
        return row.buyer === null
          ? 'line.indicator.bought'
          : 'list.trips.row.boughtBy';
      case 'partly':
        return 'list.trips.row.partly';
      case 'notAvailable':
        return 'list.trips.row.notAvailable';
      case 'claimed':
        return row.claimedBy === null
          ? 'line.indicator.claimed'
          : 'line.indicator.claimedBy';
      case 'notBought':
        return 'list.trips.row.notBought';
    }
  });

  protected readonly markArgs = computed(() => {
    const row = this.row();
    return { name: (row.mark === 'claimed' ? row.claimedBy : row.buyer) ?? '' };
  });

  /** "bought 3 of 6" on a basket row, "bought 3" on a loose one. */
  protected readonly numbersKey = computed(() =>
    this.row().asked === null
      ? 'list.trips.row.bought'
      : 'list.trips.row.boughtOf'
  );

  protected readonly numbersArgs = computed(() => {
    const row = this.row();
    return { bought: row.bought, asked: row.asked ?? 0 };
  });
}
