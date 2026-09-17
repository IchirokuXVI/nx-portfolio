import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ArrowIcon } from '@portfolio/shared/ui';
import { DetailPageShell } from '../detail-page-shell/detail-page-shell';
import { DetailSection } from '../detail-section/detail-section';
import { DetailToc, TocItem } from '../detail-toc/detail-toc';
import { TechChipGroup } from '../tech-chip-group/tech-chip-group';

const KEY = 'landingV2.detail.velista';

/**
 * Velista's own origin, where it installs as an app. The one absolute URL in
 * landingV2: every other link to Velista, including "Visit live app", is the
 * relative `/velista/{locale}` mount (plan 0009 D1). A URL, so not translated.
 */
export const VELISTA_ORIGIN = 'https://velista.app';

interface SectionDef {
  id: string;
  /** Deep-only sections appear only in the expanded view. */
  deepOnly?: boolean;
  highlightCount: number;
  deepCount: number;
}

/**
 * Sections in deep-view order. The highlight view is this list with the
 * deep-only sections filtered out. Paragraphs are i18n keys
 * `sections.<id>.{highlight,deep}.pN`, the same shape as the Portfolio page.
 */
const SECTIONS: SectionDef[] = [
  { id: 'overview', highlightCount: 1, deepCount: 3 },
  { id: 'stack', highlightCount: 2, deepCount: 3 },
  { id: 'evolution', deepOnly: true, highlightCount: 0, deepCount: 4 },
  { id: 'permissions', highlightCount: 2, deepCount: 4 },
  { id: 'catalog', highlightCount: 2, deepCount: 3 },
  { id: 'curation', highlightCount: 2, deepCount: 4 },
  { id: 'harvester', highlightCount: 2, deepCount: 4 },
  { id: 'assistant', highlightCount: 1, deepCount: 2 },
  { id: 'baskets', deepOnly: true, highlightCount: 0, deepCount: 2 },
];

/** Chip text is literal (product names); only the group heading localizes. */
const CHIP_GROUPS: { headingKey: string; chips: string[] }[] = [
  {
    headingKey: `${KEY}.chips.frontend`,
    chips: ['Angular 21', 'TypeScript', 'PWA', 'Module Federation'],
  },
  {
    headingKey: `${KEY}.chips.backend`,
    chips: ['NestJS', 'NATS', 'PostgreSQL', 'Redis'],
  },
  {
    headingKey: `${KEY}.chips.deployment`,
    chips: ['Docker', 'Kubernetes', 'Helm', 'GitHub Actions'],
  },
];

/**
 * Velista detail content, resolved by `lib-landing-v2-project-page` for
 * `/{locale}/projects/velista`. Follows the Portfolio page's design: tech chips
 * beside the title, the table of contents alone in the side rail, and a
 * highlights view that swaps to a deep view with deep-only sections (0008).
 * The own domain panel stays first in the body, above either view.
 */
@Component({
  selector: 'lib-landing-v2-velista-content',
  imports: [
    NgTemplateOutlet,
    ArrowIcon,
    DetailPageShell,
    DetailSection,
    DetailToc,
    TechChipGroup,
    RokuTranslatorPipe,
  ],
  templateUrl: './velista-content.html',
  styleUrl: './velista-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VelistaContent {
  project = input.required<TranslatedProject>();

  /** Highlights-only by default; flips to reveal the deep view. */
  readonly deepDive = signal(false);

  /** Drives the collapse, swap, grow height animation (see PortfolioContent). */
  readonly collapsed = signal(false);

  private _swapTimer?: ReturnType<typeof setTimeout>;

  readonly key = KEY;
  readonly origin = VELISTA_ORIGIN;
  readonly chipGroups = CHIP_GROUPS;

  readonly visibleSections = computed<SectionDef[]>(() =>
    this.deepDive() ? SECTIONS : SECTIONS.filter((section) => !section.deepOnly)
  );

  readonly tocItems = computed<TocItem[]>(() =>
    this.visibleSections().map((section) => ({
      id: section.id,
      labelKey: this.headingKey(section),
    }))
  );

  headingKey(section: SectionDef): string {
    return `${KEY}.sections.${section.id}.title`;
  }

  /** Ordered paragraph keys for the section at the current depth. */
  paragraphKeys(section: SectionDef): string[] {
    const depth = this.deepDive() ? 'deep' : 'highlight';
    const count = this.deepDive() ? section.deepCount : section.highlightCount;

    return Array.from(
      { length: count },
      (_, index) => `${KEY}.sections.${section.id}.${depth}.p${index + 1}`
    );
  }

  toggleDeepDive(): void {
    const opening = !this.deepDive();
    const prefersReduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;

    if (prefersReduced) {
      this.deepDive.set(opening);
      return;
    }

    this.collapsed.set(true);

    clearTimeout(this._swapTimer);
    this._swapTimer = setTimeout(() => {
      this.deepDive.set(opening);
      requestAnimationFrame(() => this.collapsed.set(false));
    }, 450);
  }
}
