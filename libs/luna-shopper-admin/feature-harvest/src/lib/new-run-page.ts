import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  HARVEST_SERVICE,
  toGatewayError,
  type GatewayError,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  harvestRunsPath,
  spawnBlockReason,
  type Wire,
} from '@portfolio/luna-shopper-admin/models';
import { keepTabInside, PageHeader } from '@portfolio/luna-shopper-admin/ui';
import { HarvestShell } from './harvest-shell';
import { RunRequestForm } from './run-request-form';

/**
 * A new run: what to run, for which chain, and how (admin plan 0044, target
 * 5). At `/harvest/runs/new`, one press from the Runs tab.
 *
 * The form was the first thing on the runs screen, above the list, so reading
 * what ran meant scrolling past a form nobody was filling in. Starting a run
 * by hand is the rarer act now that presets exist, so it has a page of its
 * own and the tab opens on what is running.
 *
 * The choices are {@link RunRequestForm}, which a preset is edited with as
 * well. This page spawns what the form hands it, draws the refusal, and saves
 * the same request as a preset.
 *
 * **Starting a run is attributed to the harvester, not to the operator** (plan
 * 0006, section 6; backend plan 0075 section 3). Thousands of catalog writes
 * follow, and the audit trail credits the service for them. So the confirmation
 * says a run was started and never that the operator changed four thousand
 * prices, and `requestedByUserId` is not drawn as an author.
 */
@Component({
  selector: 'lib-new-run-page',
  imports: [
    PageHeader,
    FormsModule,
    RouterLink,
    RokuTranslatorPipe,
    RunRequestForm,
  ],
  template: `
    <lib-page-header
      [backLabel]="'harvest.run.back' | rokuT"
      [backLink]="runsLink"
      [heading]="'harvest.runs.start.heading' | rokuT"
    />

    <section class="start">
      <lib-run-request-form
        (changed)="draft.set($event)"
        (submitted)="start($event)"
        [busy]="starting()"
      >
        <button
          (click)="openSave()"
          [disabled]="!canSave()"
          class="secondary"
          type="button"
          data-save-preset
        >
          {{ 'harvest.presets.saveAs.action' | rokuT }}
        </button>
      </lib-run-request-form>

      @if (blockedKey(); as key) {
        <div class="failure" role="alert">
          <p>{{ key | rokuT }}</p>
          <!-- The server's own words, under the screen's. The refusals that
               reach here are written for whoever is operating the harvester,
               and they name the row or the switch that has to change. -->
          @if (blockedDetails().length > 0) {
            <ul>
              @for (line of blockedDetails(); track line) {
                <li>{{ line }}</li>
              }
            </ul>
          }
        </div>
      }

      @if (savedPreset(); as saved) {
        <p class="notice" role="status">
          {{ 'harvest.presets.saveAs.saved' | rokuT: { name: saved.name } }}
          <a [queryParams]="saved.query" [routerLink]="runsLink">
            {{ 'harvest.presets.saveAs.open' | rokuT }}
          </a>
        </p>
      }
    </section>

    <!-- Save as preset (admin plan 0030, section 4). A small dialog, because
         the only new fact is the name: the request is the form as it is. -->
    @if (saveOpen()) {
      <div
        (keydown.escape)="closeSave()"
        (keydown)="keepInside($event)"
        #dialog
        aria-labelledby="save-preset-heading"
        aria-modal="true"
        class="dialog"
        role="dialog"
      >
        <div class="panel">
          <h2 id="save-preset-heading">
            {{ 'harvest.presets.saveAs.heading' | rokuT }}
          </h2>
          <label>
            <span>{{ 'harvest.presets.name' | rokuT }}</span>
            <input
              (ngModelChange)="onSaveNameChange($event)"
              [ngModel]="saveName()"
              maxlength="80"
              name="presetName"
              type="text"
            />
          </label>
          @if (saveNameTaken()) {
            <p class="field-error" role="alert">
              {{ 'harvest.presets.nameTaken' | rokuT }}
            </p>
          }
          @if (saveFailure() !== null) {
            <div class="failure" role="alert">
              <p>{{ 'harvest.presets.saveFailed' | rokuT }}</p>
              @if (saveFailure() !== '') {
                <p>{{ saveFailure() }}</p>
              }
            </div>
          }
          <div class="controls">
            <button
              (click)="saveAsPreset()"
              [disabled]="saving() || saveName().trim() === ''"
              class="primary"
              type="button"
            >
              {{
                (saving() ? 'harvest.presets.saving' : 'harvest.presets.save')
                  | rokuT
              }}
            </button>
            <button (click)="closeSave()" [disabled]="saving()" type="button">
              {{ 'resource.action.cancel' | rokuT }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-4);
    }

    h2 {
      font-size: 1rem;
      font-weight: 600;
    }

    .start {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      align-items: flex-start;
      padding: var(--admin-space-4);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    label {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
    }

    label span {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }

    button {
      cursor: pointer;
    }

    .primary {
      border-color: transparent;
      background: var(--admin-accent);
      font-weight: 600;
      color: var(--admin-accent-ink);
    }

    .failure {
      padding: var(--admin-space-3);
      border: 1px solid var(--admin-danger);
      border-radius: var(--admin-radius-control);
      background: var(--admin-danger-wash);
      inline-size: 100%;
    }

    /* The server's own sentences, indented under the screen's own. Marked as a
       list because there can be several, which is what a refusal by field is. */
    .failure ul {
      margin-block-start: var(--admin-space-2);
      padding-inline-start: var(--admin-space-4);
      font-size: 0.8125rem;
    }

    .notice {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-2);
      font-size: 0.875rem;
    }

    .notice a {
      color: var(--admin-accent);
    }

    .field-error {
      font-size: 0.8125rem;
      color: var(--admin-danger-on-wash);
    }

    /* The save dialog, drawn as the confirm dialog is: an opaque cover and
       one raised panel. */
    .dialog {
      position: fixed;
      z-index: 90;
      display: flex;
      align-items: center;
      justify-content: center;
      inset: 0;
      padding: var(--admin-space-4);
      background: var(--admin-surface);
    }

    .panel {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-3);
      inline-size: 100%;
      max-inline-size: 26rem;
      padding: var(--admin-space-6);
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius);
      background: var(--admin-surface-raised);
    }

    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: var(--admin-space-3);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewRunPage {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _router = inject(Router);

  readonly shell = inject(HarvestShell);

  /** The form, for the readiness "Save as preset" depends on. */
  readonly form = viewChild(RunRequestForm);

  /** The Runs tab, which this page is under and goes back to. */
  readonly runsLink = harvestRunsPath();

  readonly starting = signal(false);
  private readonly _spawnError = signal<GatewayError | null>(null);

  /** The form's request as it stands, for "Save as preset". */
  readonly draft = signal<Wire.SpawnHarvestRunDto | null>(null);
  readonly saveOpen = signal(false);
  readonly saveName = signal('');
  readonly saving = signal(false);
  readonly saveNameTaken = signal(false);
  /** The server's sentence about a failed save, `''` when it sent none. */
  readonly saveFailure = signal<string | null>(null);
  readonly savedPreset = signal<{
    readonly name: string;
    readonly query: Readonly<Record<string, string>>;
  } | null>(null);

  /**
   * Whether the form can be saved as a preset (admin plan 0030, section 4).
   *
   * Only when it could start, because the server validates a preset exactly as
   * a spawn, and only with a chain, because every preset belongs to one.
   */
  readonly canSave = computed(() => {
    const form = this.form();
    const draft = this.draft();
    return (
      form !== undefined &&
      form.ready() &&
      !form.uploading() &&
      draft !== null &&
      (draft.supermarketId ?? '') !== ''
    );
  });

  /**
   * Why the last attempt to start would not start.
   *
   * The spawn refusal is the only direct evidence either switch offers, so it
   * is kept and shown rather than folded into a general failure message. A 409
   * is different again: something is already running, which is not a switch
   * and has an obvious remedy.
   */
  readonly blockedKey = computed(() => {
    const error = this._spawnError();
    if (error === null) {
      return null;
    }

    const reason = spawnBlockReason(error);
    if (reason !== null) {
      return `harvest.blocked.${reason}`;
    }
    if (error.status === 409) {
      return 'harvest.runs.start.alreadyRunning';
    }
    return this.blockedDetails().length > 0
      ? 'harvest.runs.start.refused'
      : 'harvest.runs.start.failed';
  });

  /**
   * What the server said about the refusal, in its own words.
   *
   * Field messages when it named fields, and its one sentence otherwise. The
   * screen's own sentence is drawn above these and never replaced by them.
   */
  readonly blockedDetails = computed<readonly string[]>(() => {
    const error = this._spawnError();
    if (error === null) {
      return [];
    }

    const fields = Object.values(error.fieldErrors).flat();
    if (fields.length > 0) {
      return fields;
    }
    return error.detail === '' ? [] : [error.detail];
  });

  /**
   * Spawn what the form handed up, and go to the Runs tab with that run
   * marked. The form has already checked it is ready.
   *
   * A refusal keeps the page, with everything typed, and says why.
   */
  async start(input: Wire.SpawnHarvestRunDto): Promise<void> {
    this.starting.set(true);
    this._spawnError.set(null);

    try {
      const run = await this._service.spawnRun(input);
      this.shell.observeSpawnRefusal(null);
      await this._router.navigate([...this.runsLink], {
        queryParams: { run: run.id },
      });
    } catch (error) {
      const failure = toGatewayError(error);
      this._spawnError.set(failure);
      this.shell.observeSpawnRefusal(spawnBlockReason(failure));
    } finally {
      this.starting.set(false);
    }
  }

  openSave(): void {
    if (!this.canSave()) {
      return;
    }
    this.saveName.set('');
    this.saveNameTaken.set(false);
    this.saveFailure.set(null);
    this.savedPreset.set(null);
    this.saveOpen.set(true);
  }

  closeSave(): void {
    if (!this.saving()) {
      this.saveOpen.set(false);
    }
  }

  /** Tab stays inside the dialog while it is open. */
  keepInside(event: KeyboardEvent): void {
    keepTabInside(event, event.currentTarget as HTMLElement);
  }

  onSaveNameChange(name: string): void {
    this.saveName.set(name);
    this.saveNameTaken.set(false);
  }

  /**
   * Save the form's request as a preset of its chain.
   *
   * The request is the form's own, with the chain taken off: a preset's chain
   * is a column and never part of its input. A 409 is the name, which the
   * dialog keeps open to fix.
   */
  async saveAsPreset(): Promise<void> {
    const draft = this.form()?.request() ?? this.draft();
    const name = this.saveName().trim();
    if (draft === null || name === '' || !this.canSave()) {
      return;
    }
    const { supermarketId, ...input } = draft;

    this.saving.set(true);
    this.saveNameTaken.set(false);
    this.saveFailure.set(null);
    try {
      const preset = await this._service.createPreset(
        supermarketId ?? '',
        name,
        input
      );
      this.savedPreset.set({
        name: preset.name,
        // The Runs tab opens its presets on this chain, with this one marked.
        query: { chain: preset.supermarketId, preset: preset.id },
      });
      this.saveOpen.set(false);
    } catch (error) {
      const failure = toGatewayError(error);
      if (failure.status === 409) {
        this.saveNameTaken.set(true);
      } else {
        const fields = Object.values(failure.fieldErrors).flat();
        this.saveFailure.set(
          fields.length > 0 ? fields.join(' ') : failure.detail
        );
      }
    } finally {
      this.saving.set(false);
    }
  }
}
