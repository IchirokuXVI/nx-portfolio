import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DetailFacts, DetailFrame, type DetailFact } from './detail-frame';
import { DetailPage } from './detail-page';
import { instant } from './people-format';
import type { ListRow } from './people-seed';

/**
 * One standing list, and its lines (plan 0007, section 2).
 *
 * **Read only, with no actions at all.** There is no service behind a change to
 * a line from here: a line participates in settlements, generated list bindings,
 * permission sets and realtime broadcasts other clients have already applied, so
 * a row editor over it is ruled out now and permanently.
 *
 * This is the screen the lines live on, and it is reached by a deliberate click.
 * The zone screen shows a list's name and its line count and stops there, so
 * nobody ends up having read a household's shopping by browsing zones.
 */
@Component({
  selector: 'lib-list-detail-page',
  imports: [DetailFrame, DetailFacts, RokuTranslatorPipe],
  template: `
    <lib-detail-frame
      (back)="back()"
      (retry)="load()"
      [errorKey]="errorKey()"
      [heading]="heading()"
      [kindKey]="descriptor.labels.one"
      [loading]="loading()"
    >
      @if (row(); as list) {
        <lib-detail-facts [facts]="facts()" />

        <section>
          <h2>{{ 'people.lists.lines' | rokuT }}</h2>
          @if (list.lines.length === 0) {
            <p class="muted">{{ 'people.lists.noLines' | rokuT }}</p>
          } @else {
            <ul class="rows">
              @for (line of list.lines; track line.id) {
                <li>
                  <div class="what">
                    <span class="content">{{ line.content }}</span>
                    <span class="muted">
                      {{
                        'people.lists.approval.' + line.approvalStatus | rokuT
                      }}
                      · {{ createdAt(line.createdAt) }}
                    </span>
                  </div>
                  <span class="quantity">{{ line.quantity }}</span>
                </li>
              }
            </ul>
          }
        </section>
      }
    </lib-detail-frame>
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
    }

    section {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      margin-block-start: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 700;
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      list-style: none;
    }

    .rows li {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
      align-items: center;
      justify-content: space-between;
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .what {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    .content {
      font-weight: 600;
    }

    .quantity {
      font-variant-numeric: tabular-nums;
    }

    .muted {
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ListDetailPage extends DetailPage<ListRow> {
  readonly heading = computed(() => this.row()?.name ?? this.id);

  readonly facts = computed<readonly DetailFact[]>(() => {
    const list = this.row();
    if (list === null) {
      return [];
    }

    return [
      { label: 'people.lists.id', text: list.id },
      { label: 'people.lists.name', text: list.name },
      { label: 'people.lists.zone', text: list.zoneName },
      { label: 'people.lists.zoneId', text: list.zoneId },
      // A uuid rather than a name. Lists are in core's database and users are
      // in auth's, and this route does not decorate; asking auth per list would
      // be a request nobody needed.
      { label: 'people.lists.createdByUserId', text: list.createdByUserId },
      {
        label: 'people.lists.autoApproveLines',
        text: this.yesNo(list.autoApproveLines),
      },
      {
        label: 'people.lists.sharedWithZone',
        text: this.yesNo(list.sharedWithZone),
      },
      { label: 'people.lists.lineCount', text: String(list.lineCount) },
      {
        label: 'people.lists.createdAt',
        text: instant(list.createdAt, this.locale),
      },
      {
        label: 'people.lists.updatedAt',
        text: instant(list.updatedAt, this.locale),
      },
    ];
  });

  constructor() {
    super();
    void this.load();
  }

  createdAt(value: string): string {
    return instant(value, this.locale);
  }

  yesNo(value: boolean): string {
    return this.translator.t(
      value ? 'resource.value.yes' : 'resource.value.no'
    );
  }
}
