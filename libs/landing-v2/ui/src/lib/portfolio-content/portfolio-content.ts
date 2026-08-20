import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
} from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DetailPageShell } from '../detail-page-shell/detail-page-shell';
import { DetailSection } from '../detail-section/detail-section';
import { DetailToc, TocItem } from '../detail-toc/detail-toc';
import { TechChipGroup } from '../tech-chip-group/tech-chip-group';

const KEY = 'landingV2.detail.portfolio';

interface SectionDef {
  id: string;
  /** Deep-only sections appear only in the expanded view. */
  deepOnly?: boolean;
  highlightCount: number;
  deepCount: number;
}

/**
 * Sections in deep-view order. The highlight view is this list with the
 * deep-only sections filtered out. Each section's paragraphs are i18n keys
 * `sections.<id>.{highlight,deep}.pN`, so the same section renders its short
 * highlight set or its longer deep-dive set depending on the toggle (0008).
 */
const SECTIONS: SectionDef[] = [
  { id: 'overview', highlightCount: 1, deepCount: 3 },
  { id: 'micro-frontends', highlightCount: 2, deepCount: 3 },
  { id: 'mf-topology', deepOnly: true, highlightCount: 0, deepCount: 2 },
  { id: 'localization', highlightCount: 2, deepCount: 4 },
  { id: 'organizing', highlightCount: 2, deepCount: 3 },
  { id: 'assets', deepOnly: true, highlightCount: 0, deepCount: 2 },
  { id: 'infrastructure', highlightCount: 3, deepCount: 3 },
  { id: 'testing', deepOnly: true, highlightCount: 0, deepCount: 2 },
];

/** Tech chips grouped by role. Chip text is literal (product names, not
 * translated); only the group heading localizes. */
const CHIP_GROUPS: { headingKey: string; chips: string[] }[] = [
  {
    headingKey: `${KEY}.chips.frontend`,
    chips: ['Angular 21', 'TypeScript', 'Module Federation', 'Localization'],
  },
  {
    headingKey: `${KEY}.chips.tooling`,
    chips: ['Nx 22', 'Jest', 'Cypress', 'Playwright'],
  },
  {
    headingKey: `${KEY}.chips.deployment`,
    chips: ['Docker', 'Kubernetes', 'Helm', 'GitHub Actions'],
  },
];

/**
 * "This site, and how it's built." — Portfolio detail content, resolved
 * dynamically by `lib-landing-v2-project-page` (feature-project) for
 * `/{locale}/projects/portfolio`. Lives in the ui lib (not a feature-* lib)
 * so it shares the RokuTranslatorModule config already registered by
 * landing-v2-ui-module for every other landingV2 page.
 *
 * Progressive disclosure (0008): the highlights (a few short paragraphs per
 * section) render by default with a reveal button at the bottom. Toggling
 * `deepDive` swaps the whole body to the deeper multi-paragraph content plus
 * the deep-only sections, moves the button to the top, scrolls back up, and
 * shows a closing note. The component stays thin, composing `DetailPageShell`
 * plus the shared `ui` pieces and supplying only the section list and keys.
 */
@Component({
  selector: 'lib-landing-v2-portfolio-content',
  imports: [
    NgTemplateOutlet,
    DetailPageShell,
    DetailSection,
    DetailToc,
    TechChipGroup,
    RokuTranslatorPipe,
  ],
  templateUrl: './portfolio-content.html',
  styleUrl: './portfolio-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioContent {
  private _host = inject<ElementRef<HTMLElement>>(ElementRef);

  project = input.required<TranslatedProject>();

  /** Highlights-only by default; flips to reveal the deep view. */
  readonly deepDive = signal(false);

  /** Drives the crossfade: the body fades out, the view swaps while it is
   * hidden, then it fades back in, so highlights and deep never overlap. */
  readonly contentVisible = signal(true);

  private _swapTimer?: ReturnType<typeof setTimeout>;

  readonly key = KEY;
  readonly chipGroups = CHIP_GROUPS;

  /** Highlight view hides the deep-only sections; deep view shows them all. */
  readonly visibleSections = computed<SectionDef[]>(() =>
    this.deepDive() ? SECTIONS : SECTIONS.filter((section) => !section.deepOnly)
  );

  readonly tocItems = computed<TocItem[]>(() =>
    this.visibleSections().map((section) => ({
      id: section.id,
      labelKey: `${KEY}.sections.${section.id}.title`,
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
    const fadeMs = prefersReduced ? 0 : 180;

    // Phase 1: fade the current view out.
    this.contentVisible.set(false);

    clearTimeout(this._swapTimer);
    this._swapTimer = setTimeout(() => {
      // Phase 2 (hidden): swap the content, and on expanding jump back to the
      // top so the relocated button and the fresh content start in view.
      this.deepDive.set(opening);

      if (opening) {
        this._host.nativeElement.scrollIntoView({ block: 'start' });
      }

      // Phase 3: fade the new view in.
      this.contentVisible.set(true);
    }, fadeMs);
  }
}
