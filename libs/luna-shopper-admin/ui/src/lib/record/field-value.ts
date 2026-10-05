import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import type { RecordValue } from '@portfolio/luna-shopper-admin/models';
import { ScopeMark } from '../page/scope-mark';

/**
 * The languages that `record.language` names in words. A screen reader hears
 * the code of any other one, which is better than a key that has no text.
 * `field-value.spec.ts` holds this list to the catalogue.
 */
export const NAMED_LANGUAGES: readonly string[] = ['en', 'es'];

/** One of several references, as its row is drawn. */
interface ReferenceLine {
  readonly id: string;
  /** The name, `null` for a record that is gone, `undefined` while it is read. */
  readonly name: string | null | undefined;
  readonly link: readonly string[] | null;
}

/**
 * One value, while the page reads (admin plan 0052, section 3.2).
 *
 * The one switch over the kinds of a {@link RecordValue}, as `FieldControl` is
 * the one switch for changing. It decides nothing about the value: `models`
 * said what it is, and this draws it.
 *
 * **An empty value reads "None".** Never a blank and never a dash, so an empty
 * field and a field that failed to load do not look the same.
 *
 * **A reference is drawn by name and never by its ID.** The value carries the
 * name when the row does. When it does not, the page resolves it and hands it
 * in: {@link name} for one reference, {@link names} for several. In `names`
 * an ID that is absent is still being read, and an ID held with `null` points
 * at a record that is gone. One reference is looked for there too, so the page
 * can hand the same map to both.
 *
 * A reference with no link is text and not a link. A link that leads to a 404
 * is worse.
 */
@Component({
  selector: 'lib-field-value',
  imports: [RokuTranslatorPipe, RouterLink, ScopeMark],
  template: `
    @let shown = value();

    <!-- How specific a price scope is, before its name. The word beside it
         says the kind, so the mark is named only where no word does. -->
    @if (shown.scope; as scope) {
      <lib-scope-mark
        [label]="saysKind() ? '' : (scope.label | rokuT)"
        [level]="scope.level"
      />
    }

    @switch (shown.kind) {
      @case ('none') {
        <span class="none" data-none>{{ 'resource.value.none' | rokuT }}</span>
      }

      @case ('text') {
        <span [class.mono]="shown.mono === true" class="text">{{
          shown.text
        }}</span>
      }

      @case ('word') {
        <span>{{ shown.key | rokuT: shown.args ?? {} }}</span>
      }

      @case ('link') {
        <!-- rel="noopener" on every outbound link: the tab one opens must not
             be able to reach back into an admin session. -->
        <a [href]="shown.href" rel="noopener noreferrer" target="_blank">{{
          shown.text
        }}</a>
      }

      @case ('image') {
        <span class="picture">
          <!-- An empty alt: the address beside the picture names it. A picture
               that does not load leaves the grey square, and the address is
               still a link. -->
          <span class="thumb">
            @if (!broken()) {
              <img
                (error)="failed.set(shown.src)"
                [src]="shown.src"
                alt=""
                loading="lazy"
              />
            }
          </span>
          <a [href]="shown.src" rel="noopener noreferrer" target="_blank">{{
            shown.src
          }}</a>
        </span>
      }

      @case ('lines') {
        <span class="lines">
          @for (line of shown.lines; track line.locale) {
            <span class="line">
              <!-- The tag is for the eye. A screen reader hears the language
                   in words. -->
              <span aria-hidden="true" class="lang">{{ line.locale }}</span>
              <span class="sr-only">{{
                named(line.locale)
                  ? ('record.language.' + line.locale | rokuT)
                  : line.locale
              }}</span>
              @if (line.text !== null) {
                <span [attr.lang]="line.locale" class="text">{{
                  line.text
                }}</span>
              } @else {
                <span class="none" data-not-written>{{
                  'record.value.notWritten' | rokuT
                }}</span>
              }
            </span>
          }
        </span>
      }

      @case ('reference') {
        @let target = single();
        @if (target === null) {
          <span class="none">{{ 'resource.value.none' | rokuT }}</span>
        } @else if (target.name === undefined) {
          <span class="none" data-resolving>{{
            'resource.reference.resolving' | rokuT
          }}</span>
        } @else if (target.name === null) {
          <span class="gone" data-gone>{{ 'record.value.gone' | rokuT }}</span>
        } @else if (target.link !== null) {
          <a [routerLink]="target.link">{{ target.name }}</a>
        } @else {
          <span>{{ target.name }}</span>
        }
      }

      @case ('references') {
        <ul class="references">
          @for (target of several(); track target.id; let first = $first) {
            <li>
              @if (target.name === undefined) {
                <span class="none" data-resolving>{{
                  'resource.reference.resolving' | rokuT
                }}</span>
              } @else if (target.name === null) {
                <span class="gone" data-gone>{{
                  'record.value.gone' | rokuT
                }}</span>
              } @else if (target.link !== null) {
                <a [routerLink]="target.link">{{ target.name }}</a>
              } @else {
                <span>{{ target.name }}</span>
              }
              <!-- The first is the one a row shows when it has room for one,
                   and only where the order counts. -->
              @if (first && shown.ordered) {
                <span class="main" data-main>{{
                  'resource.references.main' | rokuT
                }}</span>
              }
            </li>
          }
        </ul>
      }

      @case ('json') {
        <pre>{{ shown.text }}</pre>
      }
    }

    <!-- What a person must look at in this value. Amber, and amber means only
         this. -->
    @if (shown.check; as check) {
      <span class="check" data-check>{{
        check.label | rokuT: check.args ?? {}
      }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--admin-space-1) var(--admin-space-2);
      align-items: baseline;
      max-inline-size: 100%;
      overflow-wrap: anywhere;
    }

    /* A longer text keeps the line breaks it was written with. */
    .text {
      white-space: pre-line;
    }

    .mono,
    pre {
      font-family: var(--admin-font-mono);
      font-size: 0.8125rem;
    }

    pre {
      max-inline-size: 100%;
      overflow-x: auto;
      white-space: pre-wrap;
    }

    .none {
      color: var(--admin-ink-muted);
    }

    .gone {
      color: var(--admin-danger);
    }

    a {
      text-decoration: underline;
      text-underline-offset: 0.1875rem;
    }

    .picture {
      display: inline-flex;
      gap: var(--admin-space-3);
      align-items: center;
      min-inline-size: 0;
    }

    .thumb {
      display: block;
      flex: none;
      inline-size: 3.5rem;
      block-size: 3.5rem;
      overflow: hidden;
      border: 1px solid var(--admin-border);
      border-radius: var(--admin-radius-control);
      background: var(--admin-neutral-wash);
    }

    img {
      display: block;
      inline-size: 100%;
      block-size: 100%;
      object-fit: contain;
    }

    .lines,
    .references {
      display: flex;
      flex-direction: column;
      gap: var(--admin-space-1);
      list-style: none;
    }

    .line,
    li {
      display: flex;
      gap: var(--admin-space-2);
      align-items: baseline;
    }

    .lang {
      flex: none;
      inline-size: 1.5rem;
      font-family: var(--admin-font-mono);
      font-size: 0.75rem;
      text-transform: uppercase;
      color: var(--admin-ink-muted);
    }

    .main {
      flex: none;
      padding: 0.0625rem var(--admin-space-2);
      border-radius: var(--admin-radius-state);
      background: var(--admin-neutral-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-neutral-on-wash);
    }

    .check {
      padding: 0.0625rem var(--admin-space-2);
      border-radius: var(--admin-radius-state);
      background: var(--admin-waiting-wash);
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--admin-waiting-on-wash);
    }

    .sr-only {
      position: absolute;
      inline-size: 1px;
      block-size: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldValue {
  /** What to draw. */
  readonly value = input.required<RecordValue>();
  /** The resolved name of a reference whose value carries none. */
  readonly name = input<string | null>(null);
  /**
   * The resolved names of several references, by ID. Absent is still being
   * read, and `null` is a record that is gone.
   */
  readonly names = input<Readonly<Record<string, string | null>>>({});
  /** Router commands to the record a reference points at. */
  readonly link = input<readonly string[] | null>(null);
  /** The same for several references, by ID. */
  readonly links = input<Readonly<Record<string, readonly string[]>>>({});

  /** Whether the catalogue has a word for this language. */
  named(locale: string): boolean {
    return NAMED_LANGUAGES.includes(locale);
  }

  /** The address of a picture that did not load. */
  readonly failed = signal<string | null>(null);

  /** Whether the picture this value names is the one that did not load. */
  readonly broken = computed(() => {
    const value = this.value();
    return value.kind === 'image' && this.failed() === value.src;
  });

  /**
   * Whether the value is itself the word for the kind of its scope. The mark
   * is then not named again for a screen reader, which would hear it twice.
   */
  readonly saysKind = computed(() => {
    const value = this.value();
    return value.kind === 'word' && value.key === value.scope?.label;
  });

  /** One reference, with whichever name is known for it. */
  readonly single = computed<ReferenceLine | null>(() => {
    const value = this.value();
    if (value.kind !== 'reference') {
      return null;
    }
    const names = this.names();
    return {
      id: value.id,
      name:
        value.name ??
        this.name() ??
        (value.id in names ? names[value.id] : undefined),
      link: this.link() ?? this.links()[value.id] ?? null,
    };
  });

  /** Several references, in the order the row holds them. */
  readonly several = computed<readonly ReferenceLine[]>(() => {
    const value = this.value();
    if (value.kind !== 'references') {
      return [];
    }
    const names = this.names();
    const links = this.links();
    return value.ids.map((id) => ({
      id,
      name: id in names ? names[id] : undefined,
      link: links[id] ?? null,
    }));
  });
}
