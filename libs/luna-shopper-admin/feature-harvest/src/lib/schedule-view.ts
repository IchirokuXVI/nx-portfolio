import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  type RecordStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  gatewayErrorKey,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import {
  dayName,
  daysFromDraft,
  daysToDraft,
  DEFAULT_SCHEDULE_TIMEZONE,
  estimateMinutes,
  harvestRunPath,
  harvestRunsPath,
  ISO_DAYS,
  nextRunWords,
  nounKeyOf,
  scheduleBlockKey,
  scheduleOutcomeKey,
  type AnyResourceDescriptor,
  type FieldMessage,
  type ResourceRow,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import {
  CautionLine,
  describedByOf,
  FieldRow,
  LockedValue,
  RecordId,
  RecordSection,
  SaveBar,
  Viewport,
} from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { formatInstant } from './format-instant';
import { CONSENT_FIELD } from './schedules-gateway';

type Preset = Wire.HarvestHarvestRunPresetView;

/** How many pages of presets the picker reads. A chain has a handful. */
const MAX_PRESET_PAGES = 5;

/** The timezones offered first: the harvester's default, then Spain's other. */
const FIRST_ZONES = [DEFAULT_SCHEDULE_TIMEZONE, 'Atlantic/Canary'];

const NO_MESSAGES: readonly FieldMessage[] = [];

/** The id of the control of a field. */
const ID = {
  preset: 'schedule-preset',
  time: 'schedule-time',
  days: 'schedule-day-1',
  timezone: 'schedule-timezone',
  consent: 'schedule-consent',
} as const;

/**
 * The body of the page of a schedule (admin plan 0067, section 3): two
 * sections, the box of the consent, the Record block and the bar.
 *
 * Built from the parts `RecordView` is built from: each value is a
 * `lib-field-row` in a `lib-record-section`, a value the form cannot change is
 * a `lib-locked-value`, and Save is the `lib-save-bar`. What it draws that no
 * field kind draws:
 *
 * - **Seven toggles for the days**, Monday first. The draft holds them as one
 *   sorted text, so the same days are the same answer.
 * - **A time of day**, the browser's own control, which only answers `HH:mm`.
 * - **A choice of timezone** with `Europe/Madrid` first.
 * - **The box of the consent**, on a new schedule only, above Save. The
 *   gateway refuses a save without the tick under the box, and sends `true`
 *   with the save that the tick belongs to.
 * - **The Record block** says when it runs next, in the schedule's own time and
 *   in the person's, what the last slot did, and why it will not run.
 */
@Component({
  selector: 'lib-schedule-view',
  imports: [
    RouterLink,
    RokuTranslatorPipe,
    CautionLine,
    FieldRow,
    LockedValue,
    RecordId,
    RecordSection,
    SaveBar,
  ],
  template: `
    @let record = store();
    @let mode = record.mode();
    @let form = mode !== 'read';
    @let loading = record.status() === 'loading';
    @let draft = record.draft();

    <div class="lines">
      @if (!form && added()) {
        <lib-caution-line
          [text]="'record.added' | rokuT: { name: nounStart() }"
          tone="saved"
          data-added
        >
          <button (click)="addAnother.emit()" class="link" type="button">
            {{ 'record.addAnother' | rokuT: { name: noun() } }}
          </button>
        </lib-caution-line>
      } @else if (!form && savedAt(); as time) {
        <lib-caution-line
          [text]="'record.savedAt' | rokuT: { time }"
          tone="saved"
          data-saved
        />
      }

      @if (shownRefusal(); as key) {
        <lib-caution-line [text]="key | rokuT" tone="refused" data-refusal />
      }
      @for (message of record.strayErrors(); track $index) {
        <lib-caution-line [text]="message" tone="refused" data-stray />
      }
    </div>

    <div [attr.aria-busy]="loading ? 'true' : null" class="body">
      <div class="sections">
        <lib-record-section
          [heading]="'harvest.schedules.section.what' | rokuT"
        >
          @if (loading) {
            <lib-field-row
              [label]="'harvest.schedules.field.preset' | rokuT"
              [loading]="true"
            />
          } @else if (mode === 'create') {
            @let said = saidOf('presetId');
            <lib-field-row
              [changed]="changed().has('presetId')"
              [controlId]="ids.preset"
              [label]="'harvest.schedules.field.preset' | rokuT"
              [messages]="said"
              [required]="true"
              data-field="presetId"
            >
              <select
                (change)="choosePreset($event)"
                [attr.aria-describedby]="describedBy(ids.preset, said, false)"
                [attr.aria-invalid]="said.length > 0 ? 'true' : null"
                [disabled]="record.busy()"
                [id]="ids.preset"
                [value]="draft['presetId'] ?? ''"
                required
              >
                <option value="">
                  {{
                    (presetsFailed()
                      ? 'harvest.schedules.presetsFailed'
                      : 'harvest.schedules.choosePreset'
                    ) | rokuT
                  }}
                </option>
                @for (group of presetGroups(); track group.chain) {
                  <optgroup [label]="group.name">
                    @for (preset of group.presets; track preset.id) {
                      <option
                        [selected]="preset.id === draft['presetId']"
                        [value]="preset.id"
                      >
                        {{ preset.name }}
                      </option>
                    }
                  </optgroup>
                }
              </select>
            </lib-field-row>
          } @else {
            <lib-field-row
              [label]="'harvest.schedules.field.preset' | rokuT"
              data-field="presetId"
            >
              @if (form) {
                <lib-locked-value
                  [reason]="'harvest.schedules.presetFixed' | rokuT"
                >
                  {{ presetName() }}
                </lib-locked-value>
              } @else {
                <a
                  [queryParams]="presetLink().query"
                  [routerLink]="presetLink().path"
                  >{{ presetName() }}</a
                >
              }
            </lib-field-row>
          }

          @if (!loading) {
            <lib-field-row
              [label]="'harvest.schedules.field.chain' | rokuT"
              data-field="supermarketId"
            >
              @if (form) {
                <lib-locked-value
                  [reason]="'harvest.schedules.chainFromPreset' | rokuT"
                >
                  {{ chainName() || ('harvest.schedules.noPreset' | rokuT) }}
                </lib-locked-value>
              } @else if (chainLink(); as link) {
                <a [routerLink]="link">{{ chainName() }}</a>
              } @else {
                {{ chainName() }}
              }
            </lib-field-row>

            <lib-field-row
              [label]="'harvest.schedules.field.estimate' | rokuT"
              data-field="estimate"
            >
              @if (estimate(); as said) {
                <span>{{ said.key | rokuT: said.args }}</span>
              } @else {
                <span class="muted">{{
                  'harvest.schedules.estimate.none' | rokuT
                }}</span>
              }
            </lib-field-row>
          }
        </lib-record-section>

        <lib-record-section
          [heading]="'harvest.schedules.section.when' | rokuT"
        >
          <!-- What happens to a slot, said once for the whole section and in
               every mode: a person reading a skipped slot needs it as much
               as a person typing a time. -->
          <p class="rules" data-rules>
            {{ 'harvest.schedules.help.when' | rokuT }}
          </p>

          @if (loading) {
            <lib-field-row
              [label]="'harvest.schedules.field.time' | rokuT"
              [loading]="true"
            />
          } @else if (form) {
            @let timeSaid = saidOf('timeOfDay');
            <lib-field-row
              [changed]="changed().has('timeOfDay')"
              [controlId]="ids.time"
              [label]="'harvest.schedules.field.time' | rokuT"
              [messages]="timeSaid"
              [required]="true"
              data-field="timeOfDay"
            >
              <input
                (change)="setText('timeOfDay', $event)"
                (input)="setText('timeOfDay', $event)"
                [attr.aria-describedby]="describedBy(ids.time, timeSaid, false)"
                [attr.aria-invalid]="timeSaid.length > 0 ? 'true' : null"
                [disabled]="record.busy()"
                [id]="ids.time"
                [value]="draft['timeOfDay'] ?? ''"
                class="short"
                required
                type="time"
              />
            </lib-field-row>

            @let daysSaid = saidOf('daysOfWeek');
            <lib-field-row
              [changed]="changed().has('daysOfWeek')"
              [controlId]="ids.days"
              [label]="'harvest.schedules.field.days' | rokuT"
              [messages]="daysSaid"
              [required]="true"
              data-field="daysOfWeek"
            >
              <div
                [attr.aria-describedby]="describedBy(ids.days, daysSaid, false)"
                [attr.aria-label]="'harvest.schedules.field.days' | rokuT"
                class="days"
                role="group"
              >
                @for (day of days; track day) {
                  <button
                    (click)="toggleDay(day)"
                    [attr.aria-label]="dayLong(day)"
                    [attr.aria-pressed]="chosenDays().includes(day)"
                    [attr.data-day]="day"
                    [disabled]="record.busy()"
                    [id]="'schedule-day-' + day"
                    type="button"
                  >
                    {{ dayShort(day) }}
                  </button>
                }
              </div>
            </lib-field-row>

            @let zoneSaid = saidOf('timezone');
            <lib-field-row
              [changed]="changed().has('timezone')"
              [controlId]="ids.timezone"
              [help]="'harvest.schedules.help.timezone'"
              [label]="'harvest.schedules.field.timezone' | rokuT"
              [messages]="zoneSaid"
              data-field="timezone"
            >
              <select
                (change)="setText('timezone', $event)"
                [attr.aria-describedby]="
                  describedBy(ids.timezone, zoneSaid, true)
                "
                [disabled]="record.busy()"
                [id]="ids.timezone"
              >
                @for (zone of zones(); track zone) {
                  <option [selected]="zone === zoneValue()" [value]="zone">
                    {{ zone }}
                  </option>
                }
              </select>
            </lib-field-row>
          } @else {
            <lib-field-row
              [label]="'harvest.schedules.field.time' | rokuT"
              data-field="timeOfDay"
            >
              {{ row()?.timeOfDay }}
            </lib-field-row>
            <lib-field-row
              [label]="'harvest.schedules.field.days' | rokuT"
              data-field="daysOfWeek"
            >
              {{ daysRead() }}
            </lib-field-row>
            <lib-field-row
              [label]="'harvest.schedules.field.timezone' | rokuT"
              data-field="timezone"
            >
              {{ row()?.timezone }}
            </lib-field-row>
          }
        </lib-record-section>

        <!-- The consent of a new schedule, the last thing above Save. Its
             refusal is under the box: Save is refused here, and nothing is
             sent. -->
        @if (mode === 'create' && !loading) {
          @let consentSaid = saidOf(consentField);
          <div class="consent" data-consent>
            <lib-field-row
              [controlId]="ids.consent"
              [label]="'harvest.schedules.field.consent' | rokuT"
              [messages]="consentSaid"
              [required]="true"
            >
              <div class="tick">
                <input
                  (change)="tick($event)"
                  [attr.aria-describedby]="
                    describedBy(ids.consent, consentSaid, false)
                  "
                  [attr.aria-invalid]="consentSaid.length > 0 ? 'true' : null"
                  [checked]="draft[consentField] === true"
                  [disabled]="record.busy()"
                  [id]="ids.consent"
                  type="checkbox"
                />
                <span>{{ consentText() }}</span>
              </div>
            </lib-field-row>
          </div>
        }
      </div>

      @if (mode !== 'create') {
        <aside class="facts">
          <lib-record-section [heading]="'record.facts.heading' | rokuT">
            <dl>
              @if (row()?.blockedBy; as block) {
                <div class="fact blocked" data-fact="blockedBy">
                  <dt>{{ 'harvest.schedules.field.blockedBy' | rokuT }}</dt>
                  <dd>
                    <span>{{
                      blockKey(block) | rokuT: { chain: chainName() }
                    }}</span>
                    @if (blockLink(block); as link) {
                      <a [queryParams]="link.query" [routerLink]="link.path">{{
                        link.label | rokuT
                      }}</a>
                    }
                  </dd>
                </div>
              }
              <div class="fact" data-fact="nextRunAt">
                <dt>{{ 'harvest.schedules.field.nextRunAt' | rokuT }}</dt>
                <dd>
                  @if (loading) {
                    <span class="bar"></span>
                  } @else if (nextRun(); as next) {
                    <span>{{
                      'harvest.schedules.next.there'
                        | rokuT
                          : {
                              day: next.day,
                              time: next.time,
                              place: next.place,
                            }
                    }}</span>
                    @if (next.here; as here) {
                      <span class="muted" data-here>{{
                        'harvest.schedules.next.here' | rokuT: { here }
                      }}</span>
                    }
                  } @else {
                    <span class="muted">{{
                      'harvest.schedules.next.none' | rokuT
                    }}</span>
                  }
                </dd>
              </div>
              <div class="fact" data-fact="lastSlotAt">
                <dt>{{ 'harvest.schedules.field.lastSlotAt' | rokuT }}</dt>
                <dd>
                  @if (loading) {
                    <span class="bar"></span>
                  } @else if (row()?.lastSlotAt; as at) {
                    {{ instant(at) }}
                  } @else {
                    <span class="muted">{{
                      'harvest.schedules.outcome.none' | rokuT
                    }}</span>
                  }
                </dd>
              </div>
              @if (row()?.lastOutcome; as outcome) {
                <div class="fact" data-fact="lastOutcome">
                  <dt>{{ 'harvest.schedules.field.lastOutcome' | rokuT }}</dt>
                  <dd>
                    <span>{{ outcomeKey(outcome) | rokuT }}</span>
                    @if (row()?.lastOutcomeNote; as note) {
                      <span class="muted" data-note>{{ note }}</span>
                    }
                  </dd>
                </div>
              }
              @if (row()?.lastRun; as run) {
                <div class="fact" data-fact="lastRun">
                  <dt>{{ 'harvest.schedules.field.lastRun' | rokuT }}</dt>
                  <dd>
                    <a [routerLink]="runLink(run.id)">{{
                      'harvest.status.' + run.status | rokuT
                    }}</a>
                    <span class="muted">{{ instant(run.requestedAt) }}</span>
                  </dd>
                </div>
              }
              <div class="fact" data-fact="added">
                <dt>{{ 'record.facts.added' | rokuT }}</dt>
                <dd>{{ instant(row()?.createdAt ?? null) }}</dd>
              </div>
              <div class="fact" data-fact="changed">
                <dt>{{ 'record.facts.changed' | rokuT }}</dt>
                <dd>{{ instant(row()?.updatedAt ?? null) }}</dd>
              </div>
              <div class="fact" data-fact="id">
                <dt>{{ 'record.facts.id' | rokuT }}</dt>
                <dd>
                  @if (row()?.id; as id) {
                    <lib-record-id [value]="id" />
                  } @else {
                    <span class="bar"></span>
                  }
                </dd>
              </div>
            </dl>
          </lib-record-section>
        </aside>
      }
    </div>

    @if (form && !loading) {
      <lib-save-bar
        (cancel)="cancel.emit()"
        (goToFirst)="goToFirst()"
        (save)="save()"
        [saveLabel]="saveLabel()"
        [state]="record.bar()"
        [sticky]="true"
        class="edge"
      />
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
      container-type: inline-size;
    }

    .lines {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-2);
      max-inline-size: 47.5rem;
    }

    .lines:empty {
      display: none;
    }

    .link {
      min-block-size: 0;
      padding: 0;
      border: none;
      background: none;
      font-weight: 500;
      text-decoration: underline;
      text-underline-offset: 0.1875rem;
      color: inherit;
      cursor: pointer;
    }

    .body {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
      align-items: stretch;
    }

    .sections {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-4);
      min-inline-size: 0;
      max-inline-size: 47.5rem;
    }

    .facts {
      max-inline-size: 47.5rem;
    }

    @container (min-width: 60rem) {
      .body {
        flex-direction: row;
        gap: var(--admin-space-5, 1.25rem);
        align-items: flex-start;
      }

      .sections {
        flex: 1 1 0;
      }

      .facts {
        flex: none;
        inline-size: 18rem;
      }
    }

    /* The three rules of a slot, read before the rows they are about. */
    .rules {
      padding: var(--admin-space-2) var(--admin-space-4) var(--admin-space-3);
      font-size: 0.8125rem;
      line-height: 1.45;
      color: var(--admin-ink-muted);
    }

    select,
    input[type='time'] {
      inline-size: 100%;
      max-inline-size: 26.25rem;
    }

    @media (min-width: 48rem) {
      .short {
        max-inline-size: 10.5rem;
      }
    }

    /* Seven toggles in one joined row, as the switch of the Setup parts. A
       day that runs is pressed, in the accent wash. */
    .days {
      display: flex;
      flex-wrap: wrap;
      max-inline-size: 26.25rem;
    }

    .days button {
      flex: 1 0 2.75rem;
      min-block-size: var(--admin-control);
      padding: 0 var(--admin-space-2);
      border: 1px solid var(--admin-border-strong);
      background: var(--admin-surface-raised);
      font-size: 0.875rem;
      color: var(--admin-ink-muted);
      cursor: pointer;
    }

    .days button + button {
      margin-inline-start: -1px;
    }

    .days button:first-child {
      border-start-start-radius: var(--admin-radius-control);
      border-end-start-radius: var(--admin-radius-control);
    }

    .days button:last-child {
      border-start-end-radius: var(--admin-radius-control);
      border-end-end-radius: var(--admin-radius-control);
    }

    .days button[aria-pressed='true'] {
      position: relative;
      z-index: 1;
      border-color: var(--admin-accent);
      background: var(--admin-accent-wash);
      font-weight: 600;
      color: var(--admin-accent-on-wash);
    }

    .days button {
      white-space: nowrap;
    }

    @media (max-width: 47.99rem) {
      .days button {
        flex-basis: 0;
        min-inline-size: 0;
        min-block-size: 2.75rem;
        padding: 0;
        font-size: 0.8125rem;
      }
    }

    .tick {
      display: flex;
      gap: var(--admin-space-3);
      align-items: flex-start;
      max-inline-size: 36rem;
    }

    /* A box, and not a field: the size of a field from the global rule of
       controls does not apply to it. */
    .tick input {
      flex: none;
      inline-size: 1.25rem;
      block-size: 1.25rem;
      min-block-size: 0;
      padding: 0;
      margin-block-start: 0.125rem;
      accent-color: var(--admin-accent);
    }

    /* The consent is a box of its own, after the sections and in their
       shape, so that it reads as the last step before Save. */
    .consent {
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .fact {
      display: flex;
      flex-direction: column;
      gap: 0.0625rem;
      padding: var(--admin-space-2) var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }

    /* The one fact a person has to act on is in the amber that means so. */
    .fact.blocked {
      background: var(--admin-waiting-wash);
      color: var(--admin-waiting-on-wash);
    }

    .fact.blocked dt {
      color: inherit;
    }

    dt {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--admin-ink-muted);
    }

    dd {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--admin-space-2);
      align-items: baseline;
      min-inline-size: 0;
      font-size: 0.84375rem;
    }

    .fact.blocked dd {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--admin-space-1);
    }

    .muted {
      color: var(--admin-ink-muted);
    }

    a {
      color: var(--admin-accent);
    }

    .fact.blocked a {
      color: inherit;
      font-weight: 600;
    }

    .bar {
      display: block;
      inline-size: min(10rem, 100%);
      block-size: 0.75rem;
      margin-block: 0.25rem;
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
    }

    button:focus-visible,
    a:focus-visible,
    input:focus-visible,
    select:focus-visible {
      outline: 2px solid var(--admin-accent);
      outline-offset: 2px;
    }

    :disabled {
      opacity: 0.55;
    }

    lib-save-bar.edge {
      margin-inline: calc(-1 * var(--admin-page-inline));
      margin-block-end: calc(-1 * var(--admin-page-block));
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScheduleView {
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _injector = inject(Injector);
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _harvest = inject(HARVEST_SERVICE);
  private readonly _registry = inject(ResourceRegistry);
  private readonly _names = inject(ChainNames);
  private readonly _viewport = inject(Viewport);

  private _destroyed = false;

  readonly descriptor = input.required<AnyResourceDescriptor>();
  readonly store = input.required<RecordStore<ResourceRow>>();
  readonly added = input(false);
  /** A named action that failed, which the page holds. */
  readonly refusal = input<{ readonly key: string } | null>(null);

  // The Cancel of the bar, as `RecordView` names it.
  // eslint-disable-next-line @angular-eslint/no-output-native
  readonly cancel = output<void>();
  readonly saved = output<ResourceRow>();
  readonly addAnother = output<void>();

  readonly ids = ID;
  readonly days = ISO_DAYS;
  readonly consentField = CONSENT_FIELD;

  /** The timezone of the person, which the next run is also said in. */
  private readonly _viewerZone =
    Intl.DateTimeFormat().resolvedOptions().timeZone ||
    DEFAULT_SCHEDULE_TIMEZONE;

  /** Every chain's presets, for the picker of a new schedule. */
  readonly presets = signal<readonly Preset[]>([]);
  readonly presetsFailed = signal(false);

  /** The schedule as it was read, or `null` for a new one. */
  readonly row = computed(
    () => this.store().row() as Wire.HarvestHarvestScheduleView | null
  );

  readonly changed = computed(() => new Set(this.store().changed()));

  /** The preset the draft names, on a new schedule. */
  private readonly _chosen = computed(() => {
    const id = this.store().draft()['presetId'];
    return this.presets().find((preset) => preset.id === id) ?? null;
  });

  /** The chain of the schedule, or of the preset a new one names. */
  private readonly _chainId = computed(
    () => this.row()?.supermarketId ?? this._chosen()?.supermarketId ?? ''
  );

  readonly chainName = computed(() => {
    const id = this._chainId();
    const named = this.store().row()?.['chainName'];
    if (typeof named === 'string' && named !== '') {
      return named;
    }
    return id === '' ? '' : this._names.nameOf(id);
  });

  readonly presetName = computed(
    () => this.row()?.presetName ?? this._chosen()?.name ?? ''
  );

  /** The presets of the picker, one group for each chain. */
  readonly presetGroups = computed(() => {
    const groups = new Map<string, Preset[]>();
    for (const preset of this.presets()) {
      groups.set(preset.supermarketId, [
        ...(groups.get(preset.supermarketId) ?? []),
        preset,
      ]);
    }
    return [...groups.entries()]
      .map(([chain, presets]) => ({
        chain,
        name: this._names.nameOf(chain),
        presets,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** About how long a run takes, from the schedule or the chosen preset. */
  readonly estimate = computed(() => {
    const estimate = this.row()?.estimate ?? this._chosen()?.estimate;
    if (estimate === undefined) {
      return null;
    }
    return {
      key: `harvest.schedules.estimate.${estimate.basis}`,
      args: {
        minutes: estimateMinutes(estimate.seconds),
        count: estimate.samples,
      },
    };
  });

  /** The days the form holds. */
  readonly chosenDays = computed(() =>
    daysFromDraft(this.store().draft()['daysOfWeek'])
  );

  /** The days as they were read: "Mon, Wed, Fri". */
  readonly daysRead = computed(() => {
    const days = this.row()?.daysOfWeek ?? [];
    this._translator.locale();
    return days.map((day) => this.dayShort(day)).join(', ');
  });

  /** The timezone the select shows: the draft's, else the default. */
  readonly zoneValue = computed(() => {
    const zone = this.store().draft()['timezone'];
    return typeof zone === 'string' && zone !== ''
      ? zone
      : DEFAULT_SCHEDULE_TIMEZONE;
  });

  /** Every timezone, Madrid and the Canaries first, and the one held. */
  readonly zones = computed(() => {
    const supported =
      (
        Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
      ).supportedValuesOf?.('timeZone') ?? [];
    const rest = [...new Set([...supported, this.zoneValue(), 'UTC'])]
      .filter((zone) => !FIRST_ZONES.includes(zone))
      .sort();
    return [...FIRST_ZONES, ...rest];
  });

  /** The next run, in the schedule's time and in the person's. */
  readonly nextRun = computed(() => {
    const row = this.row();
    return row === null
      ? null
      : nextRunWords(
          row.nextRunAt,
          row.timezone,
          this._viewerZone,
          this._translator.locale()
        );
  });

  /** The sentence of the box, which names the chain. */
  readonly consentText = computed(() =>
    this._t('harvest.schedules.consent.text', {
      chain: this.chainName() || this._t('harvest.schedules.thisChain'),
    })
  );

  /** A refusal about no field: the page's own, or that of the last save. */
  readonly shownRefusal = computed(() => {
    const given = this.refusal();
    if (given !== null) {
      return given.key;
    }
    const store = this.store();
    const error = store.error();
    // A refusal explained field by field is under those fields.
    if (
      error === null ||
      store.mode() === 'read' ||
      Object.keys(error.fieldErrors).length > 0
    ) {
      return null;
    }
    return gatewayErrorKey(error) ?? 'resource.error.unknown';
  });

  readonly noun = computed(() => this._t(nounKeyOf(this.descriptor())));
  readonly nounStart = computed(
    () => this.noun().charAt(0).toLocaleUpperCase() + this.noun().slice(1)
  );

  readonly saveLabel = computed(() =>
    this.store().mode() === 'create'
      ? this._t('record.action.add', { name: this.noun() })
      : this._t('resource.action.save')
  );

  readonly savedAt = computed(() => {
    const at = this.store().savedAt();
    return at === null
      ? null
      : new Intl.DateTimeFormat(this._translator.locale(), {
          hour: '2-digit',
          minute: '2-digit',
        }).format(at);
  });

  /** The Runs tab, open on the chain with this preset marked. */
  readonly presetLink = computed(() => ({
    path: harvestRunsPath(),
    query: { chain: this._chainId(), preset: this.row()?.presetId ?? '' },
  }));

  readonly chainLink = computed(() => {
    const id = this._chainId();
    return id === '' ? null : this._registry.rowPath('supermarkets', id);
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => (this._destroyed = true));

    // The presets, for the picker. Read once, whatever the mode: a page that
    // opens reading can become the form of another schedule.
    void this._readPresets();

    // The chain of the schedule, by name.
    effect(() => {
      const id = this._chainId();
      if (id !== '') {
        untracked(() => void this._names.resolve([id]).catch(() => undefined));
      }
    });

    // "Edit" leaves the page with the press, so the focus goes to the first
    // control of the form, as `RecordView` puts it there.
    let mode: string | null = null;
    effect(() => {
      const now = this.store().mode();
      untracked(() => {
        if (now === 'edit' && mode === 'read') {
          afterNextRender(() => this._focus(ID.time), {
            injector: this._injector,
          });
        }
        mode = now;
      });
    });
  }

  saidOf(name: string): readonly FieldMessage[] {
    const said = this.store().messagesFor(name);
    return said.length === 0 ? NO_MESSAGES : said;
  }

  describedBy(
    controlId: string,
    messages: readonly FieldMessage[],
    help: boolean
  ): string | null {
    return describedByOf(controlId, messages.length, help);
  }

  dayShort(day: number): string {
    return dayName(day, this._translator.locale(), 'short');
  }

  dayLong(day: number): string {
    return dayName(day, this._translator.locale(), 'long');
  }

  blockKey(block: Wire.EnumsHarvestScheduleBlock): string {
    return scheduleBlockKey(block);
  }

  outcomeKey(outcome: Wire.EnumsHarvestScheduleOutcome): string {
    return scheduleOutcomeKey(outcome);
  }

  /**
   * Where the sentence of a block points: the source of the chain, which has
   * to be turned on, or the Runs tab, where the preset is started by hand.
   * The two switches of a cluster are not this app's to change.
   */
  blockLink(block: Wire.EnumsHarvestScheduleBlock): {
    readonly path: readonly string[];
    readonly query: Readonly<Record<string, string>>;
    readonly label: string;
  } | null {
    const chain = this._chainId();
    if (block === 'SOURCE_DISABLED') {
      const path = this._registry.rowPath('sources', chain);
      return path === null
        ? null
        : { path, query: {}, label: 'harvest.schedules.blockLink.source' };
    }
    if (block === 'SOURCE_FAILING') {
      return {
        path: harvestRunsPath(),
        query: { chain, preset: this.row()?.presetId ?? '' },
        label: 'harvest.schedules.blockLink.runs',
      };
    }
    return null;
  }

  runLink(id: string): readonly string[] {
    return harvestRunPath(id);
  }

  instant(value: string | null): string {
    return formatInstant(value, this._translator.locale());
  }

  choosePreset(event: Event): void {
    this.store().set('presetId', (event.target as HTMLSelectElement).value);
  }

  setText(name: string, event: Event): void {
    this.store().set(
      name,
      (event.target as HTMLInputElement | HTMLSelectElement).value
    );
  }

  /** One day in or out. The draft holds them sorted, once each. */
  toggleDay(day: number): void {
    const held = this.chosenDays();
    this.store().set(
      'daysOfWeek',
      daysToDraft(
        held.includes(day)
          ? held.filter((entry) => entry !== day)
          : [...held, day]
      )
    );
  }

  /** The tick, read from the box and never from anything kept. */
  tick(event: Event): void {
    this.store().set(CONSENT_FIELD, (event.target as HTMLInputElement).checked);
  }

  /** Send it, as `RecordView` sends a record. */
  async save(): Promise<void> {
    const store = this.store();
    const row = await store.submit();
    if (this._destroyed) {
      return;
    }
    if (row !== null) {
      this.saved.emit(row);
      return;
    }
    if (this._viewport.compact() && store.bar().kind === 'invalid') {
      afterNextRender(() => this.goToFirst(), { injector: this._injector });
    }
  }

  /** The first control that was refused, in page order. */
  goToFirst(): void {
    const refused = new Set(this.store().invalid());
    const order: readonly [string, string][] = [
      ['presetId', ID.preset],
      ['timeOfDay', ID.time],
      ['daysOfWeek', ID.days],
      ['timezone', ID.timezone],
      [CONSENT_FIELD, ID.consent],
    ];
    const first = order.find(([name]) => refused.has(name));
    if (first !== undefined) {
      this._focus(first[1]);
    }
  }

  private _focus(id: string): void {
    this._host.nativeElement
      .querySelector<HTMLElement>(`[id="${id}"]`)
      ?.focus();
  }

  private async _readPresets(): Promise<void> {
    try {
      const held: Preset[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PRESET_PAGES; page += 1) {
        const answer = await this._harvest.listPresets(undefined, cursor);
        held.push(...answer.items);
        if (answer.nextCursor === null) {
          break;
        }
        cursor = answer.nextCursor;
      }
      if (this._destroyed) {
        return;
      }
      this.presets.set(held);
      void this._names
        .resolve([...new Set(held.map((preset) => preset.supermarketId))])
        .catch(() => undefined);
    } catch {
      // The picker then says the presets could not be read. A schedule that
      // exists names its own preset and does not need the list.
      this.presetsFailed.set(true);
    }
  }

  private _t(key: string, values?: Record<string, unknown>): string {
    this._translator.loaded();
    this._translator.locale();
    return this._translator.t(key, undefined, undefined, values);
  }
}
