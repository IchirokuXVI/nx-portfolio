import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { toGatewayError } from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceChanges,
  ResourceReferences,
  ResourceRegistry,
  routeParam,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  compositeId,
  type NamedAction,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { CautionLine, PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { FactList, type Fact } from './fact-list';
import { instant } from './people-format';
import type { ListLineRow, ListRow } from './people-seed';
import { PEOPLE_STYLES } from './people-styles';
import { ActionConfirm, ActionRunner } from './row-actions';
import {
  EDIT_SEGMENT,
  LIST_PARAM,
  ZONE_CAUTION,
  ZONE_PARAM,
} from './shopper-params';

/** One line of the list, as a row of the page. */
export interface LineRow {
  readonly line: ListLineRow;
  /** Whether the line waits for somebody to approve or reject it. */
  readonly waiting: boolean;
  /** The line's own form, where its wording and its quantity change. */
  readonly formPath: readonly string[] | null;
  /** What can be done to this line right now. */
  readonly actions: readonly NamedAction<ResourceRow>[];
}

/**
 * One list of a zone, and its lines (admin plan 0045, target 5).
 *
 * This is the page the lines live on, and it is reached by a deliberate press
 * on the list. The Lists tab of the zone shows a list's name and its line
 * count and stops there, so nobody ends up having read a household's shopping
 * by browsing zones (plan 0007, section 3).
 *
 * **Approve and reject are the line descriptor's.** They are the two named
 * actions `LIST_LINES` declares, with the rule for when each applies, drawn
 * beside the line they would change. That rule is a line that waits, so a
 * line that was answered draws neither. A line that waits sits on the waiting
 * wash. Every line has "Edit", which opens its form, and "Delete".
 *
 * **Nothing here adds a line.** A line is written by somebody in the zone, and
 * an operator is nobody in the zone. The info button says so.
 */
@Component({
  selector: 'lib-list-page',
  imports: [
    PageHeader,
    RouterLink,
    FactList,
    CautionLine,
    ActionConfirm,
    RokuTranslatorPipe,
  ],
  template: `
    <lib-page-header
      [backLabel]="'people.lists.back' | rokuT: { zone: zoneName() }"
      [backLink]="listsPath()"
      [frameTabs]="false"
      [heading]="list()?.name || ('resource.form.loading' | rokuT)"
      [info]="info"
      [subtitle]="zoneName()"
    >
      <a [routerLink]="editPath()" class="button" pageAction data-edit>{{
        'people.lists.edit' | rokuT
      }}</a>
      @if (canDelete) {
        <button
          (click)="askToDelete()"
          [disabled]="actions.busy() || list() === null"
          class="button danger"
          pageMoreAction
          type="button"
          data-delete
        >
          {{ 'people.lists.delete' | rokuT }}
        </button>
      }
    </lib-page-header>

    @if (actions.errorKey(); as key) {
      <p class="refusal" role="alert">{{ key | rokuT }}</p>
    }

    @if (errorKey(); as key) {
      <p class="state error" role="alert">
        {{ key | rokuT }}
        <button (click)="load()" class="button small" type="button">
          {{ 'resource.action.retry' | rokuT }}
        </button>
      </p>
    } @else if (list(); as row) {
      <lib-caution-line [text]="caution | rokuT" />

      <section aria-labelledby="list-settings-heading" class="block">
        <h3 id="list-settings-heading">
          {{ 'people.lists.settings' | rokuT }}
        </h3>
        <lib-fact-list [facts]="facts()" />
      </section>

      <section aria-labelledby="list-lines-heading" class="block">
        <h3 id="list-lines-heading">{{ 'people.lists.lines' | rokuT }}</h3>
        @if (lines().length === 0) {
          <p class="state">{{ 'people.lists.noLines' | rokuT }}</p>
        } @else {
          <ul class="panel" data-lines>
            @for (entry of lines(); track entry.line.id) {
              <li
                [attr.data-line]="entry.line.id"
                [class.waiting]="entry.waiting"
                class="row"
              >
                <span class="row-main">
                  <span class="row-title">{{ entry.line.content }}</span>
                  <span class="row-line">
                    {{
                      'people.lists.quantity'
                        | rokuT: { count: entry.line.quantity }
                    }}
                    ·
                    {{
                      'people.lists.approval.' + entry.line.approvalStatus
                        | rokuT
                    }}
                    · {{ when(entry.line.createdAt) }}
                  </span>
                </span>
                <span class="row-actions">
                  @for (action of entry.actions; track action.name) {
                    <button
                      (click)="run(action, entry.line)"
                      [attr.data-action]="action.name"
                      [class.primary]="
                        entry.waiting && action.name === 'approve-line'
                      "
                      [disabled]="actions.busy()"
                      class="button small"
                      type="button"
                    >
                      {{ action.label | rokuT }}
                    </button>
                  }
                  @if (entry.formPath; as path) {
                    <a
                      [routerLink]="path"
                      class="button small"
                      data-edit-line
                      >{{ 'resource.action.edit' | rokuT }}</a
                    >
                  }
                  @if (canDeleteLines) {
                    <button
                      (click)="askToDeleteLine(entry.line)"
                      [disabled]="actions.busy()"
                      class="button small danger"
                      type="button"
                      data-delete-line
                    >
                      {{ 'resource.action.delete' | rokuT }}
                    </button>
                  }
                </span>
              </li>
            }
          </ul>
        }
      </section>
    } @else {
      <p class="state" role="status">{{ 'resource.list.loading' | rokuT }}</p>
    }

    <lib-action-confirm [runner]="actions" />
  `,
  styles: [
    PEOPLE_STYLES,
    `
      .block {
        display: flex;
        flex-direction: column;
        gap: var(--admin-space-2);
      }

      /* A line's controls sit under its words on a phone, where five of them
         do not fit beside a sentence. */
      @media (max-width: 47.99rem) {
        .row {
          flex-direction: column;
          align-items: stretch;
        }

        .row-actions {
          justify-content: flex-start;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListPage {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _references = inject(ResourceReferences);
  private readonly _changes = inject(ResourceChanges);
  private readonly _translator = inject(RokuTranslatorService);

  readonly actions = new ActionRunner();
  readonly caution = ZONE_CAUTION;

  private readonly _lists = this._registry.byName('lists');
  private readonly _lines = this._registry.byName('list-lines');

  /** What the info button says: the list descriptor's own words. */
  readonly info = this._lists?.info ?? null;

  readonly canDelete = this._lists?.actions?.delete === true;
  readonly canDeleteLines = this._lines?.actions?.delete === true;

  /** The line actions, built once in this injection context. */
  private readonly _named: readonly NamedAction<ResourceRow>[] =
    this._lines?.actions?.named?.() ?? [];

  private readonly _id = signal<string | null>(null);
  private readonly _zoneId = signal<string | null>(
    routeParam(this._route.snapshot, ZONE_PARAM)
  );

  readonly list = signal<ListRow | null>(null);
  /** Why the list could not be read, as a key, or `null`. */
  readonly errorKey = signal<string | null>(null);

  /** The name of whoever made the list, once it is read. */
  private readonly _maker = signal<string | null>(null);

  /** So that an answer for a list the page has left is dropped. */
  private _generation = 0;

  readonly zoneName = computed(() => this.list()?.zoneName ?? '');

  /** The zone the list is in, as the registry wants it. */
  private readonly _known = computed((): Record<string, string> => {
    const zone = this._zoneId() ?? this.list()?.zoneId ?? null;
    if (zone === null) {
      return {};
    }
    return { zoneId: zone };
  });

  /** The Lists tab of the zone, for the way back. */
  readonly listsPath = computed(
    () => this._registry.pathOf('lists', this._known()) ?? ['/']
  );

  readonly editPath = computed(() => [...this._path(), EDIT_SEGMENT]);

  readonly facts = computed<readonly Fact[]>(() => {
    const list = this.list();
    if (list === null) {
      return [];
    }
    const yesNo = (value: boolean) =>
      this._translator.t(value ? 'resource.value.yes' : 'resource.value.no');

    return [
      {
        label: 'people.lists.autoApproveLines',
        text: yesNo(list.autoApproveLines),
      },
      {
        label: 'people.lists.sharedWithZone',
        text: yesNo(list.sharedWithZone),
      },
      {
        label: 'people.lists.createdByUserId',
        text: this._maker() ?? list.createdByUserId,
        link: this._registry.rowPath('users', list.createdByUserId),
      },
      {
        label: 'people.lists.createdAt',
        text: instant(list.createdAt, this._translator.locale()),
      },
      {
        label: 'people.lists.updatedAt',
        text: instant(list.updatedAt, this._translator.locale()),
      },
    ];
  });

  /** The lines in the order the list holds them. */
  readonly lines = computed<readonly LineRow[]>(() => {
    const list = this.list();
    if (list === null) {
      return [];
    }
    const known = { ...this._known(), listId: list.id };

    return list.lines.map(
      (line): LineRow => ({
        line,
        waiting: line.approvalStatus === 'PENDING',
        formPath: this._registry.rowPath(
          'list-lines',
          compositeId([list.id, line.id]),
          known
        ),
        actions: this._named.filter(
          (action) => action.available?.(line) ?? true
        ),
      })
    );
  });

  constructor() {
    const params = this._route.paramMap.subscribe((map) => {
      const id = map.get(LIST_PARAM);
      if (id !== null && id !== this._id()) {
        this._id.set(id);
        this._zoneId.set(routeParam(this._route.snapshot, ZONE_PARAM));
        this.list.set(null);
        this.actions.errorKey.set(null);
        void this.load();
      }
    });
    inject(DestroyRef).onDestroy(() => params.unsubscribe());
  }

  when(value: string): string {
    return instant(value, this._translator.locale());
  }

  /** Read the list and its lines again, keeping what is on screen meanwhile. */
  async load(): Promise<void> {
    const id = this._id();
    if (id === null || this._lists === undefined) {
      return;
    }
    this._generation += 1;
    const generation = this._generation;
    this.errorKey.set(null);

    try {
      const row = await this._registry.gatewayFor(this._lists).read(id);
      if (generation !== this._generation) {
        return;
      }
      const list = row as ListRow;
      // A list is read by its own id, so an address that names another zone
      // would draw this list under that zone. The list says which zone it is
      // in: go to its own address.
      const named = this._zoneId();
      if (named !== null && list.zoneId !== named) {
        const path = this._registry.rowPath('lists', id, {
          zoneId: list.zoneId,
        });
        if (path !== null) {
          void this._router.navigate([...path], { replaceUrl: true });
          return;
        }
      }
      this.list.set(list);
      void this._nameMaker(list.createdByUserId, generation);
    } catch (error) {
      if (generation === this._generation) {
        this.list.set(null);
        this.errorKey.set(
          gatewayErrorKey(toGatewayError(error)) ?? 'resource.error.unknown'
        );
      }
    }
  }

  /** Run one of a line's actions, asking first where it says to ask. */
  run(action: NamedAction<ResourceRow>, line: ListLineRow): void {
    this.actions.start(action, line, {
      args: { name: line.content },
      // Neither is a deletion: the line stays, with an answer on it.
      tone: 'primary',
      after: () => this._changed(),
    });
  }

  askToDeleteLine(line: ListLineRow): void {
    const list = this.list();
    if (list === null || this._lines === undefined) {
      return;
    }
    const lines = this._lines;

    this.actions.ask(
      {
        heading: 'resource.confirm.delete.heading',
        body: 'resource.confirm.delete.body',
        confirm: 'resource.confirm.delete.confirm',
      },
      async () => {
        await this._registry
          .gatewayFor(lines)
          .remove(compositeId([list.id, line.id]));
        await this._changed();
      },
      { args: { name: line.content } }
    );
  }

  askToDelete(): void {
    const list = this.list();
    if (list === null || this._lists === undefined) {
      return;
    }
    const lists = this._lists;

    this.actions.ask(
      {
        heading: 'resource.confirm.delete.heading',
        body: 'resource.confirm.delete.body',
        confirm: 'resource.confirm.delete.confirm',
      },
      async () => {
        await this._registry.gatewayFor(lists).remove(list.id);
        this._changes.wrote('lists');
        // The zone counts its lists, and one of them is gone.
        this._changes.wrote('zones');
        await this._router.navigate([...this.listsPath()]);
      },
      { args: { name: list.name } }
    );
  }

  /** A line moved: the list is read again, and its count may have changed. */
  private async _changed(): Promise<void> {
    this._changes.wrote('list-lines');
    this._changes.wrote('lists');
    await this.load();
  }

  /**
   * The name of whoever made the list. The id stays where nobody answers,
   * which is what a reaped account shows anyway (plan 0007, section 4).
   */
  private async _nameMaker(userId: string, generation: number): Promise<void> {
    const option = await this._references
      .resolve('users', userId)
      .catch(() => null);
    if (generation === this._generation) {
      this._maker.set(option?.title ?? null);
    }
  }

  /** The list's own address, through the registry and never typed. */
  private _path(): readonly string[] {
    const id = this._id();
    return id === null
      ? this.listsPath()
      : (this._registry.rowPath('lists', id, this._known()) ??
          this.listsPath());
  }
}
