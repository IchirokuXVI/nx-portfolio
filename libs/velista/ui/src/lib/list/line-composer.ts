import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  RokuLocaleStore,
  RokuTranslatorPipe,
} from '@portfolio/localization/rokutranslator-angular';
import {
  inLocale,
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
import {
  MicIcon,
  PlusIcon,
  SpinnerIcon,
  StopIcon,
  TrashIcon,
} from '../icons/icons';
import { QuantityStepper } from './quantity-stepper';
import { SuggestionList } from './suggestion-list';

/** What the one button at the end of the row is for. */
export type LineComposerButton = 'add' | 'record';

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
 * ## It is absent without `WRITE`, never disabled
 *
 * That decision belongs to the container, which knows whether the caller may write.
 * This component is simply not rendered in that case, because a disabled text field at
 * the bottom of a screen is an invitation that does not work and costs a tap to find
 * out (section 3.2).
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
 * ## Two controls, and two settings that change what they mean
 *
 * While it listens there are exactly two things on screen: **stop**, which sends
 * what has been said, and **trash**, which throws it away and ends the session.
 * Trash is the reason a recording is not a one way door: without it every
 * recording that was started had to be sent before it could be deleted, and on a
 * shared list that means saying something to everybody before withdrawing it.
 *
 * That is the whole of the default behaviour, and it is deliberately the plain
 * one. Two inputs change it, and neither reads the other:
 *
 * | {@link sendOnSilence} | {@link keepListening} | what it is |
 * | --- | --- | --- |
 * | off | off | a plain recorder. The default |
 * | on | off | quiet ends the recording and sends that one |
 * | off | on | stop sends, and the microphone stays open |
 * | on | on | hands free: talk, pause, talk, and each pause is a line |
 *
 * `SilenceDetector` is watched in every one of them, because the level meter is
 * drawn from it and a still meter is what tells somebody the microphone is not
 * picking them up. What {@link sendOnSilence} decides is only whether its ending
 * is acted on.
 *
 * The reason the settings exist rather than a choice being made here is in
 * `VoicePreferences`: the person at an open fridge and the person at a desk are
 * using the same screen for different things, and there is no default that is
 * right for both.
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
    SpinnerIcon,
    QuantityStepper,
    SuggestionList,
  ],
  templateUrl: './line-composer.html',
  styleUrl: './line-composer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Dismissal, the shape `AppBar`, `LineRow` and `ListViewers` already use: a
    // document listener that closes when the click landed outside this host.
    //
    // **The host is the exception list**, and it is the right one by construction:
    // the panel, the field, the stepper and the send button are all inside it, so a
    // click on the row the person is typing into cannot take away the list they are
    // typing to fill, and a click on a suggestion is not dismissal racing the choice.
    // Everything else on the page, which is the lines the panel is covering, closes
    // it.
    '(document:click)': 'closeOnOutsideClick($event.target)',
  },
})
export class LineComposer {
  /** Whether a submit is in flight. The field stays usable; only the button waits. */
  readonly busy = input(false);

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
   * The field, the run behaviour across a submit, the counter, the quantity stepper
   * and the suggestion list are all the same on both screens, and a copy of this
   * component would be a second place for those five to drift.
   */
  readonly voice = input(true);

  /**
   * Whether a silence ends the recording and sends it.
   *
   * False by default, which is the plain recorder: the person decides when they have
   * finished speaking, and nothing leaves until they press stop. It was the only
   * behaviour when plan 0038 landed, and as a default it surprises anybody who paused
   * to think about the next item and found half a list already sent.
   *
   * The cap is not covered by this. A recording that reaches the maximum ends whatever
   * this says, because the recorder has already stopped taking audio by then and a
   * segment left open would simply never be sent.
   */
  readonly sendOnSilence = input(false);

  /**
   * Whether the microphone reopens once a recording has been sent.
   *
   * False by default, so a send ends the session and the row goes back to the field.
   * True is for somebody whose hands are busy and who is naming several things: the
   * previous one is still on its way to the server while the next is being spoken,
   * which is what the sending hint is for.
   */
  readonly keepListening = input(false);

  /**
   * What the composer offers under the field, in the **server's** order.
   *
   * Handed down rather than fetched here, which is rule D1: this component knows what
   * a suggestion looks like and nothing about where it came from, and the container
   * owns the debounce, the scope and the request. It is also what keeps the ordering
   * honest, since a component that fetched would eventually be tempted to re-rank.
   *
   * Empty draws no list at all rather than an empty one. A dropdown that says "no
   * matches" is a screen telling somebody their shopping list is wrong; free text is
   * first class and typing something the catalog has never heard of is an ordinary
   * thing to do (velista plan 0043, section 6).
   */
  readonly suggestions = input<readonly CatalogSuggestion[]>([]);

  /**
   * What has been typed, raw and on every keystroke.
   *
   * The **container** debounces it and decides when three characters have been
   * reached. Both of those are facts about how often a request may be made, which is
   * not a question a text field can answer, and putting the timer here would mean two
   * components with a timer each the moment anything else wanted suggestions.
   */
  readonly queryChanged = output<string>();

  readonly submitted = output<{
    content: string;
    quantity: number;
    itemIds?: readonly string[];
  }>();

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

  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Whether the panel has been waved away for the words currently in the field.
   *
   * Presentation state and this component's own, exactly as `AppBar`'s menu is: the
   * container still holds the suggestions it fetched, and asking it to forget them
   * because somebody tapped a line would be a page rewriting its own data to change
   * what a panel looks like.
   *
   * It is cleared by the next keystroke, in {@link onInput}. Dismissal is about the
   * offer that is up, not about the field: somebody who taps away and then types
   * another letter is asking again, and a panel that stayed shut until the field was
   * emptied would be a dropdown that can be broken for the rest of a sentence.
   */
  private readonly _dismissed = signal(false);

  /**
   * Whether the panel is drawn.
   *
   * The list decides on its own whether it has anything to draw, so this is only the
   * dismissal. Two separate questions, kept separate: "there is nothing to offer" and
   * "the offer was declined" look the same on screen and are not the same state, and
   * collapsing them is how a dismissal ends up surviving the next query.
   */
  protected readonly suggestionsShown = computed(() => !this._dismissed());

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
   * A signal because it is what holds the listening row on screen **across** a
   * handover: with {@link keepListening} on, `AudioRecorder.active()` goes false the
   * moment a segment stops and true again only once the next `getUserMedia` resolves,
   * and a view drawn from the recorder alone would flash the text field, and on a
   * phone the keyboard, back at every pause in a sentence.
   */
  private readonly _listeningOn = signal(false);

  /**
   * Whether the listening row is on screen.
   *
   * The session or the recorder, not the recorder alone: between one segment and the
   * next the recorder is briefly idle while the browser hands back a fresh stream, and
   * that gap is not something the person did.
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
    // Typing is asking again. See `_dismissed`.
    this._dismissed.set(false);
    this.queryChanged.emit(typed);
  }

  /**
   * A click landed somewhere on the page. Close the panel unless it was ours.
   *
   * `click` and not `pointerdown`, which is what every other dismissal in this app
   * listens for and matters more here than elsewhere: a suggestion is chosen on
   * click, and closing on the press that precedes it would be a panel racing the row
   * somebody is pressing.
   */
  protected closeOnOutsideClick(target: EventTarget | null): void {
    if (this._dismissed()) {
      return;
    }

    const host = this._host.nativeElement;
    if (target === null || !host.contains(target as Node)) {
      this._dismissed.set(true);
    }
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
  choose(suggestion: CatalogSuggestion): void {
    const content =
      suggestion.kind === 'group'
        ? inLocale(suggestion.group.name, this._locale())
        : inLocale(suggestion.item.name, this._locale());
    const itemIds =
      suggestion.kind === 'group' ? suggestion.itemIds : [suggestion.item.id];

    this._send(content, itemIds);
  }

  /** The one button, pressed. */
  press(): void {
    if (this.button() === 'add') {
      this.submit();
      return;
    }

    this._listeningOn.set(true);
    void this._record();
  }

  /**
   * Send what has been said.
   *
   * Whether the session ends here is {@link keepListening}'s to decide, and it is
   * decided in `_finish` so that this press and a silence end the same way.
   */
  stop(): void {
    void this._finish();
  }

  /**
   * Throw the recording away, and end the session whatever the settings say.
   *
   * The one exit that always exits. With {@link keepListening} on, stop reopens the
   * microphone, so this is what closes it; and it is what somebody who pressed the
   * microphone by accident, or thought better of what they were saying, reaches for.
   * Nothing is emitted, so the page never learns there was a recording at all.
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
      // The session ends here as well as the segment. A microphone that has just
      // been refused will be refused again, and reopening it on every silence
      // would ask the same question in a loop.
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
      // Watched whatever the settings say, because the meter is drawn from the same
      // handler and a still meter is what tells somebody the microphone is not
      // hearing them. Only the ending is conditional.
      //
      // The cap is not: by then the recorder has stopped taking audio, so a segment
      // left open would never be sent and the row would sit there looking live.
      onEnd: (reason) => {
        if (reason === 'cap' || this.sendOnSilence()) {
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

    // Reopened before the emit rather than after it, so the gap in which the
    // microphone is shut is as short as this component can make it: the send that
    // follows is a request to a transcription provider and takes seconds, and a
    // person mid sentence does not pause for it.
    //
    // Off by default, which is a send that ends the session and puts the field back.
    if (this.keepListening()) {
      void this._record();
    } else {
      this._listeningOn.set(false);
    }

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
    if (!this.canSubmit()) {
      return;
    }

    // No products: typing something and ignoring the list adds a plain line, with no
    // warning and no nagging. "Something for dinner" is a legitimate line, and the
    // moment the composer starts insisting on a match, adding things becomes a fight
    // (section 6).
    this._send(this.content().trim(), undefined);
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
   */
  private _send(content: string, itemIds: readonly string[] | undefined): void {
    this.submitted.emit({
      content,
      quantity: this.quantity(),
      ...(itemIds === undefined || itemIds.length === 0 ? {} : { itemIds }),
    });

    this.content.set('');
    this.quantity.set(1);
    // The dropdown goes with the words that produced it. Leaving it up over an empty
    // field would offer matches for something nobody is typing any more.
    this.queryChanged.emit('');
    this._field()?.nativeElement.focus();
  }
}
