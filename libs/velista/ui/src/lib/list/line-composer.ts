import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  output,
  signal,
  viewChild,
  type ElementRef,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  catalogName,
  LINE_CONTENT_COUNTER_FROM,
  LINE_CONTENT_MAX_LENGTH,
  type CatalogSuggestion,
  type RecordedAudio,
} from '@portfolio/velista/models';
import {
  AudioRecorder,
  SILENCE_DETECTOR,
  type SilenceDetectorI,
  type SilenceWatch,
} from '@portfolio/velista/platform';
import { MicIcon, PlusIcon, StopIcon, TrashIcon } from '../icons/icons';
import { QuantityStepper } from './quantity-stepper';

/** What the one button at the end of the row is for. */
export type LineComposerButton = 'add' | 'record';

/** One line sent from the composer. */
export interface LineComposerSubmit {
  readonly content: string;
  readonly quantity: number;
  readonly itemIds?: readonly string[];
  /**
   * The button that sent it, the plus or a card's add button. Only a composer with
   * `holdOnSend` on names it, for the container to hold a picker against.
   */
  readonly anchor?: HTMLElement;
}

/**
 * The field at the bottom of the list, and the reason this screen has no floating
 * action button.
 *
 * ## Adding happens in runs
 *
 * Somebody stands in the kitchen and enters six things. So the field **keeps focus
 * across a submit**, the keyboard never comes down between two adds, and the quantity
 * resets to one so the seventh item does not silently inherit the sixth one's count.
 * A FAB would put a dialog between every pair of those six.
 *
 * ## It is absent without `WRITE`, and never locked
 *
 * That decision belongs to the container, which knows whether the caller may write.
 * This component is simply not rendered in that case, because a disabled text field at
 * the bottom of a screen is an invitation that does not work and costs a tap to find
 * out (section 3.2).
 *
 * The basket used to lock it until a list was chosen (velista `0110`). It asks which
 * list at the moment of adding instead (velista `0116`), which is what
 * {@link holdOnSend} is for, so the field always takes words.
 *
 * It is drawn from certainty since velista plan 0030: `myPermissions` arrives with the
 * list, so the composer is absent from the first frame for somebody who may not add,
 * rather than being taken away after their first line is refused.
 *
 * ## The counter appears late
 *
 * Only past 350 of 400 characters. A running count under a field somebody is typing a
 * shopping item into is noise for every realistic entry, and the cap exists to stop an
 * accident rather than to be aimed at.
 *
 * ## One slot, two jobs, and the empty field decides
 *
 * Somebody standing at an open fridge has one hand free and is not going to type
 * (plan 0038). So the button at the end of the row is a **microphone** when the
 * field is empty and the plus it has always been when it is not, and the field's
 * emptiness is the switch rather than a mode anybody selects: two buttons side by
 * side, one of which is always inert, is a row of controls that has to be read
 * before either can be used, and this row already carries a stepper.
 *
 * The run property survives it. Somebody typing never sees the microphone and
 * somebody speaking never has the keyboard open, so neither mode interrupts the
 * other.
 *
 * **{@link voice} takes the second job away**, and only the basket does that: a
 * recording goes to the list scoped assistant, which a basket has no equivalent of
 * and cannot be given one cheaply. With it off the slot has one job, so the button
 * is the plus and is disabled on an empty field.
 *
 * **A press, not a hold**, as everywhere else in this app: hold to talk needs a
 * steady hand on a phone being held one handed in a kitchen, and it has no
 * accessible equivalent.
 *
 * ## Two controls, and nothing happens on its own
 *
 * While it listens there are exactly two things on screen: **stop**, which sends
 * what has been said, and **trash**, which throws it away and ends the session.
 * Trash is the reason a recording is not a one way door: without it every
 * recording that was started had to be sent before it could be deleted, and on a
 * shared list that means saying something to everybody before withdrawing it.
 *
 * That is the whole of the behaviour, and it is the plain one: the person decides
 * when they have finished speaking, nothing leaves until they press stop, and a
 * send ends the session and puts the field back. There is no setting that changes
 * any of it.
 *
 * `SilenceDetector` is still watched, because the level meter is drawn from it and
 * a still meter is what tells somebody the microphone is not picking them up. Its
 * ending is acted on only for the cap, where the recorder has already stopped
 * taking audio and a segment left open would never be sent.
 *
 * ## It is absent without `WRITE`, exactly as the composer is
 *
 * The microphone inherits that by being inside a component the container does not
 * render for somebody who may not write. There is no separate check and there must
 * not be: a second condition for the same fact is a second place for it to
 * disagree (plan 0038, section 2.1).
 */
@Component({
  selector: 'lib-line-composer',
  imports: [
    RokuTranslatorPipe,
    PlusIcon,
    MicIcon,
    StopIcon,
    TrashIcon,
    QuantityStepper,
  ],
  templateUrl: './line-composer.html',
  styleUrl: './line-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LineComposer {
  /**
   * Whether a submit is in flight.
   *
   * The field stays editable, so the next item can be typed while this one lands. What
   * waits is every way of sending it: the button, Enter and a suggestion (velista
   * `0079`, section 7). Only the button used to, so Enter and a tapped suggestion sent
   * a line while the assistant was still adding the one somebody had just said.
   */
  readonly busy = input(false);

  /**
   * Whether a send waits for the container before the field clears (velista `0116`).
   *
   * Off everywhere but the basket. There, a send is a question first: the plus or a
   * card's add button opens a picker of lists, held against the button that was
   * pressed, and only a pick adds the line. So with this on, {@link submitted}
   * carries that button as `anchor`, and the words, the quantity and the
   * suggestions stay as they are. The container calls {@link sent} once the line
   * has somewhere to go, and nothing at all if the picker is waved away, which
   * leaves the words in the field for another try.
   *
   * One input and no knowledge of why: a composer that knew about lists would be a
   * component that knows about baskets.
   */
  readonly holdOnSend = input(false);

  /**
   * Whether to take focus on creation.
   *
   * True on an empty list, where there is exactly one thing to do and the composer is
   * already focused (section 3.1), and false otherwise, because stealing focus and
   * raising a keyboard over a list somebody opened to read would be hostile.
   *
   * Focused **programmatically** rather than through the `autofocus` attribute, which
   * `@angular-eslint` forbids and is right to: the attribute fires on page load with no
   * regard for what the person was doing, and there is no way to withdraw it. Doing it
   * here means the one condition that justifies it is written down and testable.
   */
  readonly takeFocus = input(false);

  /**
   * Whether this composer offers a microphone at all (velista `0053`, section 3).
   *
   * True everywhere it has ever been drawn, so the list page needs no change. False
   * on the **basket**, where the button is always the plus and is disabled while the
   * field is empty; {@link button} then answers `'add'` unconditionally, and the
   * microphone, the listening row, the level meter and the recorder are never
   * reached.
   *
   * ## The reason is where a recording goes, not the shop
   *
   * {@link spoke} hands the audio to the page, and the page posts it to the **list
   * scoped assistant**, an account authenticated service that resolves zones, lists
   * and access to decide what a sentence means. A basket has no such surface and
   * cannot have one cheaply: the assistant would have to accept a participant
   * credential, understand a basket, and be reachable by anybody holding a link.
   * Offering a microphone that has nowhere to send its audio is worse than offering
   * nothing.
   *
   * Three supporting reasons, none of which would have been enough alone: the phone
   * is very often not the speaker's, so a permission prompt arrives on somebody
   * else's device in the middle of a favour; a shop is loud and the silence detector
   * is tuned for a kitchen; and the line is going into a basket rather than a
   * household's list, so the assistant's real value, resolving "more of the usual
   * milk" against a list, has nothing to resolve against.
   *
   * ## An input and not a second component
   *
   * The field, the run behaviour across a submit, the counter and the quantity
   * stepper are all the same on both screens, and a copy of this component would be
   * a second place for those four to drift.
   */
  readonly voice = input(true);

  /**
   * The id of the region the page draws this field's results in (velista `0117`).
   *
   * The field is the page's one search: a search box that controls that region. It
   * used to draw a panel of suggestions above itself; the page draws the lines that
   * match and the catalog's cards in its own results now, and hands a chosen card back
   * through {@link choose}, so a card still adds exactly as it did from the panel.
   */
  readonly resultsId = input<string | null>(null);

  /**
   * Whether Escape in the field empties it (velista `0117`, rule F2).
   *
   * The basket turns it off while its list picker is open, so that Escape closes the
   * picker and leaves the words for another try (velista `0116`).
   */
  readonly escapeClears = input(true);

  /**
   * The field gained or lost focus. The page hides the bottom bar while it has focus
   * (velista `0117`, rule F3), so the results get the room.
   */
  readonly fieldFocused = output<boolean>();

  /**
   * What has been typed, raw and on every keystroke.
   *
   * The **container** debounces it and decides when three characters have been
   * reached. Both of those are facts about how often a request may be made, which is
   * not a question a text field can answer, and putting the timer here would mean two
   * components with a timer each the moment anything else wanted suggestions.
   */
  readonly queryChanged = output<string>();

  readonly submitted = output<LineComposerSubmit>();

  /**
   * Something somebody said, for the page to post to the list scoped assistant.
   *
   * The recording and nothing else. Rule D1: this component does not know what
   * becomes of it, and it certainly does not know there is an assistant.
   */
  readonly spoke = output<RecordedAudio>();

  /** It did not start: a refused microphone, no device, or a browser that cannot. */
  readonly recordingFailed = output<void>();

  readonly content = signal('');
  readonly quantity = signal(1);

  readonly maxLength = LINE_CONTENT_MAX_LENGTH;
  readonly counterFrom = LINE_CONTENT_COUNTER_FROM;

  readonly showCounter = computed(
    () => this.content().length >= this.counterFrom
  );

  readonly canSubmit = computed(() => this.content().trim() !== '');

  private readonly _field = viewChild<ElementRef<HTMLInputElement>>('field');
  private readonly _sendButton =
    viewChild<ElementRef<HTMLButtonElement>>('sendButton');

  /**
   * The reader's language, for the catalog's two-language product names.
   *
   * Read rather than flattened in the mapper, which is the convention every other
   * catalog name in this app follows: a response parsed once must not carry the
   * language it happened to be parsed in, or switching language leaves the old words
   * on screen until something evicts the cache.
   */
  private readonly _locale = inject(RokuLocaleStore).locale;

  /**
   * The microphone, **optional**, because a composer with {@link voice} off is not
   * given one.
   *
   * `AudioRecorder` is provided by the page that wants recording, with that page's
   * cap on it, so a screen that offers no microphone provides none and this resolves
   * to null. A composer that reaches the record branch without one treats it exactly
   * as a device that is not there, which is a state `_record` already models and the
   * page already has a sentence for.
   *
   * An injection this component can go without is preferable to the basket page
   * providing a recorder it must never start: a provider is a thing somebody later
   * finds and wires up.
   */
  private readonly _recorder = inject(AudioRecorder, { optional: true });
  private readonly _detector = inject<SilenceDetectorI>(SILENCE_DETECTOR);

  private _watch: SilenceWatch | null = null;

  /** 0 to 1, from the detector, for the meter. Reset between recordings. */
  private readonly _level = signal(0);

  /**
   * Whether the session is open: pressed, and not yet ended.
   *
   * A signal because it is what holds the listening row on screen **before** the
   * recorder is running: `AudioRecorder.active()` goes true only once
   * `getUserMedia` resolves, and a view drawn from the recorder alone would leave
   * the text field, and on a phone the keyboard, up while the browser is asking
   * for the microphone.
   */
  private readonly _listeningOn = signal(false);

  /**
   * Whether the listening row is on screen.
   *
   * The session or the recorder, not the recorder alone: from the press until the
   * browser hands back a stream the recorder is still idle, and that gap is not
   * something the person did.
   */
  readonly listening = computed(
    () => this._listeningOn() || (this._recorder?.active() ?? false)
  );

  /**
   * What the one button is for: the plus, or the microphone.
   *
   * The empty field is the switch, **except** where {@link voice} is off, in which
   * case there is no second job for the slot to hold and the button is the plus it
   * has always been, disabled until something is typed. That branch is what makes
   * every recording path below unreachable rather than merely unused.
   */
  readonly button = computed<LineComposerButton>(() =>
    this.canSubmit() || !this.voice() ? 'add' : 'record'
  );

  readonly buttonLabel = computed(() =>
    this.button() === 'add' ? 'list.add.action' : 'list.add.startListening'
  );

  /**
   * The meter, as a width.
   *
   * Scaled well past the raw level, because speech at a conversational distance
   * from a phone microphone reads as a small number and a meter that never leaves
   * the left hand end says "not hearing you" when it is hearing perfectly.
   */
  readonly levelPercent = computed(() =>
    Math.min(100, Math.round(this._level() * 400))
  );

  constructor() {
    // A composer destroyed mid recording must not leave the microphone open: the
    // browser keeps its indicator on and the stream alive behind a component
    // nobody holds any more. `AudioRecorder` releases itself on destroy; the
    // watch is this component's and goes with it.
    inject(DestroyRef).onDestroy(() => this._stopWatching());

    // `afterNextRender` runs in the browser and never on the server (plan 0001, D2),
    // which is also why this cannot be an attribute: the attribute would be in the
    // server rendered HTML and would fire on hydration.
    afterNextRender(() => {
      if (this.takeFocus()) {
        this._field()?.nativeElement.focus();
      }
    });
  }

  onInput(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    this.content.set(typed);
    this.queryChanged.emit(typed);
  }

  /**
   * A suggestion was chosen, which **adds the line** rather than filling the field.
   *
   * One tap and not two, because the list is offered under a field somebody is already
   * typing into and filling it in would leave them looking at their own word with a
   * send button still to press. Choosing is the whole gesture (section 6).
   *
   * A group sends the group's products; an item sends the one. That is the difference
   * the ranking exists to express: somebody typing "milk" wants milk, and the household
   * decides which brand later, on the line page, by trimming a set it already has.
   */
  choose(suggestion: CatalogSuggestion, anchor?: HTMLElement): void {
    // Held like the button while a submit is out: choosing **is** the submit, so
    // the two have to be held by the same conditions or one way in would work and
    // the other would not.
    if (this.busy()) {
      return;
    }

    const content =
      suggestion.kind === 'group'
        ? catalogName(suggestion.group.name, this._locale())
        : catalogName(suggestion.item.name, this._locale());
    const itemIds =
      suggestion.kind === 'group' ? suggestion.itemIds : [suggestion.item.id];

    this._send(content, itemIds, anchor);
  }

  /** The one button, pressed. */
  press(): void {
    if (this.button() === 'add') {
      // The plus is the form's submit button, so the click also submits the form,
      // and `onSubmit` sends. Sending here as well sent twice. An ordinary send
      // hid that, because the field was already empty the second time, but a send
      // held for a question (velista `0116`) keeps its words and would ask twice.
      return;
    }

    this._listeningOn.set(true);
    void this._record();
  }

  /**
   * Send what has been said, and end the session.
   *
   * The ending is done in `_finish` rather than here, so that this press and the
   * cap end the same way.
   */
  stop(): void {
    void this._finish();
  }

  /**
   * Throw the recording away and end the session.
   *
   * What somebody who pressed the microphone by accident, or thought better of what
   * they were saying, reaches for. Nothing is emitted, so the page never learns
   * there was a recording at all.
   */
  discard(): void {
    this._listeningOn.set(false);
    this._stopWatching();
    this._recorder?.cancel();
    this._level.set(0);
  }

  private async _record(): Promise<void> {
    const recorder = this._recorder;
    if (recorder === null) {
      // No microphone was provided to this composer, which is the same situation
      // as a device that is not there and is reported the same way. Unreachable
      // while `voice` is off, because the button never becomes a microphone.
      this._listeningOn.set(false);
      this.recordingFailed.emit();
      return;
    }

    await recorder.start();

    const state = recorder.state();
    if (state === 'refused' || state === 'unavailable') {
      // Said by the page, in the strip, because the sentence differs between a
      // refusal and a device that is not there and neither is this component's
      // to write (plan 0038, section 6).
      //
      // The session ends here as well as the recording, so the row goes back to
      // the field rather than sitting there listening to a microphone that was
      // never opened.
      this._listeningOn.set(false);
      recorder.cancel();
      this.recordingFailed.emit();
      return;
    }

    this._level.set(0);

    const stream = recorder.stream;
    if (stream === null) {
      // No stream to watch, which is every fake and any browser without the
      // audio API. The recording still runs and the stop button still ends it;
      // what is lost is only the convenience of it ending itself.
      return;
    }

    this._watch = this._detector.watch(stream, {
      onLevel: (reading) => this._level.set(reading.level),
      // Watched for the meter, which is drawn from the same handler: a still meter
      // is what tells somebody the microphone is not hearing them.
      //
      // A quiet ending is deliberately not acted on. The person decides when they
      // have finished speaking, and a microphone that sends on its own cuts off
      // anybody who paused to think about the next item.
      //
      // The cap is the one ending that is acted on: by then the recorder has
      // stopped taking audio, so a segment left open would never be sent and the
      // row would sit there looking live.
      onEnd: (reason) => {
        if (reason === 'cap') {
          void this._finish();
        }
      },
    });
  }

  private async _finish(): Promise<void> {
    this._stopWatching();

    const recorder = this._recorder;
    if (recorder === null) {
      // Unreachable: nothing calls this except the stop control and the detector's
      // ending, and neither is on screen without a recording having started.
      this._listeningOn.set(false);
      return;
    }

    const seconds = recorder.elapsedSeconds();
    const blob = await recorder.stop();
    this._level.set(0);

    // A send ends the session and puts the field back.
    this._listeningOn.set(false);

    // Nothing to send. An empty file to a paid provider is what the detector's
    // minimum length exists to prevent, and this is the same rule at the end of
    // the path rather than a second one.
    if (blob === null || blob.size === 0) {
      return;
    }

    this.spoke.emit({
      blob,
      mimeType: blob.type,
      durationSeconds: seconds,
    });
  }

  private _stopWatching(): void {
    this._watch?.close();
    this._watch = null;
  }

  /**
   * Put back what was typed, because the add it was cleared for did not land
   * (velista `0053`, section 7).
   *
   * A method the container calls rather than an input it binds, and the difference
   * matters: an input would have to be cleared again on the next keystroke or it
   * would fight whatever is typed next, and the container has no reason to know when
   * that happened. This is one event — a failure — and one act.
   *
   * The quantity is deliberately **not** restored. It resets to one on every submit
   * so the next item does not inherit the last one's count, and somebody who typed
   * three is far more likely to have moved on than to want three of whatever they
   * type next; the words are what would be painful to lose in an aisle.
   *
   * Only used where the add is not optimistic. The list page draws its row
   * immediately and reports a failure on the row itself, which is a better place for
   * it there: the line is on screen to point at.
   */
  restore(content: string): void {
    this.content.set(content);
    this._field()?.nativeElement.focus();
  }

  /**
   * The line a held send was for has somewhere to go (velista `0116`): clear the
   * field, reset the quantity, drop the suggestions and keep focus, exactly as an
   * unheld send does at once. See {@link holdOnSend}.
   */
  sent(): void {
    this._clear();
  }

  /**
   * Empty the field and say so, without taking focus (velista `0117`): the page
   * calls it when the phone's back button closed the search the words opened.
   */
  clear(): void {
    this.content.set('');
    this.quantity.set(1);
    this.queryChanged.emit('');
  }

  /**
   * Escape empties the field, which closes the results (velista `0117`, rule F2). A
   * field with nothing in it, or one whose page said not to, lets the key go on.
   */
  protected onEscape(event: Event): void {
    if (!this.escapeClears() || this.content() === '') {
      return;
    }
    event.preventDefault();
    this.clear();
  }

  /**
   * With {@link holdOnSend} on, a press on the plus leaves focus in the field, so
   * the keyboard stays up under the picker (rule T2 of velista `0101`).
   */
  protected holdFocusOnHold(event: MouseEvent): void {
    if (this.holdOnSend()) {
      event.preventDefault();
    }
  }

  /**
   * The form's own submit, which is what makes the phone keyboard's Go key work.
   *
   * `(submit)` and not `(ngSubmit)`: the latter is `NgForm`'s output and needs
   * `FormsModule`, which this composer does not import and does not want, because
   * nothing here is a form control. Without the module `(ngSubmit)` binds to a DOM
   * event of that name, which no browser ever fires, so the Go key and the button
   * would both do nothing except let the native submit through and reload the page.
   * `preventDefault` is then this handler's job rather than the directive's.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  /**
   * Send it, and stay ready for the next one.
   *
   * The field is cleared and the quantity reset **here**, before the request resolves,
   * because the add is optimistic and the row is already on screen: leaving the text in
   * the field until a response arrived would show the same item twice and invite a
   * second submit of it.
   *
   * Focus is taken back explicitly. Clearing an input does not move focus, but the
   * button that was tapped has it, and on a phone that is enough to drop the keyboard.
   */
  submit(): void {
    // Enter reaches this through the form's submit, which a disabled button does not
    // stop, so the hold has to be here as well as on the button. See `busy`.
    if (this.busy() || !this.canSubmit()) {
      return;
    }

    // No products: typing something and ignoring the list adds a plain line, with no
    // warning and no nagging. "Something for dinner" is a legitimate line, and the
    // moment the composer starts insisting on a match, adding things becomes a fight
    // (section 6).
    //
    // The plus is the anchor whether it was pressed or Enter was, because the plus
    // is where the send lives on screen.
    this._send(
      this.content().trim(),
      undefined,
      this._sendButton()?.nativeElement
    );
  }

  /**
   * Send one line and stay ready for the next.
   *
   * The field is cleared and the quantity reset **here**, before the request resolves,
   * because the add is optimistic and the row is already on screen: leaving the text in
   * the field until a response arrived would show the same item twice and invite a
   * second submit of it.
   *
   * Focus is taken back explicitly. Clearing an input does not move focus, but the
   * button or the suggestion that was tapped has it, and on a phone that is enough to
   * drop the keyboard between two adds.
   *
   * With {@link holdOnSend} on, only the emit happens here, and the rest waits for
   * {@link sent}.
   */
  private _send(
    content: string,
    itemIds: readonly string[] | undefined,
    anchor: HTMLElement | undefined
  ): void {
    const hold = this.holdOnSend();
    this.submitted.emit({
      content,
      quantity: this.quantity(),
      ...(itemIds === undefined || itemIds.length === 0 ? {} : { itemIds }),
      ...(hold && anchor !== undefined ? { anchor } : {}),
    });

    if (!hold) {
      this._clear();
    }
  }

  private _clear(): void {
    // The results go with the words that produced them.
    this.clear();
    this._field()?.nativeElement.focus();
  }
}
