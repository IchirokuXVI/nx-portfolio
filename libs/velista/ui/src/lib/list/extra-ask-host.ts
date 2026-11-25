import {
  afterEveryRender,
  afterNextRender,
  computed,
  DestroyRef,
  inject,
  Injectable,
  Injector,
  signal,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import {
  EXTRA_ASK_FLASH_MS,
  type AbsorbedExtra,
  type LineUnit,
} from '@portfolio/velista/models';
import { BrowserFacade } from '@portfolio/velista/platform';
import type {
  AnchoredPopoverClose,
  AnchoredPopoverSide,
} from './anchored-popover';
import {
  scrollAreaOf,
  scrollToShow,
  sideIn,
  typingIn,
  visibleBand,
  type Band,
} from './extra-ask-place';
import { extraAskWords, type ExtraAskWords } from './extra-ask-words';

/**
 * The longest a question waits for the smooth scroll that brings its control into
 * view to end, for a browser that sends no `scrollend` or a scroll that went
 * nowhere.
 */
export const EXTRA_ASK_SCROLL_WAIT_MS = 700;

/** How long the polite region stays empty before a sentence that repeats. */
const REPEAT_SAY_GAP_MS = 150;

/** What the host's call of "Count the extra" came to (velista `0208`, target state 4). */
export type ExtraCountOutcome = 'done' | 'stale' | 'failed';

/**
 * One question about the extra already bought, as the page or sheet that shows the
 * control hands it over (velista `0208`, target state 10). Every element is read
 * through a function, at the moment it is needed, so a control drawn again since
 * the raise is the one the popover points at, and one that left is noticed.
 */
export interface ExtraAskRequest {
  readonly lineId: string;
  /** The line's group, whose members the words name. */
  readonly zoneId: string;
  readonly unit: LineUnit;
  /** What the raise took in. Asked only with `countable > 0`. */
  readonly extra: AbsorbedExtra;
  /** Y: what the control shows, and what "Still need" leaves. */
  readonly shown: number;
  /** The control that raised the line, or null once it is gone. */
  readonly origin: () => HTMLElement | null;
  /**
   * What must stay in sight beside the popover: the row, the card or the table
   * row. Null for the control alone.
   */
  readonly keepInSight: () => HTMLElement | null;
  /**
   * The element the popover is held against, when that is not the control: the
   * zone list lays a mark over the control beside its row, because the row is a
   * button and nothing may be inserted in it. Called when the popover opens.
   */
  readonly holdAgainst?: () => HTMLElement | null;
  /** "Count the extra": the host's call of its store's `countExtra`. */
  readonly count: () => Promise<ExtraCountOutcome>;
  /** No sheet, dialog or other popover over the control, and the page not hidden. */
  readonly inFront: () => boolean;
  /** The control at rest: false while a reel's tape is up. Absent is always. */
  readonly atRest?: () => boolean;
  /** Still the newest answer about this control. Absent is always. */
  readonly current?: () => boolean;
  /** The side the board draws it on. Absent is by the control's place. */
  readonly side?: AnchoredPopoverSide;
}

/**
 * What a host page or sheet tells the piece once (velista `0208`, target state 10):
 * where it scrolls, who is reading, how a buyer is named, and its polite region.
 */
export interface ExtraAskHostSetup {
  /**
   * The container the page or sheet scrolls in. Absent is the nearest scrolling
   * ancestor of the control.
   */
  readonly area?: () => Element | null;
  /** The part of the screen the area shows, when it is not the area's own box. */
  readonly band?: () => Band | null;
  readonly readerId: () => string | null;
  /** A member's name in the line's group, or null for "Someone". */
  readonly nameOf: (zoneId: string, userId: string) => string | null;
  /**
   * The page's own polite region, which says a sentence again when it repeats.
   * Absent, the popover's own region says it.
   */
  readonly say?: (sentence: string) => void;
}

/** The open question, as the popover reads it. */
export interface ExtraAskOpen {
  readonly request: ExtraAskRequest;
  readonly lineId: string;
  /** Y. */
  readonly quantity: number;
  /** The control. */
  readonly anchor: HTMLElement;
  /** What the popover is held against: the control, or the zone list's mark. */
  readonly origin: HTMLElement;
  readonly keepInSight: HTMLElement;
  readonly side: AnchoredPopoverSide;
  /** Whether it is drawn: false while the control is being brought into view. */
  readonly shown: boolean;
  /** Whether focus moves to "Still need": false while somebody types. */
  readonly takeFocus: boolean;
}

/** A count that wrote nothing, said in the question's place. */
export interface ExtraNoticeOpen {
  readonly lineId: string;
  readonly key: 'list.extra.stale' | 'list.extra.countFailed';
  readonly origin: HTMLElement;
  readonly anchor: HTMLElement;
  readonly keepInSight: HTMLElement;
  readonly side: AnchoredPopoverSide;
}

let hostCount = 0;

/**
 * How far to scroll so what stays in sight is wholly in view, or 0 when it is. A
 * card taller than the visible area can never be: then the control alone is
 * brought into view, which is what the question points at.
 */
function scrollFor(band: Band, sight: Element, control: Element): number {
  return tallerThan(band, sight)
    ? scrollToShow(band, control.getBoundingClientRect())
    : scrollToShow(band, sight.getBoundingClientRect());
}

/** Whether an element is taller than the visible band, so it can never be whole in it. */
function tallerThan(band: Band, element: Element): boolean {
  const box = element.getBoundingClientRect();
  return box.bottom - box.top > band.bottom - band.top;
}

/** Whether the control, the element held against and what stays in sight are drawn. */
function drawn(open: {
  readonly anchor: HTMLElement;
  readonly origin: HTMLElement;
  readonly keepInSight: HTMLElement;
}): boolean {
  return (
    open.anchor.isConnected &&
    open.origin.isConnected &&
    open.keepInSight.isConnected
  );
}

/**
 * The question a raise asks about the extra already bought (velista `0207`,
 * `0208`), one per page or sheet that shows it: provided by that component, so it
 * goes with it, and read by the `lib-extra-ask-popover` in its template.
 *
 * It holds the rules every control shares: one question at a time, a new one
 * replacing the old with no answer; the "still there" rule; the scroll that brings
 * the control into view; the words; focus on "Still need" unless somebody types;
 * the flash; the answers, of which only "Count the extra" writes, through the
 * host's own `count`; and the notice a count that wrote nothing leaves. It knows
 * nothing of a store: each host passes its write in.
 */
@Injectable()
export class ExtraAskHost {
  private readonly _translator = inject(RokuTranslatorService);
  private readonly _locale = inject(RokuLocaleStore).locale;
  private readonly _injector = inject(Injector);
  private readonly _reducedMotion = inject(BrowserFacade).matchMedia(
    '(prefers-reduced-motion: reduce)'
  );

  private _setup: ExtraAskHostSetup = {
    readerId: () => null,
    nameOf: () => null,
  };
  private _destroyed = false;

  private readonly _asked = signal<ExtraAskOpen | null>(null);
  private readonly _notice = signal<ExtraNoticeOpen | null>(null);
  private readonly _flashing = signal(false);
  private readonly _announcement = signal('');

  /** The open question, drawn once `shown`. */
  readonly asked = this._asked.asReadonly();

  /** The notice of a count that wrote nothing, until the next touch. */
  readonly notice = this._notice.asReadonly();

  /** Whether the open question and its control are flashing (`0207` target 12). */
  readonly flashing = this._flashing.asReadonly();

  /** The line whose control draws the flash: the question's, once it is drawn. */
  readonly askedId = computed(() => {
    const asked = this._asked();
    return asked?.shown ? asked.lineId : null;
  });

  /** The popover's own polite region, for a host with none of its own. */
  readonly announcement = this._announcement.asReadonly();

  /** Whether the popover draws its own polite region. */
  readonly ownRegion = signal(true);

  /** The id of the question's title, for the dialog around it. */
  readonly titleId = `extra-ask-title-${++hostCount}`;

  /**
   * What the open question says (velista `0207`, targets 5 and 6; `0208`, target
   * state 3): Y what the control shows, Z what "Count the extra" leaves, X the
   * extra the raise took in.
   */
  readonly words = computed<ExtraAskWords | null>(() => {
    const asked = this._asked();
    if (asked === null) {
      return null;
    }
    // Read so the words follow a language switch and the first load of the keys.
    this._translator.loaded();
    const locale = this._locale();
    const { request } = asked;
    return extraAskWords({
      extra: request.extra,
      shown: asked.quantity,
      after: asked.quantity - request.extra.countable,
      unit: request.unit,
      locale,
      readerId: this._setup.readerId(),
      nameOf: (userId) => this._setup.nameOf(request.zoneId, userId),
      t: (key, args) => this._translator.t(key, undefined, locale, args),
    });
  });

  /** The notice's sentence, in the page's language. */
  readonly noticeWords = computed<string | null>(() => {
    const notice = this._notice();
    if (notice === null) {
      return null;
    }
    this._translator.loaded();
    return this._translator.t(notice.key, undefined, this._locale());
  });

  /** An answer that came while the control's reel was up, asked once it is down. */
  private _waiting: ExtraAskRequest | null = null;
  private _waitObserver: MutationObserver | null = null;

  private _flashTimer: ReturnType<typeof setTimeout> | null = null;
  private _flashed: { element: HTMLElement; value: string } | null = null;
  private _scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private _scrollEnded: (() => void) | null = null;
  private _scrollArea: Element | null = null;
  private _sayTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // A control that is no longer drawn (a new search, a filter, a delete, a switch
    // of view) takes its question down with no answer, as a press outside would:
    // the amount set stands. Its notice goes the same way.
    // After every render, since what takes a control away is the page's template,
    // which no signal of this piece hears.
    afterEveryRender(() => {
      const asked = this._asked();
      if (asked !== null && !drawn(asked)) {
        this.close('detach');
      }
      const notice = this._notice();
      if (notice !== null && !drawn(notice)) {
        this.closeNotice();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      this._destroyed = true;
      this._stopWaiting();
      this._clearScrollWait();
      this._stopFlash();
      if (this._sayTimer !== null) {
        clearTimeout(this._sayTimer);
      }
    });
  }

  /** What the host tells the piece, once, from its constructor. */
  connect(setup: ExtraAskHostSetup): void {
    this._setup = setup;
    this.ownRegion.set(setup.say === undefined);
  }

  /**
   * Ask, if the control is still there (velista `0208`, target state 10, the
   * owner's answer 3): connected, in front, and the answer still the newest about
   * it. A control whose reel is up waits until it is down and is checked again.
   * Otherwise the question is dropped and the amount set stands, with nothing
   * sent. A report that offers nothing to count asks nothing.
   */
  ask(request: ExtraAskRequest): void {
    if (
      this._destroyed ||
      request.extra.countable <= 0 ||
      request.extra.countable > request.shown ||
      !this._stillThere(request)
    ) {
      return;
    }
    if (request.atRest !== undefined && !request.atRest()) {
      this._wait(request);
      return;
    }
    if (this._waiting?.lineId === request.lineId) {
      this._stopWaiting();
    }
    this._open(request);
  }

  /** The host's control came to rest: a question waiting for it is checked again. */
  rested(): void {
    const waiting = this._waiting;
    if (waiting === null) {
      return;
    }
    if (waiting.atRest !== undefined && !waiting.atRest()) {
      return;
    }
    this._stopWaiting();
    this.ask(waiting);
  }

  /** A newer write of the line went out: a question waiting for its rest is dropped. */
  dropWaiting(lineId?: string): void {
    if (lineId === undefined || this._waiting?.lineId === lineId) {
      this._stopWaiting();
    }
  }

  /**
   * Something came in front of the page, or the page is going (a sheet opened over
   * it): the waiting question, the open one and the notice all go, with no answer
   * and no focus moved. The amount set stands.
   */
  drop(): void {
    this._stopWaiting();
    const asked = this._asked();
    if (asked !== null) {
      this._close(asked, false);
    }
    this.closeNotice();
  }

  /**
   * "Still need" (velista `0208`, target state 4): the popover closes and nothing is
   * sent, because the raise already wrote this outcome. The control keeps Y.
   */
  answerStillNeed(): void {
    const asked = this._asked();
    if (asked !== null) {
      this._close(asked, true);
    }
  }

  /**
   * "Count the extra" or "That's enough", the one answer that writes: the host's
   * `count`, which shows Z at once. A refusal says `list.extra.stale` in the
   * question's place, any other failure `list.extra.countFailed`.
   */
  answerCount(): void {
    const asked = this._asked();
    if (asked === null) {
      return;
    }
    const counting = this._close(asked, true, () => asked.request.count());
    void counting?.then(
      (outcome) => {
        if (outcome !== 'done') {
          this._noticeOn(
            asked.request,
            asked.side,
            outcome === 'stale' ? 'list.extra.stale' : 'list.extra.countFailed'
          );
        }
      },
      () => this._noticeOn(asked.request, asked.side, 'list.extra.countFailed')
    );
  }

  /**
   * No answer: Escape, a press outside, the back gesture, a press on the control,
   * the control going away, or another line's question. Nothing is sent and the
   * control keeps Y. Focus goes back to the control after Escape.
   */
  close(reason: AnchoredPopoverClose | 'replaced'): void {
    const asked = this._asked();
    if (asked !== null) {
      this._close(asked, reason === 'escape');
    }
  }

  /** Take the notice down: the next touch, Escape, leaving, or its control going away. */
  closeNotice(): void {
    if (this._notice() !== null) {
      this._notice.set(null);
    }
  }

  /** Whether the request's control is still on this page or sheet, in front of it. */
  private _stillThere(request: ExtraAskRequest): boolean {
    const control = request.origin();
    return (
      control !== null &&
      control.isConnected &&
      request.inFront() &&
      (request.current === undefined || request.current())
    );
  }

  /**
   * Hold the question until the control is at rest: the host says so through
   * {@link rested}, and a change of the control's classes (a reel's tape coming
   * down) checks again too.
   */
  private _wait(request: ExtraAskRequest): void {
    this._stopWaiting();
    this._waiting = request;
    const control = request.origin();
    const Observer = control?.ownerDocument.defaultView?.MutationObserver;
    if (control !== null && Observer !== undefined) {
      this._waitObserver = new Observer(() => this.rested());
      this._waitObserver.observe(control, {
        attributes: true,
        attributeFilter: ['class'],
      });
    }
  }

  private _stopWaiting(): void {
    this._waiting = null;
    this._waitObserver?.disconnect();
    this._waitObserver = null;
  }

  /** The area the control scrolls in, and what of it can be seen. */
  private _view(control: HTMLElement): { area: Element; band: Band } {
    const area = this._setup.area?.() ?? scrollAreaOf(control);
    const height = control.ownerDocument.defaultView?.innerHeight ?? Infinity;
    return {
      area,
      band: this._setup.band?.() ?? visibleBand(area, height),
    };
  }

  /**
   * Open the question on its control (`0207` targets 4, 7, 11 and 12; `0208`,
   * target state 10). Another open question closes first, with no answer. A
   * control not wholly in view is scrolled to first, then the popover opens; a
   * person who scrolls it away meanwhile gets one more scroll's end to bring it
   * back, and after that the question is dropped.
   */
  private _open(request: ExtraAskRequest): void {
    const anchor = request.origin();
    if (anchor === null) {
      return;
    }
    const keep = request.keepInSight() ?? anchor;
    if (this._asked() !== null) {
      this.close('replaced');
    }
    this.closeNotice();
    const { area, band } = this._view(anchor);
    const scroll = scrollFor(band, keep, anchor);
    const doc = anchor.ownerDocument;

    // The owner's answer 3 (velista `0208`): a control that is still on this page
    // or sheet but out of sight is scrolled into view, and then asked about. The
    // owner weighed one alternative and may switch to it: ask only when some part
    // of the control is still visible, and otherwise take the default with no
    // question, because a scroll nobody asked for, seconds or minutes after the
    // tap, may feel invasive. That alternative is a check of `scroll` here that
    // drops the question when the control's box lies wholly outside `band`.
    //
    // Never a scroll of an area that holds a focused text field (the plan's action
    // boundary): moving the field under somebody typing is not ours to decide, so
    // the question is dropped there and the amount set stands.
    const active = doc.activeElement;
    if (scroll !== 0 && typingIn(active) && area.contains(active)) {
      return;
    }

    const state: ExtraAskOpen = {
      request,
      lineId: request.lineId,
      quantity: request.shown,
      anchor,
      origin: anchor,
      keepInSight: keep,
      side: request.side ?? sideIn(band, keep.getBoundingClientRect()),
      shown: false,
      takeFocus: true,
    };
    this._asked.set(state);

    let retried = false;
    const show = () => {
      this._clearScrollWait();
      if (this._asked() !== state || this._destroyed) {
        return;
      }
      const control = request.origin();
      if (control === null || !this._stillThere(request)) {
        this._close(state, false);
        return;
      }
      const sight = request.keepInSight() ?? control;
      const now = this._view(control).band;
      if (scrollFor(now, sight, control) !== 0) {
        // Out of view after the scroll: the person scrolled by hand. One more end
        // of a scroll, then the amount set stands with no answer.
        if (retried) {
          this._close(state, false);
          return;
        }
        retried = true;
        this._waitScroll(area, show);
        return;
      }
      const held = request.holdAgainst?.() ?? control;
      // A card taller than what the page shows cannot stay in sight whole: the
      // popover keeps to the control instead, on the side with room, or it would
      // be pushed past the card's edge, off the screen.
      const tall = tallerThan(now, sight);
      const kept = tall ? control : sight;
      // Somebody typing keeps the field: the question is said, not focused.
      const typing = typingIn(doc.activeElement);
      this._asked.set({
        ...state,
        anchor: control,
        origin: held,
        keepInSight: kept,
        side:
          (tall ? undefined : request.side) ??
          sideIn(now, kept.getBoundingClientRect()),
        shown: true,
        takeFocus: !typing,
      });
      if (typing) {
        this._sayQuestion();
      }
      this._flash(held);
    };

    if (scroll === 0) {
      show();
      return;
    }
    const reduced = this._reducedMotion();
    area.scrollBy?.({ top: scroll, behavior: reduced ? 'instant' : 'smooth' });
    if (reduced) {
      show();
      return;
    }
    this._waitScroll(area, show);
  }

  /** Wait for the area's `scrollend`, or {@link EXTRA_ASK_SCROLL_WAIT_MS}. */
  private _waitScroll(area: Element, then: () => void): void {
    this._clearScrollWait();
    const ended = () => then();
    this._scrollEnded = ended;
    this._scrollArea = area;
    // The document's scrolling element sends its `scrollend` to the document.
    const target =
      area === area.ownerDocument.scrollingElement ? area.ownerDocument : area;
    target.addEventListener('scrollend', ended, { once: true });
    this._scrollTimer = setTimeout(ended, EXTRA_ASK_SCROLL_WAIT_MS);
  }

  private _clearScrollWait(): void {
    if (this._scrollTimer !== null) {
      clearTimeout(this._scrollTimer);
      this._scrollTimer = null;
    }
    if (this._scrollEnded !== null && this._scrollArea !== null) {
      const area = this._scrollArea;
      const target =
        area === area.ownerDocument.scrollingElement
          ? area.ownerDocument
          : area;
      target.removeEventListener('scrollend', this._scrollEnded);
    }
    this._scrollEnded = null;
    this._scrollArea = null;
  }

  /** The question and its two answers in the polite region, for somebody typing. */
  private _sayQuestion(): void {
    const words = this.words();
    if (words === null) {
      return;
    }
    const answer = (one: { words: string; amount: string | null }) =>
      one.amount === null ? one.words : `${one.words} ${one.amount}`;
    this._say(
      this._translator.t('list.extra.announce', undefined, undefined, {
        question: words.question,
        stillNeed: answer(words.stillNeed),
        keep: answer(words.keep),
      })
    );
  }

  /**
   * A sentence in the polite region, which says it again when it repeats: the
   * host's own region through `say`, or the popover's, emptied and filled again a
   * moment later, because the same text twice is no change a screen reader hears.
   */
  private _say(sentence: string): void {
    const say = this._setup.say;
    if (say !== undefined) {
      say(sentence);
      return;
    }
    if (this._sayTimer !== null) {
      clearTimeout(this._sayTimer);
      this._sayTimer = null;
    }
    if (this._announcement() !== sentence) {
      this._announcement.set(sentence);
      return;
    }
    this._announcement.set('');
    this._sayTimer = setTimeout(() => {
      this._sayTimer = null;
      this._announcement.set(sentence);
    }, REPEAT_SAY_GAP_MS);
  }

  /**
   * Three pulses, or the frame held still under reduced motion, then nothing. The
   * zone list draws the pulses on its row through {@link flashing}; any other host
   * gets the accent frame held for the same time, set on the element the popover
   * is inserted beside, whose colour the popover's border reads.
   */
  private _flash(held: HTMLElement): void {
    this._stopFlash();
    this._flashing.set(true);
    const parent = held.parentElement;
    if (parent !== null && !parent.matches('li.line')) {
      this._flashed = {
        element: parent,
        value: parent.style.getPropertyValue('--anchored-popover-accent'),
      };
      parent.style.setProperty(
        '--anchored-popover-accent',
        'var(--app-action-quiet-fg)'
      );
    }
    this._flashTimer = setTimeout(() => {
      this._flashTimer = null;
      this._stopFlash();
    }, EXTRA_ASK_FLASH_MS);
  }

  private _stopFlash(): void {
    if (this._flashTimer !== null) {
      clearTimeout(this._flashTimer);
      this._flashTimer = null;
    }
    if (this._flashed !== null) {
      const { element, value } = this._flashed;
      if (value === '') {
        element.style.removeProperty('--anchored-popover-accent');
      } else {
        element.style.setProperty('--anchored-popover-accent', value);
      }
      this._flashed = null;
    }
    this._flashing.set(false);
  }

  /**
   * Take the question down. `change`, an answer's write, runs once focus has been
   * read. Focus goes back to the control only from the question itself or from
   * nowhere: a person typing in a field keeps it.
   */
  private _close<T>(
    asked: ExtraAskOpen,
    focusBack: boolean,
    change?: () => T
  ): T | undefined {
    const doc = asked.anchor.ownerDocument;
    const active = doc.activeElement;
    const fromAsk =
      active === null ||
      active === doc.body ||
      active.closest('lib-extra-ask') !== null;
    this._clearScrollWait();
    this._stopFlash();
    this._asked.set(null);
    const changed = change?.();
    if (!focusBack || !fromAsk || !asked.shown) {
      return changed;
    }
    afterNextRender(
      () => {
        if (this._destroyed) {
          return;
        }
        const control = asked.request.origin();
        if (control === null || !control.isConnected) {
          return;
        }
        const target = control.matches('[tabindex], button')
          ? control
          : (control.querySelector<HTMLElement>('.step.plus') ??
            control.querySelector<HTMLElement>('button, [tabindex]'));
        target?.focus();
      },
      { injector: this._injector }
    );
    return changed;
  }

  /**
   * Say a count's outcome where the question was (velista `0208`, target state 4):
   * in the polite region, and in the same anchored frame with its pointer on the
   * control, once the control is drawn again at the amount its store holds. A
   * control that is gone, or something in front, gets the sentence alone.
   */
  private _noticeOn(
    request: ExtraAskRequest,
    side: AnchoredPopoverSide,
    key: ExtraNoticeOpen['key']
  ): void {
    if (this._destroyed) {
      return;
    }
    this._say(this._translator.t(key));
    afterNextRender(
      () => {
        if (this._destroyed || this._asked() !== null) {
          return;
        }
        const control = request.origin();
        if (control === null || !control.isConnected || !request.inFront()) {
          return;
        }
        const keep = request.keepInSight() ?? control;
        this._notice.set({
          lineId: request.lineId,
          key,
          anchor: control,
          origin: request.holdAgainst?.() ?? control,
          keepInSight: keep,
          side: request.side ?? side,
        });
      },
      { injector: this._injector }
    );
  }
}
