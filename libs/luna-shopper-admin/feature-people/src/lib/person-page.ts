import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import type {
  NamedAction,
  ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import {
  PageHeader,
  Viewport,
  type PageTab,
} from '@portfolio/luna-shopper-admin/ui';
import { PEOPLE_STYLES } from './people-styles';
import { ActionConfirm, ActionRunner, isDangerAction } from './row-actions';
import { PersonContext } from './shopper-contexts';
import {
  DETAILS_TAB,
  EDIT_SEGMENT,
  PERSON_PARAM,
  PERSON_ZONES_TAB,
} from './shopper-params';

/**
 * One person, as a page (admin plan 0045, target 3).
 *
 * The header says who, whether the account is registered or a guest, and
 * whether its address still waits to be confirmed. Under it are three tabs:
 * the account's details, the zones the person is in, and the shopping lists
 * they own.
 *
 * **The actions are the descriptor's.** "Resend confirmation" and "Delete
 * account" are the named actions `USERS` declares, drawn here and run through
 * {@link ActionRunner}. This page wrote its own copy of each once.
 *
 * **`displayName` is shown on the Details tab and not here.** It is whatever
 * an identity provider supplied, which for a Google sign in is a real full
 * name, so it is one deliberate press away from the list.
 */
@Component({
  selector: 'lib-person-page',
  imports: [
    PageHeader,
    RouterOutlet,
    RouterLink,
    ActionConfirm,
    RokuTranslatorPipe,
  ],
  providers: [PersonContext],
  template: `
    <lib-page-header
      [backLabel]="split() ? null : ('people.users.back' | rokuT)"
      [backLink]="listPath"
      [heading]="name() || ('resource.form.loading' | rokuT)"
      [tabs]="tabs()"
      [tabsLabel]="name()"
    >
      @if (person.row(); as row) {
        <span class="chip" pageChip data-kind>{{
          'people.users.kind.' + row.kind | rokuT
        }}</span>
      }
      @if (unconfirmed()) {
        <span class="chip waiting" pageChip data-unconfirmed>{{
          'people.users.state.unconfirmed' | rokuT
        }}</span>
      }
      <a [routerLink]="editPath()" class="button" pageMoreAction data-edit>{{
        'resource.action.edit' | rokuT
      }}</a>
      @for (action of available(); track action.name) {
        <button
          (click)="run(action)"
          [attr.data-action]="action.name"
          [class.danger]="isDanger(action)"
          [disabled]="actions.busy()"
          class="button"
          pageMoreAction
          type="button"
        >
          {{ action.label | rokuT }}
        </button>
      }
    </lib-page-header>

    @if (actions.errorKey(); as key) {
      <p class="refusal" role="alert">{{ key | rokuT }}</p>
    }

    @if (person.status() === 'error') {
      <p class="state error" role="alert">
        {{ person.errorKey() ?? 'resource.error.unknown' | rokuT }}
      </p>
    } @else {
      @for (key of keys(); track key) {
        <div class="body"><router-outlet /></div>
      }
    }

    <lib-action-confirm [runner]="actions" />
  `,
  styles: [
    PEOPLE_STYLES,
    `
      :host {
        gap: 0;
      }

      .body {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-inline-size: 0;
        padding-block-start: var(--admin-page-block);
      }

      .refusal,
      .state {
        margin-block-start: var(--admin-space-3);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _viewport = inject(Viewport);

  readonly person = inject(PersonContext);
  readonly actions = new ActionRunner();

  readonly split = this._viewport.split;

  /** The account's named actions, built once in this injection context. */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this._registry.byName('users')?.actions?.named?.() ?? [];

  /** Where the list of people is, for the way back on a narrow screen. */
  readonly listPath = this._registry.pathOf('users') ?? ['/'];

  /** The person as a one entry list, so that the template can key on it. */
  readonly keys = computed(() => {
    const id = this.person.id();
    return id === null ? [] : [id];
  });

  readonly name = computed(() => this.person.row()?.username ?? '');

  /** Whether the account has an address that nobody confirmed. */
  readonly unconfirmed = computed(() => {
    const row = this.person.row();
    return row !== null && row.email !== null && row.emailVerifiedAt === null;
  });

  /** The actions this account can have done to it right now. */
  readonly available = computed(() => {
    const row = this.person.row();
    return row === null
      ? []
      : this._named.filter((action) => action.available?.(row) ?? true);
  });

  readonly editPath = computed(() => [...this._path(), EDIT_SEGMENT]);

  /** The three tabs. None shows a count: the gateway gives none of them. */
  readonly tabs = computed<readonly PageTab[]>(() => {
    const path = this._path();

    return [
      { path: [...path, DETAILS_TAB], label: 'people.users.tabs.details' },
      { path: [...path, PERSON_ZONES_TAB], label: 'people.users.tabs.zones' },
      {
        path:
          this._registry.pathOf('baskets', {
            ownerUserId: this.person.id(),
          }) ?? path,
        label: 'people.users.tabs.baskets',
      },
    ];
  });

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(PERSON_PARAM);
      if (id !== null && id !== this.person.id()) {
        this.actions.errorKey.set(null);
        void this.person.open(id);
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());
  }

  isDanger(action: NamedAction<ResourceRow>): boolean {
    return isDangerAction(action);
  }

  /** Run one of the account's actions, asking first where it says to ask. */
  run(action: NamedAction<ResourceRow>): void {
    const row = this.person.row();
    if (row === null) {
      return;
    }

    this.actions.start(action, row, {
      args: { name: row.username, email: row.email ?? '' },
      // Sending an email again takes nothing away.
      tone: action.name === 'resend-verification' ? 'primary' : 'danger',
      after: () =>
        action.name === 'delete-account'
          ? this._deleted()
          : this.person.reload(),
    });
  }

  /** The account is gone. The list is the only honest next screen. */
  private async _deleted(): Promise<void> {
    this._changes.wrote('users');
    // Any zone the person owned is marked for deletion with them.
    this._changes.wrote('zones');
    await this._router.navigate([...this.listPath]);
  }

  /** The person's own address, through the registry and never typed. */
  private _path(): readonly string[] {
    const id = this.person.id();
    return id === null
      ? this.listPath
      : (this._registry.rowPath('users', id) ?? this.listPath);
  }
}
