import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { DetailPageShell } from '../detail-page-shell/detail-page-shell';
import { DetailSection } from '../detail-section/detail-section';
import { DetailToc, TocItem } from '../detail-toc/detail-toc';
import { FactRow, FactsTable } from '../facts-table/facts-table';
import { TechChipGroup } from '../tech-chip-group/tech-chip-group';

const KEY = 'landingV2.detail.portfolio';

/** Section order for the page and its table of contents. Ids are stable and
 * locale-independent (they anchor the TOC and the deep-link fragments); the
 * heading/lead/detail copy is looked up by i18n key off each id. */
const SECTION_IDS = [
  'overview',
  'micro-frontends',
  'localization',
  'libraries',
  'engineering',
] as const;

/** Tech chips grouped by role. Chip text is literal (product names, not
 * translated); only the group heading localizes. */
const CHIP_GROUPS: { headingKey: string; chips: string[] }[] = [
  {
    headingKey: `${KEY}.chips.frontend`,
    chips: ['Angular 21', 'TypeScript 5.9', 'Module Federation', 'i18next'],
  },
  {
    headingKey: `${KEY}.chips.tooling`,
    chips: ['Nx 22', 'Jest', 'Cypress', 'Playwright'],
  },
  {
    headingKey: `${KEY}.chips.delivery`,
    chips: ['Docker', 'k3s', 'Helm', 'GitHub Actions'],
  },
];

const FACTS: FactRow[] = ['stack', 'apps', 'testing', 'deploy'].map((id) => ({
  labelKey: `${KEY}.facts.${id}.label`,
  valueKey: `${KEY}.facts.${id}.value`,
}));

/**
 * "This site, and how it's built." — Portfolio detail content, resolved
 * dynamically by `lib-landing-v2-project-page` (feature-project) for
 * `/{locale}/projects/portfolio`. Lives in the ui lib (not a feature-* lib)
 * so it shares the RokuTranslatorModule config already registered by
 * landing-v2-ui-module for every other landingV2 page.
 *
 * Progressive disclosure (0007): the highlights (each section's lead) render
 * by default; the `deepDive` toggle reveals every section's in-depth block at
 * once. The component stays thin, composing `DetailPageShell` plus the shared
 * `ui` pieces and supplying only the section list and i18n keys.
 */
@Component({
  selector: 'lib-landing-v2-portfolio-content',
  imports: [
    DetailPageShell,
    DetailSection,
    DetailToc,
    TechChipGroup,
    FactsTable,
    RokuTranslatorPipe,
  ],
  templateUrl: './portfolio-content.html',
  styleUrl: './portfolio-content.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PortfolioContent {
  project = input.required<TranslatedProject>();

  /** Highlights-only by default; flips to reveal every section's deep block. */
  readonly deepDive = signal(false);

  readonly key = KEY;
  readonly sectionIds = SECTION_IDS;
  readonly chipGroups = CHIP_GROUPS;
  readonly facts = FACTS;

  readonly tocItems: TocItem[] = SECTION_IDS.map((id) => ({
    id,
    labelKey: `${KEY}.sections.${id}.title`,
  }));

  toggleDeepDive(): void {
    this.deepDive.update((open) => !open);
  }
}
