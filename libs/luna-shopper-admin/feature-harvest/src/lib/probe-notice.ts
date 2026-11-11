import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import type { ProbeVerdict } from '@portfolio/luna-shopper-admin/models';
import { WarningIcon } from '@portfolio/shared/ui';
import { formatSince } from './format-instant';

/**
 * How many probes a start reads to find the newest finished one (admin plan
 * 0069, constraints). A probe in flight and an abort are read past, and ten
 * rows is more of them than a chain has in a row.
 */
export const PROBE_PAGE = 10;

/** A key and the values it is filled with, which a spec can assert on. */
export interface ProbeNoticeMessage {
  readonly key: string;
  readonly args: Readonly<Record<string, unknown>>;
}

/**
 * The notice before a start whose chain's newest finished probe did not pass
 * (admin plan 0069, section 3).
 *
 * **A notice, and the question is the page's.** It draws one sentence and
 * nothing to press. The owner answered on 2026-11-11 that a start over a red
 * probe asks first ("Force a read"), so the page that holds the start asks
 * {@link START_ANYWAY} with this same sentence as its body. The notice stays
 * on the form so that the warning is read before the click as well.
 *
 * In the quiet warning tone of "Will not run" on a schedule: the warning ink and
 * glyph on the surface the form already stands on, with no tinted box, no alert
 * role and no motion. `role="status"` names it as advice and not an alert. It
 * is not a promise that a screen reader announces it: the notice arrives
 * already filled inside an `@if`, and many screen readers announce a live
 * region only when an existing one changes. A person who walks the form still
 * reads it in its place beside the start.
 *
 * Presentational: the page reads the probes and the chain's name and hands
 * them in. A chain the reference could not name is "This chain", never its id.
 */
@Component({
  selector: 'lib-probe-notice',
  imports: [WarningIcon],
  template: `
    <span class="mark"><lib-warning-icon /></span>
    <span class="text">{{ text() }}</span>
  `,
  host: {
    role: 'status',
    '[attr.data-probe-notice]': 'verdict().status',
  },
  styles: `
    :host {
      display: flex;
      gap: var(--admin-space-2);
      align-items: flex-start;
      max-inline-size: 72ch;
      font-size: 0.8125rem;
      color: var(--admin-waiting-on-wash);
    }

    /* The glyph sits on the first line of text and keeps its size when the
       sentence wraps on a narrow screen. */
    .mark {
      flex: none;
      inline-size: 1rem;
      block-size: 1rem;
      margin-block-start: 0.0625rem;
    }

    .text {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProbeNotice {
  private readonly _translator = inject(RokuTranslatorService);

  /** The chain's name, or null where the reference could not name it. */
  readonly chain = input<string | null>(null);
  /** The red probe. */
  readonly verdict = input.required<ProbeVerdict>();
  /** The clock the age is read against. A spec fixes it. */
  readonly now = input<number>(Date.now());

  /** What is said, as a key and its values. */
  readonly message = computed<ProbeNoticeMessage>(() =>
    probeNoticeMessage(
      this._translator,
      this.chain(),
      this.verdict(),
      this.now()
    )
  );

  readonly text = computed(() => {
    const { key, args } = this.message();
    return this._translator.t(key, undefined, undefined, { ...args });
  });
}

/**
 * The question a start asks when the notice shows (admin plan 0069, target 3).
 *
 * The heading holds no placeholder: the body is the notice's own sentence,
 * which names the chain. Written in the shape of a named action's `confirm`,
 * so `action-question-heading.spec.ts` in `ui` holds it to the same rules.
 * The dismissing button is the dialog's own "Cancel".
 */
export const START_ANYWAY = {
  confirm: {
    heading: 'harvest.probeNotice.question.heading',
    action: 'harvest.probeNotice.question.confirm',
  },
} as const;

/**
 * The notice's sentence, as a key and its values. The inline notice draws it,
 * and the question of {@link START_ANYWAY} uses it as its body.
 *
 * It reads the translator's language and load state, so a `computed` that
 * calls it follows both.
 */
export function probeNoticeMessage(
  translator: RokuTranslatorService,
  chain: string | null,
  verdict: ProbeVerdict,
  now: number
): ProbeNoticeMessage {
  const locale = translator.locale();
  translator.loaded();

  return {
    key:
      verdict.error === null
        ? 'harvest.probeNotice.textNoSentence'
        : 'harvest.probeNotice.text',
    args: {
      chain: chain ?? translator.t('harvest.probeNotice.thisChain'),
      age: probeAge(
        verdict.startedAt,
        now,
        translator.t('harvest.probeNotice.justNow'),
        locale
      ),
      status: translator.t(`harvest.probeNotice.status.${verdict.status}`),
      sentence: verdict.error ?? '',
      // The template escapes what it draws. Escaping here as well would put
      // `&#x2F;` in place of every slash of a URL the probe names.
      interpolation: { escapeValue: false },
    },
  };
}

/**
 * How long ago the probe started, in the harvest feature's relative format:
 * "3 days ago", "yesterday".
 *
 * An age that rounds to no seconds, a start that a skewed clock puts in the
 * future and a start that cannot be read all answer `justNow`. The relative
 * format says "now" there, and "the last probe, now, was unreachable" reads
 * wrong, so the sentence takes its own words and never has a hole in it.
 */
export function probeAge(
  startedAt: string,
  now: number,
  justNow: string,
  locale?: string
): string {
  const then = new Date(startedAt).getTime();
  if (Number.isNaN(then) || Math.round((now - then) / 1000) <= 0) {
    return justNow;
  }
  return formatSince(startedAt, now, locale) || justNow;
}
