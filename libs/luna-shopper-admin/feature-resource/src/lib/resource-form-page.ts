import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { ResourceFormStore } from '@portfolio/luna-shopper-admin/data-access';
import {
  CONTENT_LOCALES,
  isEditable,
  toCell,
  type FieldMessage,
  type FormMode,
  type ResourceCell,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  ConfirmDialog,
  ResourceForm,
  type FieldChange,
} from '@portfolio/luna-shopper-admin/ui';
import { gatewayErrorKey } from './gateway-error-key';
import { ResourceReferences } from './resource-registry';
import {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_PARAM,
} from './resource-route-data';

/**
 * The create and edit screen, for every resource (plan 0004, section 5).
 *
 * One component for both, because they are the same act from a different
 * starting point, and one route factory declares both. It is also the detail
 * view: fields the descriptor marks not editable render as text beside the ones
 * that do, so opening a row shows everything it holds rather than only the parts
 * that can change.
 *
 * Leaving with unsaved work asks first. That is the only thing on this screen
 * the operator cannot undo, since a refused submit keeps everything typed and a
 * successful one is on the server.
 */
@Component({
  selector: 'lib-resource-form-page',
  imports: [ResourceForm, ConfirmDialog, RokuTranslatorPipe],
  template: `
    @if (store.status() === 'loading') {
      <p class="state" role="status">{{ 'resource.form.loading' | rokuT }}</p>
    } @else if (store.status() === 'error') {
      <p class="state error" role="alert">{{ errorKey() | rokuT }}</p>
    } @else {
      <lib-resource-form
        (leave)="leave()"
        (save)="submit()"
        (valueChange)="change($event)"
        [busy]="store.busy()"
        [draft]="store.draft()"
        [errorKey]="bannerKey()"
        [fields]="descriptor.fields"
        [lookup]="references"
        [messages]="messages()"
        [mode]="mode"
        [readonlyCells]="readonlyCells()"
        [strayErrors]="store.strayErrors()"
        [subtitle]="subtitle()"
        [titleArgs]="titleArgs()"
        [titleKey]="titleKey()"
      />
    }

    @if (confirmingLeave()) {
      <lib-confirm-dialog
        (confirm)="goBack()"
        (dismiss)="confirmingLeave.set(false)"
        bodyKey="resource.confirm.discard.body"
        confirmKey="resource.confirm.discard.confirm"
        headingKey="resource.confirm.discard.heading"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    .state {
      padding: var(--admin-space-6);
      border: 1px dashed var(--admin-border);
      border-radius: var(--admin-radius);
      color: var(--admin-ink-muted);
    }

    .state.error {
      border-style: solid;
      border-color: var(--admin-danger);
      background: var(--admin-danger-wash);
      color: var(--admin-ink);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResourceFormPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _translator = inject(RokuTranslatorService);

  readonly references = inject(ResourceReferences);

  readonly descriptor = this._route.snapshot.data[RESOURCE_DESCRIPTOR];

  readonly mode: FormMode =
    this._route.snapshot.data[RESOURCE_FORM_MODE] === 'create'
      ? 'create'
      : 'edit';

  private readonly _id =
    this._route.snapshot.paramMap.get(RESOURCE_ID_PARAM) ?? null;

  readonly store = new ResourceFormStore<ResourceRow>(
    this.descriptor,
    this.descriptor.gateway(),
    this.mode,
    this._id
  );

  /** Whether the operator has been asked about losing what they typed. */
  readonly confirmingLeave = signal(false);

  readonly titleKey = computed(() =>
    this.mode === 'create' ? 'resource.form.create' : 'resource.form.edit'
  );

  /**
   * The resource's singular name, translated here rather than in the template.
   *
   * The heading is one key for every entity, so the entity's own name has to
   * arrive as a string: a pipe cannot resolve a key that is the argument of
   * another key.
   */
  readonly titleArgs = computed(() => ({
    name: this._translator.t(this.descriptor.labels.one),
  }));

  /** What this row is called, once it has been read. */
  readonly subtitle = computed(() => {
    const row = this.store.row();
    return row === null ? null : this.descriptor.title(row);
  });

  readonly messages = computed<
    Readonly<Record<string, readonly FieldMessage[]>>
  >(() => {
    const messages: Record<string, readonly FieldMessage[]> = {};
    for (const field of this.descriptor.fields) {
      const forField = this.store.messagesFor(field.name);
      if (forField.length > 0) {
        messages[field.name] = forField;
      }
    }
    return messages;
  });

  /** The fields the form only shows, already formatted. */
  readonly readonlyCells = computed<Readonly<Record<string, ResourceCell>>>(
    () => {
      const row = this.store.row();
      if (row === null) {
        return {};
      }

      const options = {
        locale: this._translator.locale(),
        contentLocales: CONTENT_LOCALES,
      };
      const cells: Record<string, ResourceCell> = {};
      for (const field of this.descriptor.fields) {
        if (!isEditable(field, this.mode)) {
          cells[field.name] = toCell(field, row, options);
        }
      }
      return cells;
    }
  );

  /**
   * The banner, for a failure that belongs to no field.
   *
   * A refusal the server explained per field is **not** shown here: those are
   * under their inputs, and repeating them at the top would say the same thing
   * twice while burying the second copy.
   */
  readonly bannerKey = computed(() => {
    const error = this.store.error();
    if (error === null) {
      return null;
    }
    return Object.keys(error.fieldErrors).length > 0
      ? null
      : gatewayErrorKey(error);
  });

  readonly errorKey = computed(() => gatewayErrorKey(this.store.error()));

  constructor() {
    void this.store.load();
  }

  change(event: FieldChange): void {
    this.store.set(event.name, event.value);
  }

  async submit(): Promise<void> {
    const saved = await this.store.submit();
    if (saved !== null) {
      this.goBack();
    }
  }

  /** Cancel: straight back, unless there is something to lose. */
  leave(): void {
    if (this.store.dirty()) {
      this.confirmingLeave.set(true);
      return;
    }
    this.goBack();
  }

  /**
   * Back to the list.
   *
   * A navigation to the list's URL rather than a history pop. The form can be
   * arrived at from a link or a reload, where popping would leave the app
   * entirely, and the list is one segment up in every case because the route
   * factory says so.
   */
  goBack(): void {
    void this._router.navigate(['..'], { relativeTo: this._route });
  }
}
