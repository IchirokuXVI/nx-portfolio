import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
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
import type { ShopMapLive } from '@portfolio/luna-shopper/shop-map/editor';
import type {
  LiveSnapshot,
  MapArea,
  MapMark,
  MarkKind,
  ShopMapDocumentV2,
  WalkEvent,
} from '@portfolio/luna-shopper/shop-map/model';
import {
  MappingSettingsStore,
  ShopDetailStore,
  ShopWalksStore,
  WalkEntrySaver,
} from '@portfolio/velista/data-access';
import {
  APP_BASE_PATH,
  catalogName,
  type ShopWalkDetail,
} from '@portfolio/velista/models';
import {
  BrowserFacade,
  locationIdOf,
  PageNavigation,
  sheetSegments,
  SHOP_PATHS,
  shopWalkPath,
  WALK_SENSORS,
  WALK_TONES,
  walkIdOf,
  type LeavesWithUnsavedWork,
  type WalkSensorSession,
} from '@portfolio/velista/platform';
import {
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  CommentIcon,
  FlagIcon,
  InfoIcon,
  LocateIcon,
  StopIcon,
  StoreIcon,
  WarningIcon,
} from '@portfolio/velista/ui';
import { AREA_SHEET_RENAME_PARAM } from '../edit/area-sheet';
import { HoldMenu, type HoldChoice } from '../edit/hold-menu';
import {
  applyEdits,
  editsAllowed,
  holdEvents,
  MAP_EDIT_SESSION,
  metresText,
  noteEvent,
  renamedArea,
  type HoldPress,
  type MapEditSession,
} from '../edit/map-edits';
import { ResizeControls } from '../edit/resize-controls';
import { UnsavedDialog } from '../edit/unsaved-dialog';
import { ShopMapView } from '../shop-map-view/shop-map-view';
import { MarkSheet, type MarkSaved } from './mark-sheet';
import {
  suggestionSection,
  SuggestionSheet,
  type ShelfSuggestion,
  type SuggestionAnswer,
} from './suggestion-sheet';
import { readWalkBaseline, writeWalkBaseline } from './walk-baselines';
import {
  WalkRecording,
  type RecordingPhase,
  type RecordingStop,
} from './walk-recording';

/** How often the canvas is told about the walk: at most ten times a second (target 2). */
export const RECORD_DRAW_EVERY_MS = 100;

/** How soon a failed save is tried again while walking (target 8). */
export const RECORD_RETRY_MS = 10_000;

/** How long Start from here waits for the camera's first tracked pose. */
const CAMERA_WAIT_MS = 5_000;

type Read =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly detail: ShopWalkDetail }
  | { readonly kind: 'missing' }
  | { readonly kind: 'failed' };

/** What the page is doing, besides what the recording says. */
type Mode = 'start' | 'starting' | 'recording' | 'where';

/** The screen the template draws. */
export type RecordScreen =
  | 'loading'
  | 'missing'
  | 'failed'
  | 'unsupported'
  | 'start'
  | 'starting'
  | 'where'
  | RecordingPhase;

/** What the page says above the map after something did not go as asked. */
export type RecordNotice =
  | 'changed'
  | 'refused'
  | 'blocked'
  | 'cameraFailed'
  | 'cameraWaiting';

/**
 * Recording a walk with the camera (velista `0126`; the `Main`, `Mark`,
 * `Suggestion`, `Paused`, `Unconfirmed`, `Resume` and `Unsaved` boards).
 *
 * One camera session per recording, with this page as its DOM overlay. Every
 * frame feeds the tracking guard and the live map (`WalkRecording`), and ten
 * times a second the canvas is told what to draw. Marks, suggestions, sections
 * and the editing of `0123` happen on the same map while the walk goes on.
 *
 * Saving is `WalkEntrySaver`'s: the first entry of a session is `started` or
 * `resumed`, every 20 s save after it is a new `continued` entry, a stop is a
 * `stopped` entry with its reason, and a failed save shows "Not saved yet" and
 * is tried again every 10 s. Stop, the back button, leaving and hiding the page
 * all stop the walk first and save.
 *
 * `shops/:locationId/walks/:walkId/record`, only with `shopMap.record`.
 */
@Component({
  selector: 'lib-record-walk-page',
  imports: [
    CheckIcon,
    ChevronLeftIcon,
    CloseIcon,
    CommentIcon,
    FlagIcon,
    HoldMenu,
    InfoIcon,
    LocateIcon,
    MarkSheet,
    ResizeControls,
    RokuTranslatorPipe,
    RouterOutlet,
    ShopMapView,
    StopIcon,
    StoreIcon,
    SuggestionSheet,
    UnsavedDialog,
    WarningIcon,
  ],
  templateUrl: './record-walk-page.html',
  styleUrl: './record-walk-page.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    WalkEntrySaver,
    {
      provide: MAP_EDIT_SESSION,
      useExisting: forwardRef(() => RecordWalkPage),
    },
  ],
})
export class RecordWalkPage implements MapEditSession, LeavesWithUnsavedWork {
  private readonly _walks = inject(ShopWalksStore);
  private readonly _shops = inject(ShopDetailStore);
  private readonly _settings = inject(MappingSettingsStore);
  private readonly _saver = inject(WalkEntrySaver);
  private readonly _sensors = inject(WALK_SENSORS);
  private readonly _tones = inject(WALK_TONES);
  private readonly _browser = inject(BrowserFacade);
  private readonly _pages = inject(PageNavigation);
  private readonly _router = inject(Router);
  private readonly _route = inject(ActivatedRoute);
  private readonly _basePath = inject(APP_BASE_PATH);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _document = inject(DOCUMENT);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly locationId = locationIdOf(this._route);
  protected readonly walkId = walkIdOf(this._route);

  private readonly _view = viewChild(ShopMapView);

  protected readonly read = signal<Read>({ kind: 'loading' });
  private readonly _doc = signal<ShopMapDocumentV2 | null>(null);
  readonly document = this._doc.asReadonly();

  protected readonly supported = signal<boolean | null>(null);
  private readonly _mode = signal<Mode>('start');
  private readonly _phase = signal<RecordingPhase>('idle');
  private readonly _stop = signal<RecordingStop | null>(null);
  protected readonly live = signal<ShopMapLive | null>(null);
  protected readonly sectionRun = signal<string | null>(null);
  protected readonly notice = signal<RecordNotice | null>(null);

  protected readonly markKind = signal<MarkKind | null>(null);
  protected readonly suggestion = signal<ShelfSuggestion | null>(null);
  protected readonly picked = signal<MapMark | null>(null);
  protected readonly press = signal<HoldPress | null>(null);
  protected readonly snap = signal(false);
  private readonly _selectedId = signal<string | null>(null);
  protected readonly pointing = signal<
    'left' | 'right' | 'ahead' | 'behind' | null
  >(null);

  protected readonly status = this._saver.status;
  protected readonly nextTryAt = this._saver.nextTryAt;
  protected readonly asking = signal(false);
  /** True while Start from here waits for the camera. */
  protected readonly resuming = signal(false);
  /** Counts Close and reloads, so a wait that outlives them resumes nothing. */
  private _cancels = 0;
  private _answer: ((leave: boolean) => void) | null = null;

  private readonly _now = signal(Date.now());

  private _recording: WalkRecording | null = null;
  private _session: WalkSensorSession | null = null;
  private _drawTimer: ReturnType<typeof setInterval> | null = null;
  /** What the walk answered last. */
  private _snapshot: LiveSnapshot | null = null;
  /** True while leaving a hidden or closing page: saves go out with `keepalive`. */
  private _keepalive = false;
  /** Areas drawn by hand on this page, by id. */
  private readonly _drawn = new Set<string>();
  private _justDrawn: string | null = null;

  protected readonly screen = computed<RecordScreen>(() => {
    const read = this.read();
    if (read.kind !== 'ready') {
      return read.kind;
    }
    if (this.supported() === false) {
      return 'unsupported';
    }
    const mode = this._mode();
    return mode === 'recording' ? this._phase() : mode;
  });

  /** Why the walk stopped, for the words of the stopped panel. */
  protected readonly stopKey = computed(() => {
    switch (this._stop()) {
      case 'frame-moved':
        return 'shopWalkRecord.stopped.frameMoved';
      case 'discarded':
        return 'shopWalkRecord.stopped.discarded';
      case 'button':
      case 'left-page':
        return 'shopWalkRecord.stopped.paused';
      default:
        return 'shopWalkRecord.stopped.trackingLost';
    }
  });

  protected readonly name = computed(() => {
    const read = this.read();
    return read.kind === 'ready'
      ? read.detail.walk.name
      : (this._walks.summary(this.walkId())?.name ?? null);
  });

  protected readonly selected = computed<MapArea | null>(() => {
    const id = this._selectedId();
    return id === null
      ? null
      : (this._doc()?.areas.find((area) => area.id === id) ?? null);
  });

  /** Every mark of the walk, newest first: the manual resume picks one. */
  protected readonly marks = computed(() =>
    [...(this._doc()?.marks ?? [])].sort((a, b) => b.logMs - a.logMs)
  );

  /** The names used for each kind of mark in this walk, newest first. */
  protected readonly recent = computed(() => {
    const byKind: Record<MarkKind, string[]> = {
      section: [],
      counter: [],
      note: [],
    };
    for (const mark of this.marks()) {
      const text = mark.text?.trim();
      if (!text) {
        continue;
      }
      const list = byKind[mark.kind];
      if (!list.some((one) => one.toLowerCase() === text.toLowerCase())) {
        list.push(text);
      }
    }
    return byKind;
  });

  /** The shop's own sections, named in the reader's language. */
  protected readonly shopSections = computed(() => {
    const read = this._shops.read(this.locationId());
    const locale = this._locale();
    return read.kind === 'shop'
      ? read.shop.sections.map((one) => catalogName(one.name, locale))
      : [];
  });

  /** The section names a suggestion can take: this walk's, then the shop's. */
  protected readonly sectionNames = computed(() => {
    const names = [...this.recent().section];
    for (const name of this.shopSections()) {
      if (!names.some((one) => one.toLowerCase() === name.toLowerCase())) {
        names.push(name);
      }
    }
    return names;
  });

  protected readonly suggestionSectionNearby = computed(() => {
    const suggestion = this.suggestion();
    return suggestion === null
      ? null
      : suggestionSection(suggestion, this._doc()?.marks ?? []);
  });

  /** The words of the "Saved" chip on the map, or null to show none. */
  protected readonly savedChip = computed<{
    readonly key: string;
    readonly count?: number;
    readonly ok: boolean;
  } | null>(() => {
    const status = this.status();
    if (status === 'sending') {
      return { key: 'shopWalkRecord.saved.sending', ok: true };
    }
    if (status === 'failed') {
      return { key: 'shopWalkRecord.saved.unsent', ok: false };
    }
    const at = this._saver.savedAt();
    if (at === null) {
      return null;
    }
    const seconds = Math.max(
      0,
      Math.round((this._now() - at.getTime()) / 1000)
    );
    if (seconds < 5) {
      return { key: 'shopWalkRecord.saved.justNow', ok: true };
    }
    if (seconds < 60) {
      return { key: 'shopWalkRecord.saved.seconds', count: seconds, ok: true };
    }
    return {
      key: 'shopWalkRecord.saved.minutes',
      count: Math.floor(seconds / 60),
      ok: true,
    };
  });

  protected readonly suggestionLabel = computed(() =>
    this._translator.t('shopWalkRecord.suggestion.label')
  );

  protected readonly sizeLabel = (w: number, h: number) =>
    this._translator.t('shopMapEdit.size', undefined, undefined, {
      w: metresText(w, this._locale()),
      h: metresText(h, this._locale()),
    });

  constructor() {
    void this._sensors.supported().then((yes) => this.supported.set(yes));

    effect(() => {
      const walkId = this.walkId();
      if (walkId === '') {
        return;
      }
      untracked(() => void this._load(walkId));
    });

    effect(() => {
      const locationId = this.locationId();
      if (locationId !== '') {
        untracked(() => void this._shops.ensure(locationId));
      }
    });

    // A save the timer or a hidden page sent can be refused too.
    effect(() => {
      const status = this._saver.status();
      if (status === 'changed' || status === 'refused') {
        untracked(() => void this._reload(status));
      }
    });

    const clock = setInterval(() => this._now.set(Date.now()), 1000);

    const view = this._document.defaultView;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (this._saver.unsent() || this._walking()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    // Hiding the page stops the walk, unless it is the camera session itself
    // taking the screen (the walk lab's rule).
    const onHidden = () => {
      if (
        this._document.visibilityState === 'hidden' &&
        !(this._session?.showing() ?? false)
      ) {
        this._leavePage(true);
      }
    };
    const onPageHide = () => this._leavePage(true);
    const onClick = (event: MouseEvent) => this._mapClicked(event);
    this._host.nativeElement.addEventListener('click', onClick);
    view?.addEventListener('beforeunload', beforeUnload);
    view?.addEventListener('pagehide', onPageHide);
    this._document.addEventListener('visibilitychange', onHidden);

    inject(DestroyRef).onDestroy(() => {
      clearInterval(clock);
      this._host.nativeElement.removeEventListener('click', onClick);
      view?.removeEventListener('beforeunload', beforeUnload);
      view?.removeEventListener('pagehide', onPageHide);
      this._document.removeEventListener('visibilitychange', onHidden);
      this._leavePage(true);
      this._stopDrawing();
    });
  }

  // MapEditSession, for the area sheet.

  apply(events: readonly WalkEvent[]): boolean {
    const document = this._doc();
    if (document === null || events.length === 0) {
      return false;
    }
    if (!editsAllowed(document, events, this._saver.logEnd())) {
      this.notice.set('blocked');
      return false;
    }
    this._edit(events);
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
    return this._walkPath('record');
  }

  // Starting.

  /** Start walking, on a walk with nothing recorded (the tap starts the camera). */
  protected async startWalking(): Promise<void> {
    if (this._mode() !== 'start') {
      return;
    }
    this._mode.set('starting');
    if (!(await this._startSensors())) {
      this._mode.set('start');
      return;
    }
    this._recording?.beginFirst();
    this._mode.set('recording');
    this._sync();
  }

  /** "Resume from a place I marked": choose a mark on the map (target 7). */
  protected async resumeFromMark(): Promise<void> {
    this.picked.set(null);
    // What is left of the session ends first, so the resume follows a stop.
    this._recording?.endSession();
    this._sync();
    this._mode.set('where');
    this._recording?.startProbe();
    // The camera starts now, on this tap, so the new session is tracking by the
    // time a mark is chosen.
    if (this._session === null) {
      await this._startSensors();
    }
  }

  /**
   * A tap on the map while choosing where you are. Listened for on the host, not
   * in the template: the map is not a control, and the chips below it are the
   * way to choose a mark without touching the map.
   */
  private _mapClicked(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (this._mode() !== 'where' || !target?.closest('.map')) {
      return;
    }
    const index = this._view()?.markAt({ x: event.clientX, y: event.clientY });
    const mark =
      index === null || index === undefined
        ? null
        : (this._doc()?.marks[index] ?? null);
    if (mark !== null) {
      this.pick(mark);
    }
  }

  protected pick(mark: MapMark): void {
    this.picked.set(mark);
    this._drawWhere();
  }

  /** "Start from here": line the new session up on the chosen mark. */
  protected async startFromHere(): Promise<void> {
    const mark = this.picked();
    const recording = this._recording;
    // One at a time: a second tap during the wait would resume twice.
    if (mark === null || recording === null || this.resuming()) {
      return;
    }
    this.resuming.set(true);
    try {
      await this._resumeFrom(mark, recording);
    } finally {
      this.resuming.set(false);
    }
  }

  private async _resumeFrom(
    mark: MapMark,
    recording: WalkRecording
  ): Promise<void> {
    if (this._session === null && !(await this._startSensors())) {
      return;
    }
    // Wait for the camera to track, and for the compass when the walk's
    // baseline is known, so the new session is turned by it. The wait says so.
    const cancels = this._cancels;
    const cancelled = () =>
      cancels !== this._cancels ||
      this._mode() !== 'where' ||
      this._recording !== recording;
    const until = Date.now() + CAMERA_WAIT_MS;
    if (!recording.readyToResume) {
      this.notice.set('cameraWaiting');
    }
    while (!recording.readyToResume && Date.now() < until) {
      await delay(200);
      if (cancelled()) {
        // Closed, or the walk was read again, while waiting: resume nothing.
        // The notice is left alone: Close clears it, and a reload sets its own.
        return;
      }
    }
    if (cancelled()) {
      return;
    }
    if (!recording.resumeAt(mark)) {
      this.notice.set('cameraWaiting');
      return;
    }
    this.notice.set(null);
    this.picked.set(null);
    this._mode.set('recording');
    this._sync();
  }

  /** Close on "Where are you?": back to the stopped walk, or to the history. */
  protected closeWhere(): Promise<void> {
    this._cancels += 1;
    this.notice.set(null);
    if (this._phase() === 'stopped') {
      this._mode.set('recording');
      this.picked.set(null);
      this._sync();
      return Promise.resolve();
    }
    return this.leave();
  }

  // Walking.

  protected openMark(kind: MarkKind): void {
    this.pointing.set(this._recording?.pointing() ?? null);
    this.markKind.set(kind);
  }

  protected closeMark(): void {
    this.markKind.set(null);
  }

  /** Save mark: where the phone is and the way it points at this moment. */
  protected saveMark(saved: MarkSaved): void {
    // A mark needs good tracking at this moment. Without it the sheet stays
    // open with what was typed, and says why Save waits.
    if (this._recording?.mark(saved.kind, saved.text) == null) {
      return;
    }
    this.markKind.set(null);
    this._draw();
  }

  protected sectionLeft(): void {
    this._recording?.sectionLeft();
    this._draw();
  }

  protected suggestionTapped(id: string): void {
    if (this._phase() !== 'walking' || this._mode() !== 'recording') {
      return;
    }
    const found = this.live()?.snapshot.suggestions.find(
      (one) => one.id === id
    );
    if (found !== undefined) {
      this.suggestion.set(found);
    }
  }

  protected answerSuggestion(answer: SuggestionAnswer): void {
    const suggestion = this.suggestion();
    const recording = this._recording;
    this.suggestion.set(null);
    if (suggestion === null || recording === null) {
      return;
    }
    if (!answer.fill) {
      recording.dismissSuggestion(suggestion.id);
      this._draw();
      return;
    }
    const before = new Set(this._doc()?.areas.map((area) => area.id) ?? []);
    // The walk went on while the sheet was open, so the suggestion may have
    // grown under a new id: take the one that covers most of what was asked.
    recording.acceptSuggestion(
      sameSuggestion(suggestion, this._snapshot?.suggestions ?? [])?.id ??
        suggestion.id
    );
    this._draw();
    // The live map names the shelf from a mark that faced it. A section the
    // person chose instead is one more change to the area it made.
    const made = this._doc()?.areas.find(
      (area) => !before.has(area.id) && area.kind === 'shelf'
    );
    if (
      made !== undefined &&
      answer.section !== null &&
      answer.section !== made.section
    ) {
      this._edit([
        { type: 'area-put', area: renamedArea(made, answer.section) },
      ]);
    }
  }

  protected closeSuggestion(): void {
    this.suggestion.set(null);
  }

  protected confirmPath(): void {
    this._recording?.confirm();
    this._sync();
  }

  protected discardPath(): void {
    this._recording?.discard();
    this._sync();
  }

  // Editing while walking (target 5), as on the edit page of velista `0123`.

  protected changed(events: WalkEvent[]): void {
    const document = this._doc();
    for (const event of events) {
      if (
        event.type === 'area-put' &&
        !document?.areas.some((area) => area.id === event.area.id)
      ) {
        this._justDrawn = event.area.id;
      }
    }
    this._edit(events);
  }

  protected areaSelected(area: MapArea | null): void {
    if (this._mode() === 'where') {
      return;
    }
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
    if (this._mode() !== 'where') {
      this.press.set(press);
    }
  }

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
        ? [noteEvent(press.at, choice.text, this._saver.logEnd(), newId())]
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

  // Stopping and leaving.

  /** Stop: the walk pauses, is saved, and the history shows it (target 6). */
  protected async stop(): Promise<void> {
    this._recording?.stopWalk('button');
    this._endSensors();
    this._sync();
    await this.leave();
  }

  /** Back to the history. Asks first, and only then pops. */
  protected async leave(): Promise<void> {
    if (await this.canLeave()) {
      await this._pages.back(this._walkPath(null));
    }
  }

  async canLeave(): Promise<boolean> {
    this._leavePage(false);
    if (!this._saver.unsent()) {
      return true;
    }
    const outcome = await this._saver.save();
    if (outcome === 'changed' || outcome === 'refused') {
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

  /** For the template: the words of the status pill. */
  protected statusPill(screen: RecordScreen): {
    readonly key: string;
    readonly tone: 'ok' | 'attention' | 'neutral';
  } | null {
    switch (screen) {
      case 'walking':
        return { key: 'shopWalkRecord.status.good', tone: 'ok' };
      case 'lost':
        return { key: 'shopWalkRecord.status.lost', tone: 'attention' };
      case 'unconfirmed':
        return { key: 'shopWalkRecord.status.check', tone: 'attention' };
      case 'stopped':
        return { key: 'shopWalkRecord.status.stopped', tone: 'attention' };
      case 'starting':
        return { key: 'shopWalkRecord.status.starting', tone: 'neutral' };
      default:
        return null;
    }
  }

  /** For the template: "Section mark", "Counter mark" or "Note". */
  protected markKindKey(kind: MarkKind): string {
    return `shopWalkRecord.where.kind.${kind}`;
  }

  // Internals.

  private _walking(): boolean {
    const phase = this._phase();
    return (
      this._mode() === 'recording' &&
      (phase === 'walking' || phase === 'lost' || phase === 'unconfirmed')
    );
  }

  /**
   * Leaving the page stops the walk (target 6) and ends the camera. Hidden or
   * closed, what is held goes out with `keepalive`.
   */
  private _leavePage(keepalive: boolean): void {
    this._keepalive = keepalive;
    this._recording?.stopWalk('left-page');
    this._keepalive = false;
    this._endSensors();
    this.markKind.set(null);
    this.suggestion.set(null);
    if (this._mode() !== 'recording' && this._recording?.phase === 'stopped') {
      this._mode.set('recording');
    }
    this._sync();
    if (keepalive && this._saver.unsent()) {
      void this._saver.save({ keepalive: true });
    }
  }

  private async _startSensors(): Promise<boolean> {
    const root = this._host.nativeElement;
    const started = await this._sensors.start(root, {
      pose: (reading) => this._recording?.pose(reading),
      compass: (reading) => this._recording?.compass(reading),
      ended: () => {
        this._session = null;
        this._recording?.stopWalk('left-page');
        this._sync();
      },
    });
    if (started === 'unsupported') {
      this.supported.set(false);
      return false;
    }
    if (started === 'failed') {
      this.notice.set('cameraFailed');
      return false;
    }
    this._session = started;
    this._startDrawing();
    return true;
  }

  private _endSensors(): void {
    const session = this._session;
    this._session = null;
    session?.end();
  }

  private _startDrawing(): void {
    if (this._drawTimer === null) {
      this._drawTimer = setInterval(() => this._draw(), RECORD_DRAW_EVERY_MS);
    }
  }

  private _stopDrawing(): void {
    if (this._drawTimer !== null) {
      clearInterval(this._drawTimer);
      this._drawTimer = null;
    }
  }

  /** Flush what the walk made to the log and the map, and tell the canvas. */
  private _draw(): void {
    const recording = this._recording;
    if (recording === null) {
      return;
    }
    const snapshot = recording.flush(false);
    this._snapshot = snapshot;
    this._sync();
    if (this._mode() === 'where') {
      this._drawWhere();
      return;
    }
    const walking = recording.phase === 'walking';
    if (this.markKind() !== null) {
      this.pointing.set(recording.pointing());
    }
    const person = recording.person();
    const purple = recording.purple();
    this.live.set({
      snapshot: walking ? snapshot : { ...snapshot, suggestions: [] },
      ...(person !== null ? { person } : {}),
      ...(purple.length > 0 ? { unconfirmed: purple } : {}),
    });
    this.sectionRun.set(
      walking ? (snapshot.sectionRun?.section ?? null) : null
    );
  }

  /** While choosing a mark: the chosen one drawn as where to stand, facing its arrow. */
  private _drawWhere(): void {
    const mark = this.picked();
    const current = this.live();
    this.live.set({
      snapshot: {
        walkedCells: current?.snapshot.walkedCells ?? [],
        suggestions: [],
        sectionRun: null,
        events: [],
      },
      ...(mark !== null
        ? { person: { x: mark.x, y: mark.y, heading: mark.heading } }
        : {}),
    });
    this.sectionRun.set(null);
  }

  private _sync(): void {
    const recording = this._recording;
    this._phase.set(recording?.phase ?? 'idle');
    this._stop.set(recording?.stop ?? null);
  }

  private _edit(events: readonly WalkEvent[]): void {
    const document = this._doc();
    if (document === null) {
      return;
    }
    for (const event of events) {
      if (event.type === 'area-put' && this._justDrawn === event.area.id) {
        this._drawn.add(event.area.id);
      }
    }
    this._doc.set(applyEdits(document, events, this._saver.logEnd()));
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

  private _answered(leave: boolean): void {
    this.asking.set(false);
    const answer = this._answer;
    this._answer = null;
    answer?.(leave);
  }

  private async _load(walkId: string): Promise<void> {
    this.read.set({ kind: 'loading' });
    await this._walks.loadWalk(walkId);
    this._adopt(walkId);
  }

  /** Another phone saved first, or the server refused an entry: stop, and read the walk again. */
  private async _reload(notice: 'changed' | 'refused'): Promise<void> {
    this._cancels += 1;
    this._endSensors();
    this._stopDrawing();
    this._recording = null;
    this._sync();
    this.notice.set(notice);
    this.markKind.set(null);
    this.suggestion.set(null);
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
    const fresh = detail.timeline.length === 0;
    this._drawn.clear();
    this._justDrawn = null;
    this._doc.set(detail.document);
    this._saver.begin({
      walkId,
      baseSeq: detail.walk.lastSeq,
      logTo: last?.logTo ?? 0,
      kind: fresh ? 'started' : 'resumed',
      thenKind: 'continued',
      retryMs: RECORD_RETRY_MS,
    });
    this._recording = new WalkRecording({
      document: detail.document,
      settings: {
        idPrefix: `live-${newId().slice(0, 8)}-`,
        walkingAcrossMakesPath:
          this._settings.settings().walkingAcrossMakesPath,
      },
      baseline: readWalkBaseline(this._browser, walkId),
      createId: newId,
      output: {
        add: (events, logTo) => {
          const drawn = events.filter((event) => event.type !== 'path');
          const document = this._doc();
          if (drawn.length > 0 && document !== null) {
            this._doc.set(applyEdits(document, drawn, logTo));
          }
          this._saver.add(events, logTo);
        },
        push: (draft) => this._saver.push(draft),
        openNext: (kind) => this._saver.openNext(kind),
        logEnd: () => this._saver.logEnd(),
        save: () =>
          void this._saver.save(this._keepalive ? { keepalive: true } : {}),
        tone: (kind) =>
          kind === 'stopped' ? this._tones.stopped() : this._tones.resumed(),
        baseline: (degrees) =>
          writeWalkBaseline(this._browser, walkId, degrees),
      },
    });
    this._sync();
    this._mode.set(fresh ? 'start' : 'where');
    if (!fresh) {
      // The probe learns the compass offset while a mark is chosen, so the
      // resume can be turned by the walk's baseline.
      this._recording.startProbe();
    }
    this.live.set(null);
    this.read.set({ kind: 'ready', detail });
  }

  private _walkPath(page: 'record' | null): string {
    return shopWalkPath(
      this._locale(),
      this._basePath,
      this.locationId(),
      this.walkId(),
      page
    );
  }
}

/**
 * The suggestion of `current` that is `asked`, or has grown out of it: the same
 * id, else the one that overlaps it most. Null when none overlaps.
 */
export function sameSuggestion(
  asked: ShelfSuggestion,
  current: readonly ShelfSuggestion[]
): ShelfSuggestion | null {
  const same = current.find((one) => one.id === asked.id);
  if (same !== undefined) {
    return same;
  }
  let best: ShelfSuggestion | null = null;
  let bestArea = 0;
  for (const one of current) {
    const w =
      Math.min(one.x + one.w, asked.x + asked.w) - Math.max(one.x, asked.x);
    const h =
      Math.min(one.y + one.h, asked.y + asked.h) - Math.max(one.y, asked.y);
    if (w > 0 && h > 0 && w * h > bestArea) {
      best = one;
      bestArea = w * h;
    }
  }
  return best;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A uuid for a mark, a drawn area or a note. */
function newId(): string {
  const crypto = globalThis.crypto;
  if (crypto !== undefined && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const hex = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}
