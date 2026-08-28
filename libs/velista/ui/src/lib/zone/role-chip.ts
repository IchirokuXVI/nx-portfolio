import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ZoneRole } from '@portfolio/velista/models';

/**
 * Somebody's role in a group, as a chip.
 *
 * `0003` drew this inline on the zone card, where it was one of two badges and not
 * worth a component. On the members screen it is on every row, so it becomes one; the
 * card keeps its own markup rather than being rewritten around this, because the two
 * differ in what sits beside them and merging them would give this component a variant
 * for each caller.
 *
 * **Never colour alone** (plan 0002, section 11 and plan 0003, section 7). Owner is
 * tinted and also says Owner, which is what a colourblind reader and a screen reader
 * both need. The tint is the amber attention role, matching the card, so the same
 * person reads the same colour in both places.
 *
 * The keys are written out per branch rather than built by appending the enum value to
 * a prefix. A key assembled at runtime cannot be found by grepping, which is how both a
 * translator's tooling and the next developer find them.
 */
@Component({
  selector: 'lib-role-chip',
  imports: [RokuTranslatorPipe],
  template: `
    @switch (role()) {
      @case ('OWNER') {
        <span class="chip chip-owner">{{ 'zone.role.owner' | rokuT }}</span>
      }
      @case ('ADMIN') {
        <span class="chip chip-admin">{{ 'zone.role.admin' | rokuT }}</span>
      }
      @default {
        <span class="chip">{{ 'zone.role.member' | rokuT }}</span>
      }
    }
  `,
  styleUrl: './role-chip.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleChip {
  readonly role = input.required<ZoneRole>();
}
