import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  forwardRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { ActivatedRoute, Router, RouterOutlet } from '@angular/router';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import type {
  MapArea,
  ShopMapDocumentV2,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  ShopWalksStore,
  WalkEntrySaver,
  type WalkSaveStatus,
} from '@portfolio/velista/data-access';
import { APP_BASE_PATH, type ShopWalkDetail } from '@portfolio/velista/models';
import {
  locationIdOf,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopWalkPath,
  walkIdOf,
} from '@portfolio/velista/platform';
import { ChevronLeftIcon } from '@portfolio/velista/ui';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import { AREA_SHEET_RENAME_PARAM } from './area-sheet';
import { HoldMenu, type HoldChoice } from './hold-menu';
import {
  applyEdits,
  editsAllowed,
  holdEvents,
  MAP_EDIT_SESSION,
  metresText,
  noteEvent,
  type HoldPress,
  type MapEditSession,
} from './map-edits';
import { ResizeControls } from './resize-controls';
import { UnsavedDialog } from './unsaved-dialog';

/** What the page says above the map after something did not go as asked. */
export type EditMapNotice = 'changed' | 'refused' | 'blocked';

/** A page the unsaved guard asks before it is left (velista `0123`, target 6). */
export interface LeavesWithUnsavedEntries {
  /** True to leave. May save first, and may ask. */
  canLeave(): boolean | Promise<boolean>;
}

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: ShopWalkDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/**
 * Editing a walk's map by hand (velista `0123`, target 1; the `EditArea` and
 * `EditCells` boards): the editor in the mapper look on the walk's real
 * document, with no person and no live state. There are no edit buttons: a drag
 * on the floor draws, a tap on an area opens its sheet, a drawn area shows its
 * resize controls, and a long press opens the menu.
 *
 * Every edit is one appended `edited` entry, collected by `WalkEntrySaver` and
 * sent on Done, on leaving, when the page is hidden and every 20 s. Another
 * phone's save refuses it (`walk_changed`): the page reads the walk again and
 * says so. Leaving with an unsent entry asks first (`UnsavedDialog`, through the
 * route's guard, and the browser's own `beforeunload`).
 *
 * `shops/:locationId/walks/:walkId/edit`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-edit-map-page',
  imports: [
    ChevronLeftIcon,
    HoldMenu,
    ResizeControls,
    RokuTranslatorPipe,
    RouterOutlet,
    ShopMapView,
    UnsavedDialog,
  ],
  templateUrl: './edit-map-page.html',
  styleUrl: './edit-map-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    WalkEntrySaver,
    { provide: MAP_EDIT_SESSION, useExisting: forwardRef(() => EditMapPage) },
  ],
})
export class EditMapPage implements MapEditSession, LeavesWithUnsavedEntries {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _saver = inject(WalkEntrySaver);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);

  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  private readonly _view = viewChild(ShopMapView);

  protected readonly read = signal<Read>({ kind: 'loading' });
  private readonly _document = signal<ShopMapDocumentV2 | null>(null);
  readonly document = this._document.asReadonly();

  /** Where edits sit in the log: the last entry's `logTo`. */
  private _logMs = 0;
  /** Areas drawn on this page, by id. */
  private readonly _drawn = new Set<string>();
  /** An area the canvas just drew, so its selection shows the controls. */
  private _justDrawn: string | null = null;

  protected readonly name = computed(() => {
    const read = this.read();
    return read.kind === 'ready'
      ? read.detail.walk.name
      : (this._walks.summary(this.walkId())?.name ?? null);
  });

  private readonly _selectedId = signal<string | null>(null);
  protected readonly selected = computed<MapArea | null>(() => {
    const id = this._selectedId();
    return id === null
      ? null
      : (this._document()?.areas.find((area) => area.id === id) ?? null);
  });

  protected readonly press = signal<HoldPress | null>(null);
  protected readonly snap = signal(false);
  protected readonly notice = signal<EditMapNotice | null>(null);
  protected readonly status = this._saver.status;
  protected readonly nextTryAt = this._saver.nextTryAt;
  protected readonly asking = signal(false);
  private _answer: ((leave: boolean) => void) | null = null;

  protected readonly sizeLabel = (w: number, h: number) =>
    this._translator.t('shopMapEdit.size', undefined, undefined, {
      w: metresText(w, this._locale()),
      h: metresText(h, this._locale()),
    });

  constructor() {
    effect(() => {
      const walkId = this.walkId();
      if (walkId === '') {
        return;
      }
      untracked(() => void this._load(walkId));
    });

    // A save the timer or a hidden page sent can be refused too.
    effect(() => {
      const status = this._saver.status();
      if (status === 'changed' || status === 'refused') {
        untracked(() => void this._reload(status));
      }
    });

    const view = inject(DOCUMENT).defaultView;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this._saver.unsent()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    view?.addEventListener('beforeunload', beforeUnload);
    inject(DestroyRef).onDestroy(() =>
      view?.removeEventListener('beforeunload', beforeUnload)
    );
  }

  // MapEditSession, for the area sheet.

  apply(events: readonly WalkEvent[]): boolean {
    const document = this._document();
    if (document === null || events.length === 0) {
      return false;
    }
    if (!editsAllowed(document, events, this._logMs)) {
      this.notice.set('blocked');
      return false;
    }
    this._record(events);
    return true;
  }

  isNew(areaId: string): boolean {
    return this._drawn.has(areaId);
  }

  select(areaId: string | null): void {
    this._selectedId.set(areaId);
    this._view()?.select(areaId);
  }

  pageUrl(): string {
    return shopWalkPath(
      this._locale(),
      this._basePath,
      this.locationId(),
      this.walkId(),
      'edit'
    );
  }

  // The canvas.

  protected changed(events: WalkEvent[]): void {
    const document = this._document();
    for (const event of events) {
      if (
        event.type === 'area-put' &&
        !document?.areas.some((area) => area.id === event.area.id)
      ) {
        this._justDrawn = event.area.id;
      }
    }
    this._record(events);
  }

  protected areaSelected(area: MapArea | null): void {
    if (area === null) {
      this._selectedId.set(null);
      return;
    }
    const drawn = this._justDrawn === area.id;
    this._justDrawn = null;
    this._selectedId.set(area.id);
    if (!drawn) {
      this._openArea(area.id, false);
    }
  }

  protected longPressed(press: HoldPress): void {
    this.press.set(press);
  }

  // The menu.

  protected chosen(choice: HoldChoice): void {
    const press = this.press();
    this.press.set(null);
    if (press === null) {
      return;
    }
    if (choice.action === 'section') {
      this._view()?.clearHeld();
      if (press.area !== null) {
        this._selectedId.set(press.area.id);
        this._openArea(press.area.id, true);
      }
      return;
    }
    const events =
      choice.action === 'note'
        ? [noteEvent(press.at, choice.text, this._logMs, newId())]
        : holdEvents(choice.action, press, newId);
    if (!this.apply(events)) {
      this._view()?.clearHeld();
      return;
    }
    const made = events[0];
    if (choice.action === 'erase') {
      this.select(null);
    } else if (made?.type === 'area-put') {
      if (press.area === null) {
        this._drawn.add(made.area.id);
      }
      this.select(made.area.id);
    }
  }

  protected dismissed(): void {
    this.press.set(null);
    this._view()?.clearHeld();
  }

  // The controls.

  protected snapChanged(on: boolean): void {
    this.snap.set(on);
  }

  protected finishedArea(): void {
    this.select(null);
  }

  protected openSelected(): void {
    const area = this.selected();
    if (area !== null) {
      this._openArea(area.id, false);
    }
  }

  // Leaving.

  /** Done: save, then back to the history. The guard asks if the save did not arrive. */
  protected done(): Promise<void> {
    return this.toHistory();
  }

  protected toHistory(): Promise<void> {
    return this._pages.back(
      shopWalkPath(
        this._locale(),
        this._basePath,
        this.locationId(),
        this.walkId()
      )
    );
  }

  async canLeave(): Promise<boolean> {
    if (!this._saver.unsent()) {
      return true;
    }
    const outcome = await this._saver.save();
    if (outcome === 'changed' || outcome === 'refused') {
      // Nothing is unsent any more, but what was is gone: stay, and say so.
      return false;
    }
    if (!this._saver.unsent()) {
      return true;
    }
    this.asking.set(true);
    return new Promise<boolean>((resolve) => {
      this._answer = resolve;
    });
  }

  protected stay(): void {
    this._answered(false);
  }

  protected leaveAnyway(): void {
    this._saver.discard();
    this._answered(true);
  }

  protected closeNotice(): void {
    this.notice.set(null);
  }

  protected retry(): void {
    void this._load(this.walkId());
  }

  private _answered(leave: boolean): void {
    this.asking.set(false);
    const answer = this._answer;
    this._answer = null;
    answer?.(leave);
  }

  private _record(events: readonly WalkEvent[]): void {
    const document = this._document();
    if (document === null) {
      return;
    }
    for (const event of events) {
      if (event.type === 'area-put' && this._justDrawn === event.area.id) {
        this._drawn.add(event.area.id);
      }
    }
    this._document.set(applyEdits(document, events, this._logMs));
    this._saver.add(events);
    if (this.notice() === 'blocked') {
      this.notice.set(null);
    }
  }

  private _openArea(areaId: string, rename: boolean): void {
    void this._router.navigate(sheetSegments(SHOP_PATHS.areas, areaId), {
      relativeTo: this._route,
      ...(rename ? { queryParams: { [AREA_SHEET_RENAME_PARAM]: '1' } } : {}),
    });
  }

  private async _load(walkId: string): Promise<void> {
    this.read.set({ kind: 'loading' });
    await this._walks.loadWalk(walkId);
    this._adopt(walkId);
  }

  /** Another phone saved first, or the server refused the entry: show what is saved. */
  private async _reload(notice: 'changed' | 'refused'): Promise<void> {
    this.notice.set(notice);
    this.press.set(null);
    this.select(null);
    await this._walks.loadWalk(this.walkId());
    this._adopt(this.walkId());
  }

  private _adopt(walkId: string): void {
    const read = this._walks.walk(walkId);
    if (read.kind !== 'walk') {
      this.read.set(read.kind === 'missing' ? read : { kind: 'failed' });
      return;
    }
    const detail = read.detail;
    const last = [...detail.timeline].sort((a, b) => b.seq - a.seq)[0];
    this._logMs = last?.logTo ?? 0;
    this._drawn.clear();
    this._justDrawn = null;
    this._document.set(detail.document);
    this._saver.begin({
      walkId,
      baseSeq: detail.walk.lastSeq,
      logTo: this._logMs,
      kind: 'edited',
    });
    this.read.set({ kind: 'ready', detail });
  }

  /** For the template: the words of where saving stands, or null to say nothing. */
  protected statusKey(status: WalkSaveStatus): string | null {
    switch (status) {
      case 'unsent':
        return 'shopMapEdit.status.unsent';
      case 'sending':
        return 'shopMapEdit.status.sending';
      case 'saved':
        return 'shopMapEdit.status.saved';
      case 'failed':
        return 'shopMapEdit.status.failed';
      default:
        return null;
    }
  }
}

/** A uuid for a drawn area or a note. */
function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
