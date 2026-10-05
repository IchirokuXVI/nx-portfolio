import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  untracked,
} from '@angular/core';
import {
  ActivatedRoute,
  Router,
  RouterLink,
  RouterOutlet,
} from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
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
import { ZoneContext } from './shopper-contexts';
import { DETAILS_TAB, EDIT_SEGMENT, ZONE_PARAM } from './shopper-params';
import { ShoppersStatus } from './shoppers-status';

/**
 * One zone, as a page (admin plan 0045, target 5).
 *
 * The header says which zone, who owns it and what its join code is. Under it
 * are the four things a zone holds, as tabs: its members, its lists, the
 * shopping lists drawn from it and its own details. Each tab is a child route,
 * so each has an address and the browser's back button walks them.
 *
 * It replaced a screen that drew everything in one column, and three flat
 * lists that each asked for a zone in a filter before they would load.
 *
 * **The actions are the descriptor's.** "New join code", "Mark for deletion",
 * "Restore" and "Delete zone" are the named actions `ZONES` declares, drawn
 * here and run through {@link ActionRunner}. This page wrote its own copy of
 * each once, with its own confirmation keys.
 *
 * **The tabs are drawn again when the zone changes**, for the reason the
 * chain's page gives: pressing another zone in the column changes one route
 * parameter, and a tab that read the old zone would keep it.
 */
@Component({
  selector: 'lib-zone-page',
  imports: [
    PageHeader,
    RouterOutlet,
    RouterLink,
    ActionConfirm,
    RokuTranslatorPipe,
  ],
  providers: [ZoneContext],
  template: `
    <lib-page-header
      [backLabel]="split() ? null : ('people.zones.back' | rokuT)"
      [backLink]="listPath"
      [heading]="name() || ('resource.form.loading' | rokuT)"
      [subtitle]="compact() ? summary() : null"
      [tabs]="tabs()"
      [tabsLabel]="name()"
    >
      @if (!compact() && zone.row(); as row) {
        <span class="chips" pageChip>
          @if (ownerPath(); as path) {
            <a [routerLink]="path" class="chip" data-owner>{{
              'people.zones.ownedBy' | rokuT: { name: zone.ownerName() }
            }}</a>
          } @else {
            <span class="chip" data-owner>{{
              'people.zones.noOwner' | rokuT
            }}</span>
          }
          <span class="chip mono" data-join-code>{{ row.joinCode }}</span>
        </span>
      }
      @if (marked()) {
        <span class="chip danger" pageChip data-marked>{{
          'people.zones.status.MARKED_FOR_DELETION' | rokuT
        }}</span>
      }
      <a [routerLink]="editPath()" class="button" pageMoreAction data-edit>{{
        'people.zones.edit' | rokuT
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

    @if (zone.status() === 'error') {
      <p class="state error" role="alert">
        {{ zone.errorKey() ?? 'resource.error.unknown' | rokuT }}
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

      .chips {
        display: flex;
        gap: var(--admin-space-2);
        align-items: center;
      }

      .refusal,
      .state {
        margin-block-start: var(--admin-space-3);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ZonePage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _changes = inject(ResourceChanges);
  private readonly _viewport = inject(Viewport);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _status = inject(ShoppersStatus);

  readonly zone = inject(ZoneContext);
  readonly actions = new ActionRunner();

  readonly split = this._viewport.split;
  readonly compact = this._viewport.compact;

  /**
   * The zone's named actions, built once in this injection context, for the
   * reason the list page gives: the factory calls `inject`.
   */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this._registry.byName('zones')?.actions?.named?.() ?? [];

  /** Where the list of zones is, for the way back on a narrow screen. */
  readonly listPath = this._registry.pathOf('zones') ?? ['/'];

  /** The zone as a one entry list, so that the template can key on it. */
  readonly keys = computed(() => {
    const id = this.zone.id();
    return id === null ? [] : [id];
  });

  readonly name = computed(() => this.zone.row()?.name ?? '');

  readonly marked = computed(
    () => this.zone.row()?.status === 'MARKED_FOR_DELETION'
  );

  /** The actions this zone can have done to it right now. */
  readonly available = computed(() => {
    const row = this.zone.row();
    return row === null
      ? []
      : this._named.filter((action) => action.available?.(row) ?? true);
  });

  /** The owner's page, or `null` for a zone nobody owns. */
  readonly ownerPath = computed(() => {
    const owner = this.zone.row()?.ownerUserId ?? null;
    return owner === null ? null : this._registry.rowPath('users', owner);
  });

  /** "Owner marta, 4 members": the line under the name on a phone. */
  readonly summary = computed(() => {
    const row = this.zone.row();
    if (row === null) {
      return null;
    }
    const owner = this.zone.ownerName();
    return this._translator.t(
      owner === null ? 'people.zones.summaryNoOwner' : 'people.zones.summary',
      undefined,
      undefined,
      { owner: owner ?? '', count: row.memberCount }
    );
  });

  readonly editPath = computed(() => [...this._path(), EDIT_SEGMENT]);

  /**
   * The four tabs. Members and Lists show a count, which the zone's own read
   * carries. Shopping lists shows none: the list is paged and has no total.
   */
  readonly tabs = computed<readonly PageTab[]>(() => {
    const context = this.zone;
    const path = this._path();
    // Each tab is where the registry says that resource is under this zone,
    // so a tab cannot point at an address the route table does not have.
    const under = (resource: string): readonly string[] =>
      this._registry.pathOf(resource, { zoneId: context.id() }) ?? path;

    return [
      {
        path: under('memberships'),
        label: 'people.zones.tabs.members',
        count: () => context.row()?.memberCount ?? null,
      },
      {
        path: under('lists'),
        label: 'people.zones.tabs.lists',
        count: () => context.row()?.listCount ?? null,
      },
      {
        path: under('zone-baskets'),
        label: 'people.zones.tabs.baskets',
      },
      { path: [...path, DETAILS_TAB], label: 'people.zones.tabs.details' },
    ];
  });

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(ZONE_PARAM);
      if (id !== null && id !== this.zone.id()) {
        this.actions.errorKey.set(null);
        void this.zone.open(id);
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());

    // A list was deleted on the Lists tab, so the count on that tab moved.
    let lists = this._changes.version('lists');
    effect(() => {
      const version = this._changes.version('lists');
      untracked(() => {
        if (version !== lists) {
          lists = version;
          void this.zone.reload();
        }
      });
    });
  }

  isDanger(action: NamedAction<ResourceRow>): boolean {
    return isDangerAction(action);
  }

  /** Run one of the zone's actions, asking first where it says to ask. */
  run(action: NamedAction<ResourceRow>): void {
    const row = this.zone.row();
    if (row === null) {
      return;
    }

    this.actions.start(action, row, {
      args: { name: row.name },
      after: () =>
        action.name === 'delete-zone' ? this._deleted() : this._changed(),
    });
  }

  /** The zone changed: the page and the column of zones both read again. */
  private async _changed(): Promise<void> {
    this._changes.wrote('zones');
    await this.zone.reload();
  }

  /** The zone is gone, and so are the requests that waited in it. */
  private async _deleted(): Promise<void> {
    this._changes.wrote('zones');
    this._status.refresh();
    await this._router.navigate([...this.listPath]);
  }

  /** The zone's own address, through the registry and never typed. */
  private _path(): readonly string[] {
    const id = this.zone.id();
    return id === null
      ? this.listPath
      : (this._registry.rowPath('zones', id) ?? this.listPath);
  }
}
