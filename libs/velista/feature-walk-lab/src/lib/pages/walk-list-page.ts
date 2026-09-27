import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  parseWalkImport,
  WalkFileError,
} from '@portfolio/luna-shopper/shop-map/recorder';
import { formatDuration, formatStarted } from '../format';
import { WalkDb, type WalkSummary } from '../storage/walk-db';
import { WalkFiles } from '../storage/walk-files';
import { computeAndExport } from '../viewer/export';
import { WalkLabState } from '../walk-lab-state';

/** What the list says after an action, and in which tone. */
interface Notice {
  tone: 'info' | 'danger' | 'success';
  key: string;
  params?: Record<string, unknown>;
}

/**
 * The walks saved on this phone (recorder plan 0002, section 7.1): Record, Import a
 * file, and per walk Open, Export and Delete.
 *
 * Delete takes two taps, the second on a button that says what it does, because the
 * list is used one handed and a walk is an hour of somebody's morning.
 */
@Component({
  selector: 'lib-walk-list-page',
  imports: [RokuTranslatorPipe, RouterLink],
  templateUrl: './walk-list-page.html',
  styleUrl: './walk-list-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WalkListPage {
  private readonly _db = inject(WalkDb);
  private readonly _files = inject(WalkFiles);
  private readonly _state = inject(WalkLabState);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _locale = inject(RokuLocaleStore).locale;

  readonly walks = signal<WalkSummary[] | null>(null);
  readonly notice = signal<Notice | null>(null);
  readonly confirming = signal<string | null>(null);
  readonly exporting = signal<string | null>(null);
  readonly importing = signal(false);

  readonly storageError = this._db.error;
  readonly memoryOnly = this._db.memoryOnly;

  constructor() {
    const pending = this._state.notice();
    if (pending) {
      this.notice.set({ tone: 'info', key: pending });
      this._state.notice.set(null);
    }
    void this.refresh();
  }

  async refresh(): Promise<void> {
    this.walks.set(await this._db.list());
  }

  started(walk: WalkSummary): string {
    return formatStarted(walk.startedAt, this._locale());
  }

  duration(walk: WalkSummary): string {
    return formatDuration(walk.durationMs);
  }

  async import(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.importing.set(true);
    this.notice.set(null);
    try {
      const text = await this._files.read(file);
      const parsed = parseWalkImport(text);

      if (parsed.kind === 'tracks') {
        this._state.imported.set({ fileName: file.name, tracks: parsed.tracks });
        await this._router.navigate(['imported'], { relativeTo: this._route });
        return;
      }

      const saved = await this._db.save(parsed.walk);
      this.notice.set(
        saved
          ? {
              tone: 'success',
              key: 'walkLab.import.saved',
              params: { name: parsed.walk.name || file.name },
            }
          : { tone: 'danger', key: 'walkLab.list.saveFailed' }
      );
      await this.refresh();
    } catch (error) {
      const code = error instanceof WalkFileError ? error.code : 'unknown';
      this.notice.set({
        tone: 'danger',
        key: `walkLab.import.error.${code}`,
      });
    } finally {
      this.importing.set(false);
    }
  }

  async export(walk: WalkSummary): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(walk.id);
    this.notice.set(null);

    try {
      const file = await this._db.get(walk.id);
      if (!file) {
        this.notice.set({ tone: 'danger', key: 'walkLab.view.notFound' });
        return;
      }
      const out = await computeAndExport(file, {});
      this._files.download(out.fileName, out.text);
      this.notice.set({
        tone: 'success',
        key: 'walkLab.list.exported',
        params: { file: out.fileName },
      });
    } catch (error) {
      this.notice.set({
        tone: 'danger',
        key: 'walkLab.list.exportFailed',
        params: { error: error instanceof Error ? error.message : String(error) },
      });
    } finally {
      this.exporting.set(null);
      await this.refresh();
    }
  }

  askDelete(walk: WalkSummary): void {
    this.confirming.set(walk.id);
  }

  cancelDelete(): void {
    this.confirming.set(null);
  }

  async confirmDelete(walk: WalkSummary): Promise<void> {
    this.confirming.set(null);
    await this._db.delete(walk.id);
    await this.refresh();
  }
}
