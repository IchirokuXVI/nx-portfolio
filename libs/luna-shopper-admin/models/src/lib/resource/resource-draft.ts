import {
  emptyLocalizedText,
  localizedListToText,
  localizedTextToList,
  missingLocales,
  toLocalizedText,
} from './localized-text';
import { parseMoney } from './money';
import type { ResourceDescriptor, ResourceInput } from './resource-descriptor';
import {
  fieldMessage,
  isEditable,
  type FieldDescriptor,
  type FieldMessage,
  type FormMode,
  type ResourceRow,
} from './resource-field';

/**
 * What the form holds while it is being filled in, and what it submits (plan
 * 0004, section 5).
 *
 * A draft is control values, not wire values: numbers, money and dates are
 * strings, because that is what an `<input>` holds and because converting early
 * is how a half typed number becomes `NaN` under the operator's cursor. The
 * conversion happens once, in {@link toInput}, after validation has agreed the
 * value is readable.
 *
 * **Nothing here derives one field from another**, and that is a rule rather
 * than an omission. `unitPrice` is stored verbatim and the obvious derivation
 * disagrees with the source on 110 of 4,232 products, in the field whose only
 * purpose is comparison. A form that helpfully filled it in would be quietly
 * wrong once in forty times.
 */

/** One control's value. */
export type DraftValue =
  | string
  | boolean
  | null
  | Readonly<Record<string, string>>;

/** Every editable field's control value, by field name. */
export type ResourceDraft = Readonly<Record<string, DraftValue>>;

/** The value a control starts at when there is nothing to start from. */
export function emptyValue<T extends ResourceRow>(
  field: FieldDescriptor<T>
): DraftValue {
  switch (field.kind) {
    case 'boolean':
      // A nullable boolean has three answers, and the third is the one it starts
      // at. A shop's availability override means "somebody checked here", so a
      // new row saying nothing must not read as "not available here".
      return field.nullable === true ? '' : false;
    case 'localized-text':
      return emptyLocalizedText(field.locales);
    default:
      return '';
  }
}

/** One row value, as the control that edits it holds it. */
function toDraftValue<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  value: unknown
): DraftValue {
  if (field.kind === 'boolean') {
    if (field.nullable !== true) {
      return value === true;
    }
    return typeof value === 'boolean' ? String(value) : '';
  }

  if (field.kind === 'localized-text') {
    const text =
      field.entries === 'list'
        ? localizedListToText(value)
        : toLocalizedText(value);
    return Object.fromEntries(
      field.locales.map((locale) => [locale, text[locale] ?? ''])
    );
  }

  if (value === null || value === undefined) {
    return '';
  }

  if (field.kind === 'date') {
    // What `<input type="date">` and `datetime-local` accept, which is neither
    // an ISO instant nor anything `Intl` produces.
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const iso = date.toISOString();
    return field.time === true ? iso.slice(0, 16) : iso.slice(0, 10);
  }

  return String(value);
}

/**
 * The draft a form opens with.
 *
 * `null` for a create, a row for an edit. Only editable fields are in it: the
 * others are drawn from the row as text, so putting them in the draft would
 * make every one of them permanently clean and permanently in the way.
 */
export function draftFor<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  row: T | null,
  mode: FormMode = 'create'
): ResourceDraft {
  const draft: Record<string, DraftValue> = {};

  for (const field of descriptor.fields) {
    if (!isEditable(field, mode)) {
      continue;
    }
    draft[field.name] =
      row === null ? emptyValue(field) : toDraftValue(field, row[field.name]);
  }

  return draft;
}

/** Whether a control value counts as nothing having been entered. */
export function isEmptyValue(value: DraftValue): boolean {
  if (value === null) {
    return true;
  }
  if (typeof value === 'boolean') {
    return false;
  }
  if (typeof value === 'string') {
    return value.trim() === '';
  }
  return Object.values(value).every((entry) => entry.trim() === '');
}

/** Whether two control values are the same answer. */
export function sameValue(left: DraftValue, right: DraftValue): boolean {
  if (typeof left !== 'object' || typeof right !== 'object') {
    return left === right;
  }
  if (left === null || right === null) {
    return left === right;
  }

  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left[key] ?? '') !== (right[key] ?? '')) {
      return false;
    }
  }
  return true;
}

/** The field names whose value has changed since the form opened. */
export function changedFields(
  draft: ResourceDraft,
  original: ResourceDraft
): string[] {
  return Object.keys(draft).filter(
    (name) => !sameValue(draft[name], original[name] ?? '')
  );
}

/** Whether anything has been typed that would be lost by leaving. */
export function isDirty(
  draft: ResourceDraft,
  original: ResourceDraft
): boolean {
  return changedFields(draft, original).length > 0;
}

export const REQUIRED_KEY = 'resource.error.required';

/**
 * Everything wrong with the draft, by field name.
 *
 * A field with nothing wrong is absent rather than present with an empty array,
 * so a caller can ask whether the map is empty and get the right answer.
 */
export function validateDraft<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  draft: ResourceDraft,
  mode: FormMode = 'create'
): Readonly<Record<string, FieldMessage[]>> {
  const problems: Record<string, FieldMessage[]> = {};

  for (const field of descriptor.fields) {
    if (!isEditable(field, mode)) {
      continue;
    }

    const messages = validateField(field, draft[field.name] ?? '');
    if (messages.length > 0) {
      problems[field.name] = messages;
    }
  }

  return problems;
}

function validateField<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  value: DraftValue
): FieldMessage[] {
  const messages: FieldMessage[] = [];

  if (field.kind === 'localized-text') {
    const missing = missingLocales(value, field.locales);
    if (field.required === true) {
      // One message per missing locale, rather than one for the field. The
      // control is several inputs, and "required" under a Spanish box the
      // operator has not reached says less than naming the language does.
      for (const locale of missing) {
        messages.push(fieldMessage('resource.error.missingLocale', { locale }));
      }
    }

    if (
      field.maxLength !== undefined &&
      typeof value === 'object' &&
      value !== null
    ) {
      for (const [locale, entry] of Object.entries(value)) {
        if (entry.length > field.maxLength) {
          messages.push(
            fieldMessage('resource.error.localeTooLong', {
              locale,
              max: field.maxLength,
            })
          );
        }
      }
    }

    return messages;
  }

  if (isEmptyValue(value)) {
    // Nothing else can be said about an empty field, and saying it would be
    // wrong: an empty number is not an unreadable number.
    return field.required === true ? [fieldMessage(REQUIRED_KEY)] : [];
  }

  switch (field.kind) {
    case 'text': {
      const text = String(value);
      if (field.maxLength !== undefined && text.length > field.maxLength) {
        messages.push(
          fieldMessage('resource.error.tooLong', { max: field.maxLength })
        );
      }
      if (field.format === 'url' && !isUrl(text)) {
        messages.push(fieldMessage('resource.error.notAUrl'));
      }
      break;
    }

    case 'number': {
      const number = Number(String(value).trim());
      if (!Number.isFinite(number)) {
        messages.push(fieldMessage('resource.error.notANumber'));
        break;
      }
      if (field.integer === true && !Number.isInteger(number)) {
        messages.push(fieldMessage('resource.error.notAnInteger'));
      }
      if (field.min !== undefined && number < field.min) {
        messages.push(
          fieldMessage('resource.error.tooSmall', { min: field.min })
        );
      }
      if (field.max !== undefined && number > field.max) {
        messages.push(
          fieldMessage('resource.error.tooLarge', { max: field.max })
        );
      }
      break;
    }

    case 'money': {
      const parsed = parseMoney(String(value), field.decimals);
      if (!parsed.ok) {
        messages.push(
          parsed.problem === 'not-a-number'
            ? fieldMessage('resource.error.notANumber')
            : fieldMessage('resource.error.tooPrecise', {
                decimals: field.decimals,
              })
        );
      }
      break;
    }

    case 'date':
      if (Number.isNaN(new Date(String(value)).getTime())) {
        messages.push(fieldMessage('resource.error.notADate'));
      }
      break;

    case 'enum':
      if (!field.options.some((option) => option.value === value)) {
        messages.push(fieldMessage('resource.error.notAnOption'));
      }
      break;

    case 'boolean':
    case 'reference':
      break;
  }

  return messages;
}

/** Whether a string is a URL this app is willing to link to. */
function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** One control value, as the wire wants it. */
function toWireValue<T extends ResourceRow>(
  field: FieldDescriptor<T>,
  value: DraftValue
): unknown {
  if (field.kind === 'boolean') {
    if (field.nullable !== true) {
      return value === true;
    }
    // Three answers, and the empty one is `null` rather than `false`. They are
    // different claims: one defers to the scope and the other says the shop
    // does not stock it.
    if (value === '' || value === null) {
      return null;
    }
    return value === true || value === 'true';
  }

  if (field.kind === 'localized-text') {
    return field.entries === 'list'
      ? localizedTextToList(value, field.locales)
      : toLocalizedText(value);
  }

  if (isEmptyValue(value)) {
    return null;
  }

  const text = String(value).trim();

  switch (field.kind) {
    case 'number':
      return Number(text);
    case 'money': {
      const parsed = parseMoney(text, field.decimals);
      // Validation runs first and refuses an unreadable value, so the failing
      // branch is unreachable from the form. It returns the text unchanged
      // rather than throwing, because a caller that skipped validation should
      // get the server's answer, not a client side exception.
      if (!parsed.ok) {
        return text;
      }
      return field.wire === 'number' ? Number(parsed.value) : parsed.value;
    }
    case 'date':
      return new Date(text).toISOString();
    default:
      return text;
  }
}

/**
 * The body to submit.
 *
 * A create sends every editable field that has an answer.
 *
 * An edit sends **only what changed**, which is what `PATCH` means. Sending the
 * whole row back would overwrite a column somebody else changed while the form
 * was open, using a value this form read before they did.
 *
 * An emptied field submits `null` when the column is nullable and is left out
 * when it is not, so clearing an optional field with no null is not sent as an
 * empty string the server would store.
 */
export function toInput<T extends ResourceRow>(
  descriptor: ResourceDescriptor<T>,
  draft: ResourceDraft,
  mode: FormMode,
  original: ResourceDraft
): ResourceInput {
  const input: ResourceInput = {};
  const changed = new Set(changedFields(draft, original));

  for (const field of descriptor.fields) {
    if (!isEditable(field, mode)) {
      continue;
    }

    if (mode === 'edit' && !changed.has(field.name)) {
      continue;
    }

    const value = draft[field.name] ?? emptyValue(field);

    if (isEmptyValue(value) && field.nullable !== true) {
      // Empty, and the column has no null to put there. Leaving it out is the
      // only honest request: this form cannot express what the operator asked
      // for, and an empty string is not it. A required field that is empty
      // never reaches here, because validation refuses the submit first.
      continue;
    }

    input[field.name] = toWireValue(field, value);
  }

  return input;
}
