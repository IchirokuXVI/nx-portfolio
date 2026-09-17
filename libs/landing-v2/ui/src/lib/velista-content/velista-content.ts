import { ChangeDetectionStrategy, Component, input } from '@angular/core';
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
  paragraphCount: number;
  /** Renders the section's `kicker` key above its heading. */
  kicker?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'overview', paragraphCount: 3 },
  { id: 'stack', paragraphCount: 3 },
  { id: 'evolution', paragraphCount: 4 },
  { id: 'catalog', paragraphCount: 3, kicker: true },
  { id: 'harvester', paragraphCount: 3 },
  { id: 'baskets', paragraphCount: 2 },
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
 * `/{locale}/projects/velista`. A single view page (plan 0009 D3): the own
 * domain panel first, then paragraph list sections, with the table of contents
 * and the tech chips in the side rail.
 */
@Component({
  selector: 'lib-landing-v2-velista-content',
  imports: [
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

  readonly key = KEY;
  readonly origin = VELISTA_ORIGIN;
  readonly chipGroups = CHIP_GROUPS;

  /** The keys never change, so they are built once rather than per check. */
  readonly sections = SECTIONS.map((section) => {
    const base = `${KEY}.sections.${section.id}`;

    return {
      id: section.id,
      headingKey: `${base}.title`,
      kickerKey: section.kicker ? `${base}.kicker` : null,
      paragraphKeys: Array.from(
        { length: section.paragraphCount },
        (_, index) => `${base}.p${index + 1}`
      ),
    };
  });

  readonly tocItems: TocItem[] = this.sections.map((section) => ({
    id: section.id,
    labelKey: section.headingKey,
  }));
}
