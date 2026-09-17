import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { ReferenceScope } from '@portfolio/luna-shopper-admin/models';
import {
  ReferencesControl,
  type ReferenceLookup,
} from '@portfolio/luna-shopper-admin/ui';

/** A sentence the form says about one list, as a key and its arguments. */
export interface CopyMessage {
  readonly key: string;
  readonly args?: Readonly<Record<string, string>>;
}

/**
 * The scopes one walked scope is copied to (admin plan 0029, section 3).
 *
 * Only drawing. Which additions are refused, and which targets conflict with a
 * ticked scope, is decided by the run form, because both questions are about
 * every list on the form and not about this one. The chip list is admin plan
 * 0028's, searching the chain's scopes of every tier as the operator types:
 * a copy target can be a shop scope, and a chain holds about 1,675 of those.
 */
@Component({
  selector: 'lib-scope-copies',
  imports: [RokuTranslatorPipe, ReferencesControl],
  template: `
    <span class="heading">
      @if (fromTitle() === '') {
        {{ 'harvest.runs.start.copies.heading' | rokuT }}
      } @else {
        {{ 'harvest.runs.start.copies.headingFor' | rokuT: { scope: fromTitle() } }}
      }
    </span>

    <lib-references-control
      (valueChange)="targetsChange.emit($event)"
      [controlId]="controlId()"
      [lookup]="lookup()"
      [resource]="'price-scopes'"
      [scope]="scope()"
      [value]="targets()"
    />

    @if (refusal(); as message) {
      <p class="refusal" role="alert">
        {{ message.key | rokuT: message.args ?? {} }}
      </p>
    }

    @for (conflict of conflicts(); track conflict) {
      <p class="refusal" role="alert">
        <strong>{{ conflict }}</strong>
        {{ 'harvest.runs.start.copies.walked' | rokuT }}
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      padding: var(--admin-space-3);
      border-inline-start: 2px solid var(--admin-border);
    }

    .heading {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    .refusal {
      font-size: 0.8125rem;
      color: var(--admin-danger-on-wash);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeCopies {
  readonly controlId = input.required<string>();
  /** The walked scope's name, or `''` where the form walks one scope. */
  readonly fromTitle = input('');
  readonly targets = input.required<readonly string[]>();
  readonly lookup = input.required<ReferenceLookup>();
  readonly scope = input.required<ReferenceScope>();
  /** The last addition the form refused, until the list changes. */
  readonly refusal = input<CopyMessage | null>(null);
  /** The names of targets that are also ticked as walked. */
  readonly conflicts = input<readonly string[]>([]);

  readonly targetsChange = output<readonly string[]>();
}
