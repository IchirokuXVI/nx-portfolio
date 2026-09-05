import { computed, signal } from '@angular/core';
import {
  draftFor,
  isDirty,
  toInput,
  validateDraft,
  type DraftValue,
  type FieldMessage,
  type FormMode,
  type ResourceDescriptor,
  type ResourceDraft,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, toGatewayError } from '../gateway-error';

/**
 * One form, being filled in (plan 0004, section 5).
 *
 * Create and edit are the same thing with a different starting point, so they
 * are the same store with a {@link FormMode}. A plain class rather than an
 * `@Injectable`, for the same reason the list store is one: it belongs to a
 * screen and has to die with it.
 *
 * What it owns, once, so that fifteen entities cannot disagree about it:
 *
 * - Which messages a field is showing, and **when**. A rule the operator has
 *   not had a chance to break yet is not shown: a field complains once it has
 *   been touched, or once a submit has been attempted.
 * - Where a server's validation lands. `ProblemDetails.errors` is keyed by
 *   field, so each entry goes back under the input that caused it rather than
 *   into a banner nobody can act on.
 * - That a submit cannot happen twice.
 */
export type FormStatus = 'loading' | 'ready' | 'error';

export class ResourceFormStore<T extends ResourceRow> {
  private readonly _draft = signal<ResourceDraft>({});
  private readonly _original = signal<ResourceDraft>({});
  private readonly _row = signal<T | null>(null);
  private readonly _status = signal<FormStatus>('loading');
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _serverErrors = signal<
    Readonly<Record<string, readonly string[]>>
  >({});
  private readonly _touched = signal<ReadonlySet<string>>(new Set());
  private readonly _submitted = signal(false);
  private readonly _busy = signal(false);

  constructor(
    private readonly _descriptor: ResourceDescriptor<T>,
    private readonly _gateway: ResourceGateway<T>,
    readonly mode: FormMode,
    private readonly _id: string | null,
    /**
     * Values a create form opens with already filled in.
     *
     * Ignored on an edit, where the row is the starting point and a caller's
     * opinion about a field would be an unexplained change to a saved value.
     *
     * It exists for one caller and the reason is worth stating. Admin plan 0010
     * sends an operator from the leaflet upload to the price scopes create form
     * when their chain has no `NATIONAL` scope, and the chain is the one thing
     * that screen already knows. Making the operator pick it again is asking
     * them to repeat a choice they made two controls ago, and getting it wrong
     * files the scope under the wrong chain.
     *
     * Only fields the descriptor declares editable on a create are taken, so a
     * query string cannot seed a value the form would not otherwise send.
     */
    private readonly _prefill: ResourceDraft = {}
  ) {}

  readonly draft = this._draft.asReadonly();
  readonly status = this._status.asReadonly();
  readonly error = this._error.asReadonly();
  readonly busy = this._busy.asReadonly();

  /** The row being edited, for the fields the form only shows. */
  readonly row = this._row.asReadonly();

  /** Whether leaving now would lose something the operator typed. */
  readonly dirty = computed(() => isDirty(this._draft(), this._original()));

  /** Everything this app's own rules object to, by field. */
  private readonly _problems = computed(() =>
    validateDraft(this._descriptor, this._draft(), this.mode, this._original())
  );

  /** Whether the draft satisfies this app's rules. */
  readonly valid = computed(() => Object.keys(this._problems()).length === 0);

  /**
   * The server's complaints about fields this form does not have.
   *
   * Shown as a banner, because there is nowhere else to put them and dropping
   * them would leave a refused submit with no reason on screen at all.
   */
  readonly strayErrors = computed(() => {
    const known = new Set<string>(
      this._descriptor.fields.map((field) => field.name)
    );
    return Object.entries(this._serverErrors())
      .filter(([name]) => !known.has(name))
      .flatMap(([, messages]) => messages);
  });

  /**
   * What to show under one field.
   *
   * The server's answer first: it refused a value this app was willing to send,
   * so it is the more specific complaint and the one the operator has to act
   * on. This app's own rules follow, and only once the field has been touched
   * or a submit has been attempted.
   */
  messagesFor(name: string): readonly FieldMessage[] {
    const server = (this._serverErrors()[name] ?? []).map(
      (text): FieldMessage => ({ kind: 'text', text })
    );

    const shown = this._submitted() || this._touched().has(name);
    const local = shown ? (this._problems()[name] ?? []) : [];

    return [...server, ...local];
  }

  /** Change one field. */
  set(name: string, value: DraftValue): void {
    this._draft.update((draft) => ({ ...draft, [name]: value }));
    this._touched.update((touched) => new Set(touched).add(name));

    // The server refused the value that was there; it has not seen this one.
    // Leaving the message under a field the operator has just corrected is how
    // a form ends up arguing with somebody who already did what it asked.
    if (this._serverErrors()[name] !== undefined) {
      this._serverErrors.update((errors) => {
        const rest = { ...errors };
        delete rest[name];
        return rest;
      });
    }
  }

  /** Open the form: an empty draft for a create, the row for an edit. */
  async load(): Promise<void> {
    if (this.mode === 'create' || this._id === null) {
      this._reset(null);
      this._status.set('ready');
      return;
    }

    this._status.set('loading');
    this._error.set(null);

    try {
      const row = await this._gateway.read(this._id);
      this._reset(row);
      this._status.set('ready');
    } catch (error) {
      this._error.set(toGatewayError(error));
      this._status.set('error');
    }
  }

  /**
   * Send it.
   *
   * Answers the saved row, or `null` when nothing was saved. The caller
   * navigates on a row and stays put on a `null`, so a refused submit never
   * costs the operator what they typed.
   */
  async submit(): Promise<T | null> {
    this._submitted.set(true);

    if (this._busy() || !this.valid()) {
      return null;
    }

    this._busy.set(true);
    this._error.set(null);
    this._serverErrors.set({});

    const input = toInput(
      this._descriptor,
      this._draft(),
      this.mode,
      this._original()
    );

    try {
      const saved =
        this.mode === 'create' || this._id === null
          ? await this._gateway.create(input)
          : await this._gateway.update(this._id, input);

      // The draft becomes its own baseline, so the form is clean and leaving it
      // asks nothing. It matters even though the caller navigates away: a
      // caller that stays, or a navigation a guard refuses, must not find a
      // form claiming unsaved work that is on the server.
      this._original.set(this._draft());
      this._row.set(saved);
      return saved;
    } catch (error) {
      const failure = toGatewayError(error);
      this._error.set(failure);
      this._serverErrors.set(failure.fieldErrors);
      return null;
    } finally {
      this._busy.set(false);
    }
  }

  private _reset(row: T | null): void {
    const draft = { ...draftFor(this._descriptor, row, this.mode) };

    if (this.mode === 'create') {
      for (const [name, value] of Object.entries(this._prefill)) {
        // Only over a field this form would have drawn anyway. A name the
        // descriptor does not declare editable on a create is left out rather
        // than added, so the caller cannot widen what the form submits.
        if (name in draft) {
          draft[name] = value;
        }
      }
    }

    this._draft.set(draft);
    // The prefill is the baseline as well as the value, so a form opened with
    // one and left alone is clean: the operator typed nothing, and being asked
    // whether they want to discard a value they never entered would teach them
    // to click through that question.
    this._original.set(draft);
    this._row.set(row);
    this._touched.set(new Set());
    this._submitted.set(false);
    this._serverErrors.set({});
  }
}
