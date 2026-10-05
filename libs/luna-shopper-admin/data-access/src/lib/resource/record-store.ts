import { computed, signal } from '@angular/core';
import {
  changedFields,
  draftFor,
  isEditable,
  isEmptyValue,
  orderedFieldNames,
  toInput,
  validateDraft,
  type DraftValue,
  type FieldMessage,
  type FormMode,
  type RecordMode,
  type ResourceDescriptor,
  type ResourceDraft,
  type ResourceGateway,
  type ResourceRow,
  type SaveBarState,
} from '@portfolio/luna-shopper-admin/models';
import { GatewayError, toGatewayError } from '../gateway-error';
import { readRecordById } from './read-record-by-id';

/**
 * What the read of a record answered.
 *
 * `missing` and `error` are two states and never one. A server that is down
 * has not said the record is gone, and a record that is gone is not an empty
 * record.
 */
export type RecordStatus = 'loading' | 'ready' | 'missing' | 'error';

/** What the last refused save was about. */
type Refusal = 'fields' | 'gateway' | null;

/**
 * One record, being read, changed or added (admin plan 0053, section 2.1).
 *
 * A plain class and not an `@Injectable`: it belongs to a page, or to a form
 * inside one, and has to die with it.
 *
 * A record opens to be read. `edit()` starts a draft from the row, and
 * `cancel()` throws the draft away. A record that does not exist yet has no
 * reading mode: it is a draft from the first moment.
 *
 * It adds no rule of its own about what a value means. `draftFor`,
 * `validateDraft`, `changedFields` and `toInput` of `models` decide that.
 */
export class RecordStore<T extends ResourceRow> {
  private readonly _mode = signal<RecordMode>('read');
  private readonly _status = signal<RecordStatus>('loading');
  private readonly _row = signal<T | null>(null);
  private readonly _draft = signal<ResourceDraft>({});
  private readonly _original = signal<ResourceDraft>({});
  private readonly _error = signal<GatewayError | null>(null);
  private readonly _serverErrors = signal<
    Readonly<Record<string, readonly string[]>>
  >({});
  private readonly _touched = signal<ReadonlySet<string>>(new Set());
  private readonly _submitted = signal(false);
  private readonly _refusal = signal<Refusal>(null);
  private readonly _busy = signal(false);
  /** Whether the write on its way is a save. A delete is busy and saves nothing. */
  private readonly _saving = signal(false);
  private readonly _savedAt = signal<Date | null>(null);

  /** The reads started so far. Only the answer of the newest one is applied. */
  private _reads = 0;
  /** Who is told about a save that went through. */
  private _onSaved: ((row: T) => void) | null = null;

  private readonly _ordered: ReadonlySet<string>;

  constructor(
    private readonly _descriptor: ResourceDescriptor<T>,
    private readonly _gateway: ResourceGateway<T>,
    /** `null` for a record that does not exist yet. */
    private readonly _id: string | null,
    /** Values a new record opens with. Ignored when `id` is not `null`. */
    private readonly _prefill: ResourceDraft = {}
  ) {
    this._ordered = orderedFieldNames(_descriptor);
    this._mode.set(_id === null ? 'create' : 'read');
  }

  readonly mode = this._mode.asReadonly();
  readonly status = this._status.asReadonly();
  readonly row = this._row.asReadonly();
  readonly draft = this._draft.asReadonly();
  /** The failure of the last read, the last save or the last delete. */
  readonly error = this._error.asReadonly();
  readonly busy = this._busy.asReadonly();
  /** When the last save went through, or `null`. */
  readonly savedAt = this._savedAt.asReadonly();

  /** The mode as the rules of a draft know it. Reading has no draft. */
  private readonly _formMode = computed<FormMode>(() =>
    this._mode() === 'create' ? 'create' : 'edit'
  );

  /** The names of the fields that differ from what was read. */
  readonly changed = computed<readonly string[]>(() =>
    this._mode() === 'read'
      ? []
      : changedFields(this._draft(), this._original(), this._ordered)
  );

  /**
   * The required fields that are still empty.
   *
   * Counted only while a record is added. A change sends only what changed,
   * so a required field that was never touched is the server's value and not
   * something the operator left out.
   */
  readonly missing = computed<readonly string[]>(() => {
    if (this._mode() !== 'create') {
      return [];
    }
    const draft = this._draft();
    return this._descriptor.fields
      .filter(
        (field) =>
          field.required === true &&
          isEditable(field, 'create') &&
          isEmptyValue(draft[field.name] ?? '')
      )
      .map((field) => field.name);
  });

  /** Everything the rules of this app object to, by field. */
  private readonly _problems = computed(() =>
    this._mode() === 'read'
      ? {}
      : validateDraft(
          this._descriptor,
          this._draft(),
          this._formMode(),
          this._original()
        )
  );

  /**
   * The fields that carry a refusal, after a save that was refused, in the
   * order of the descriptor.
   *
   * Three sources: a rule of this app, a field the server named, and a code
   * that the descriptor says is about one field (`errorFields`).
   */
  readonly invalid = computed<readonly string[]>(() => {
    if (this._mode() === 'read') {
      return [];
    }
    const local = this._submitted() ? this._problems() : {};
    const server = this._serverErrors();
    const about = this._errorField();

    return this._descriptor.fields
      .map((field) => field.name as string)
      .filter(
        (name) =>
          local[name] !== undefined ||
          server[name] !== undefined ||
          name === about
      );
  });

  /**
   * The complaints of the server about fields this record does not have.
   *
   * Drawn as lines above the sections, because there is nowhere else to put
   * them and dropping them would leave a refused save with no reason.
   */
  readonly strayErrors = computed<readonly string[]>(() => {
    const known = new Set<string>(
      this._descriptor.fields.map((field) => field.name)
    );
    return Object.entries(this._serverErrors())
      .filter(([name]) => !known.has(name))
      .flatMap(([, messages]) => messages);
  });

  /**
   * What the save bar says (admin plan 0053, section 2.1). The first row of
   * the table that fits wins.
   */
  readonly bar = computed<SaveBarState>(() => {
    // Only a save. A delete is busy too, and the bar must not call it one.
    if (this._saving()) {
      return { kind: 'saving' };
    }

    const refusal = this._refusal();
    const invalid = this.invalid().length;
    if (refusal === 'fields' && invalid > 0) {
      return { kind: 'invalid', fields: invalid };
    }
    if (refusal === 'gateway') {
      return { kind: 'refused' };
    }

    const missing = this.missing().length;
    if (missing > 0) {
      return { kind: 'missing', required: missing };
    }

    const changes = this.changed().length;
    if (changes > 0) {
      return { kind: 'dirty', changes };
    }
    // A new record whose values all came with the address has nothing typed
    // and is still worth adding. A record that exists has nothing to send.
    return this._mode() === 'create'
      ? { kind: 'clean', canSave: true }
      : { kind: 'clean' };
  });

  /**
   * Name who is told about every save that goes through, with the saved row.
   *
   * Told by the store and not by the view that asked for the save: a view can
   * be gone before the answer arrives, and the write still happened.
   */
  onSaved(listener: (row: T) => void): void {
    this._onSaved = listener;
  }

  /**
   * What to say under one field.
   *
   * The answer of the server first: it refused a value this app was willing to
   * send, so it is the more specific complaint. The rules of this app follow,
   * once the field was touched or a save was tried.
   */
  messagesFor(name: string): readonly FieldMessage[] {
    const server = (this._serverErrors()[name] ?? []).map(
      (text): FieldMessage => ({ kind: 'text', text })
    );

    const shown = this._submitted() || this._touched().has(name);
    const local = shown ? (this._problems()[name] ?? []) : [];

    return [...server, ...local];
  }

  /**
   * Read the record, or open an empty draft for a new one.
   *
   * A second read of a record that is on the screen keeps it there while the
   * answer is on its way. The frame of a loading page is for a page that has
   * nothing to show yet.
   */
  async load(): Promise<void> {
    if (this._id === null) {
      this._startDraft(null);
      this._status.set('ready');
      return;
    }

    // Two reads can overlap, and the older one can answer last. Each read
    // takes a number, and only the newest one is applied.
    const read = ++this._reads;

    if (this._row() === null) {
      this._status.set('loading');
    }
    this._error.set(null);

    try {
      const row = await readRecordById(
        this._descriptor,
        this._gateway,
        this._id
      );
      if (read !== this._reads) {
        return;
      }
      if (row === null) {
        this._row.set(null);
        this._status.set('missing');
        return;
      }
      this._row.set(row);
      this._status.set('ready');
    } catch (error) {
      if (read !== this._reads) {
        return;
      }
      this._error.set(toGatewayError(error));
      // A form holds a draft. A read that failed under it takes neither the
      // row nor the form away: the failure is said, and the draft stays.
      if (this._mode() !== 'read' && this._row() !== null) {
        return;
      }
      this._row.set(null);
      this._status.set('error');
    }
  }

  /** From `read` to `edit`. The draft starts from the row. */
  edit(): void {
    const row = this._row();
    if (this._mode() !== 'read' || row === null) {
      return;
    }
    this._startDraft(row);
    this._savedAt.set(null);
    this._mode.set('edit');
  }

  /** From `edit` to `read`. The draft is thrown away. */
  cancel(): void {
    if (this._mode() !== 'edit') {
      return;
    }
    this._mode.set('read');
    this._startDraft(null, true);
  }

  /** Change one field. */
  set(name: string, value: DraftValue): void {
    if (this._mode() === 'read') {
      return;
    }

    // Before the value changes: the bar stops saying "not saved" when one of
    // the fields it counted was changed, and after any change at all when the
    // refusal was about no field.
    const refusal = this._refusal();
    if (
      refusal === 'gateway' ||
      (refusal === 'fields' && this.invalid().includes(name))
    ) {
      this._refusal.set(null);
    }

    this._draft.update((draft) => ({ ...draft, [name]: value }));
    this._touched.update((touched) => new Set(touched).add(name));

    // The server refused the value that was there. It has not seen this one.
    if (this._serverErrors()[name] !== undefined) {
      this._serverErrors.update((errors) => {
        const rest = { ...errors };
        delete rest[name];
        return rest;
      });
    }
    if (this._errorField() === name) {
      this._error.set(null);
    }
  }

  /**
   * Send it. Answers the saved row, or `null` when nothing was saved.
   *
   * A refused save keeps everything that was typed.
   */
  async submit(): Promise<T | null> {
    const mode = this._mode();
    if (mode === 'read' || this._busy()) {
      return null;
    }

    this._submitted.set(true);
    this._error.set(null);
    this._serverErrors.set({});

    if (Object.keys(this._problems()).length > 0) {
      this._refusal.set('fields');
      return null;
    }

    this._refusal.set(null);
    this._busy.set(true);
    this._saving.set(true);

    const input = toInput(
      this._descriptor,
      this._draft(),
      this._formMode(),
      this._original()
    );

    try {
      const saved =
        this._id === null
          ? await this._gateway.create(input)
          : await this._gateway.update(this._id, input);

      if (mode === 'edit') {
        await this._readSaved(saved);
        this._mode.set('read');
        this._startDraft(null, true);
        this._savedAt.set(new Date());
      } else {
        // The page leaves for the new record. The draft becomes its own
        // baseline and nothing else changes, so that the leave guard does not
        // ask about work that is on the server.
        this._original.set(this._draft());
      }
      this._onSaved?.(saved);
      return saved;
    } catch (error) {
      const failure = toGatewayError(error);
      this._error.set(failure);
      this._serverErrors.set(failure.fieldErrors);
      this._refusal.set(this.invalid().length > 0 ? 'fields' : 'gateway');
      return null;
    } finally {
      this._busy.set(false);
      this._saving.set(false);
    }
  }

  /** `true` when the record was deleted. A refusal is in `error`. */
  async remove(): Promise<boolean> {
    if (this._id === null || this._busy()) {
      return false;
    }

    this._busy.set(true);
    this._error.set(null);

    try {
      await this._gateway.remove(this._id);
      return true;
    } catch (error) {
      this._error.set(toGatewayError(error));
      return false;
    } finally {
      this._busy.set(false);
    }
  }

  /**
   * The row after a save: what a read answers, and not what the write did.
   *
   * A write can answer less than a read. The answer of a changed list has no
   * lines, no count and no zone name, and a page that kept it as the row
   * would say the list is empty. So the record is read again, and the answer
   * of the write is the row only when that read fails or finds nothing: the
   * save went through either way, and a failed read must not call it refused.
   *
   * The read takes a number like any other. A read that started before the
   * write cannot win over it, and a read that started after it is newer and
   * keeps the row.
   */
  private async _readSaved(saved: T): Promise<void> {
    if (this._id === null) {
      return;
    }
    const read = ++this._reads;

    let row: T = saved;
    try {
      row =
        (await readRecordById(this._descriptor, this._gateway, this._id)) ??
        saved;
    } catch {
      // The answer of the write stays.
    }

    if (read === this._reads) {
      this._row.set(row);
    }
  }

  /** The field the last refusal is about, when the descriptor says so. */
  private _errorField(): string | undefined {
    const error = this._error();
    return error === null
      ? undefined
      : this._descriptor.errorFields?.[error.code];
  }

  /**
   * A fresh draft, and nothing said about it yet.
   *
   * `empty` is for the way back to reading, which holds no draft at all.
   */
  private _startDraft(row: T | null, empty = false): void {
    const draft: Record<string, DraftValue> = empty
      ? {}
      : { ...draftFor(this._descriptor, row, this._formMode()) };

    if (!empty && row === null) {
      for (const [name, value] of Object.entries(this._prefill)) {
        // Only over a field the page would have drawn anyway, so a caller
        // cannot widen what a new record sends.
        if (name in draft) {
          draft[name] = value;
        }
      }
    }

    this._draft.set(draft);
    // The prefill is the baseline as well as the value: the operator typed
    // nothing, so leaving asks nothing.
    this._original.set(draft);
    this._touched.set(new Set());
    this._submitted.set(false);
    this._refusal.set(null);
    this._serverErrors.set({});
    this._error.set(null);
  }
}
