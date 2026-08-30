import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { PauseIcon, PlayIcon } from '../icons/icons';

/**
 * Every player currently holding a media element, so starting one can stop the
 * others (plan 0039, section 4).
 *
 * A module level set rather than a service, because the rule is about the browser
 * rather than about the app: two comments talking over each other in a thread is
 * never what anybody meant, and the thing that has to stop is whatever else is
 * making noise, wherever it was drawn. Entries remove themselves on destroy.
 */
const playing = new Set<{ pause(): void }>();

/**
 * A voice message, playable.
 *
 * Rule D1: it does not know what a comment is and it certainly does not know about
 * the API. What it takes is a way to get the bytes and a length, and both of those
 * are the shape they are for a reason.
 *
 * ## `load` is a function, not a URL
 *
 * The route the bytes come from is gated on read access to the list, and an `audio`
 * element cannot carry an `Authorization` header, so somebody has to fetch them
 * with a token and hand back something playable. Taking a function rather than a
 * resolved URL is what keeps that fetch **lazy**: a thread with fifteen voice
 * comments must not fetch fifteen files because somebody opened it, so nothing
 * happens until play is pressed. A resolved URL as an input would mean the parent
 * had already downloaded it.
 *
 * ## The element is created on first play
 *
 * Not one per row on render. Fifteen `audio` elements in a scrolling list is
 * fifteen media resources the browser is managing for no reason, and the length is
 * drawn from {@link durationSeconds} rather than from the file precisely so the row
 * is correct before anything exists.
 *
 * ## Keyboard and screen reader
 *
 * One real `button`, so it is reachable and pressable without a pointer, and its
 * label says which of play and pause it will do. The position is announced
 * `polite` and only on the second, never on the tick, because a live region that
 * updates four times a second is a screen reader nobody can use.
 */
@Component({
  selector: 'lib-audio-player',
  imports: [RokuTranslatorPipe, PlayIcon, PauseIcon],
  template: `
    <div class="player">
      <button
        (click)="toggle()"
        [attr.aria-label]="(busy() ? 'list.comments.play' : label()) | rokuT"
        [disabled]="busy()"
        class="control"
        type="button"
      >
        @if (isPlaying()) {
          <lib-pause-icon class="glyph" />
        } @else {
          <lib-play-icon class="glyph" />
        }
      </button>

      <div
        (pointerdown)="scrub($event)"
        [attr.aria-valuemax]="total() ?? 0"
        [attr.aria-valuemin]="0"
        [attr.aria-valuenow]="Math.floor(position())"
        [attr.aria-valuetext]="spoken()"
        class="track"
        role="slider"
        tabindex="-1"
      >
        <div [style.inline-size.%]="progress()" class="fill"></div>
      </div>

      <!--
        Elapsed while playing, total before. One number rather than "0:03 / 0:41",
        because the row is narrow and the thing somebody wants to know before
        pressing play is how long this will take.
      -->
      <span aria-hidden="true" class="clock">{{ clock() }}</span>

      <!--
        The position, said once at the end of a stretch of playing. A live region
        on the clock itself would announce every animation frame, which is a
        screen reader nobody can use.
      -->
      <span aria-live="polite" class="sr-only">{{ announced() }}</span>

      @if (failed()) {
        <span class="failed" role="alert">
          {{ 'list.comments.playFailed' | rokuT }}
        </span>
      }
    </div>
  `,
  styleUrl: './audio-player.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AudioPlayer {
  /**
   * Fetches the recording and resolves something an `audio` element can play.
   *
   * Called at most once per player: the result is kept, so pausing and playing
   * again does not download it a second time.
   */
  readonly load = input.required<() => Promise<string>>();

  /**
   * How long it runs, when the caller knows.
   *
   * Null draws a placeholder rather than `0:00`, which would be a lie about a file
   * nobody has fetched. Once the element has loaded, its own duration wins, since
   * by then there is a real answer.
   */
  readonly durationSeconds = input<number | null>(null);

  readonly isPlaying = signal(false);
  readonly busy = signal(false);
  readonly failed = signal(false);
  readonly position = signal(0);

  /** Exposed for the template's `Math.floor`, which cannot reach a global. */
  protected readonly Math = Math;

  private _element: HTMLAudioElement | null = null;
  private _url: string | null = null;
  /** The element's own duration once it is known, which beats the input's. */
  private readonly _measured = signal<number | null>(null);
  private readonly _announced = signal('');

  readonly total = computed(() => this._measured() ?? this.durationSeconds());

  readonly progress = computed(() => {
    const total = this.total();
    if (total === null || total <= 0) {
      return 0;
    }
    return Math.min(100, (this.position() / total) * 100);
  });

  readonly clock = computed(() => {
    const seconds = this.isPlaying() ? this.position() : (this.total() ?? null);
    return seconds === null ? '--:--' : formatClock(seconds);
  });

  readonly label = computed(() =>
    this.isPlaying() ? 'list.comments.pause' : 'list.comments.play'
  );

  readonly announced = computed(() => this._announced());

  readonly spoken = computed(() => {
    const total = this.total();
    return total === null
      ? formatClock(this.position())
      : `${formatClock(this.position())} of ${formatClock(total)}`;
  });

  constructor() {
    // The element, its object URL and this player's place in the "one at a time"
    // set all go together. Without the revoke the whole recording stays in memory
    // for as long as the tab is open, once per comment somebody played.
    inject(DestroyRef).onDestroy(() => this._release());
  }

  async toggle(): Promise<void> {
    if (this.isPlaying()) {
      this._element?.pause();
      return;
    }

    this.failed.set(false);

    try {
      const element = await this._ensureElement();

      // One at a time. Whatever else is making noise stops before this starts, so
      // two comments never talk over each other.
      for (const other of playing) {
        if (other !== this._self) {
          other.pause();
        }
      }

      await element.play();
    } catch {
      // A refused autoplay, a fetch that failed, a format the browser will not
      // take: they read the same from here, and the row says so in one line
      // rather than throwing into the console.
      this.failed.set(true);
      this.isPlaying.set(false);
      this.busy.set(false);
    }
  }

  /** Jump to a point in the track. Only meaningful once something is loaded. */
  scrub(event: PointerEvent): void {
    const element = this._element;
    const total = this.total();
    if (element === null || total === null || total <= 0) {
      return;
    }

    const track = event.currentTarget as HTMLElement;
    const box = track.getBoundingClientRect();
    if (box.width === 0) {
      return;
    }

    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - box.left) / box.width)
    );
    element.currentTime = ratio * total;
    this.position.set(element.currentTime);
  }

  /** This player's handle in the module level set, stable across calls. */
  private readonly _self = { pause: () => this._element?.pause() };

  private async _ensureElement(): Promise<HTMLAudioElement> {
    if (this._element !== null) {
      return this._element;
    }

    this.busy.set(true);
    try {
      const url = await this.load()();
      this._url = url;

      const element = new Audio(url);
      // Nothing preloads, here as well as at the row: this element is created by
      // a press, and telling the browser to buffer ahead of one would undo the
      // laziness the whole design is for.
      element.preload = 'none';

      element.addEventListener('play', () => {
        this.isPlaying.set(true);
        playing.add(this._self);
      });
      element.addEventListener('pause', () => {
        this.isPlaying.set(false);
        playing.delete(this._self);
        this._announce();
      });
      element.addEventListener('ended', () => {
        this.isPlaying.set(false);
        this.position.set(0);
        playing.delete(this._self);
      });
      element.addEventListener('timeupdate', () => {
        this.position.set(element.currentTime);
      });
      element.addEventListener('loadedmetadata', () => {
        // A stored duration can be wrong: it is what a client claimed, and the
        // server never checked it. The file's own is the truth once it exists.
        if (Number.isFinite(element.duration) && element.duration > 0) {
          this._measured.set(element.duration);
        }
      });
      element.addEventListener('error', () => {
        this.failed.set(true);
        this.isPlaying.set(false);
      });

      this._element = element;
      return element;
    } finally {
      this.busy.set(false);
    }
  }

  private _announce(): void {
    this._announced.set(this.spoken());
  }

  private _release(): void {
    playing.delete(this._self);
    this._element?.pause();
    this._element = null;
    if (this._url !== null) {
      URL.revokeObjectURL(this._url);
      this._url = null;
    }
  }
}

/** `m:ss`, which is the only shape a message on a shopping list ever needs. */
function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${String(whole % 60).padStart(2, '0')}`;
}
