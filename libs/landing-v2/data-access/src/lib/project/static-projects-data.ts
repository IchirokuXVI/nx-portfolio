import { ProjectVisual } from '@portfolio/landing-v2/models';

/**
 * Project as authored in the static data: locale-independent fields plus the
 * path segments the service uses to build `appLink`/`detailLink` per locale
 * (kept as slugs here so the structural data stays DRY — see
 * {@link ./project-memory}).
 */
export interface StaticProject {
  id: string;
  /** Proper noun — same in every locale. */
  name: string;
  tags: string[];
  repoLink: string;
  visual: ProjectVisual;
  /**
   * Path segment for the in-portfolio detail page, joined as
   * `/{locale}/projects/{detailSlug}`. Omit while the detail page is deferred
   * (e.g. the Point Of Sale project).
   */
  detailSlug?: string;
  /**
   * Path segment for the live app link, joined as `/{locale}/{appSlug}`.
   * Empty string means the live app is the site root itself (Portfolio).
   * Omit if there is no live app to link to.
   */
  appSlug?: string;
  /**
   * Project screenshot, lazily imported. Omitted projects (Portfolio,
   * Damocle'Sword — no screenshot captured yet) render the generic
   * placeholder (0003) instead; no code change needed once an image ships.
   */
  image?: () => Promise<string>;
}

export const PROJECTS: readonly StaticProject[] = [
  {
    id: '1',
    name: 'Portfolio',
    tags: ['Angular', 'Nx', 'Module Federation'],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 2, featured: true },
    detailSlug: 'portfolio',
    appSlug: '',
    // image: pending D-portfolio-image (Nx module-federation graph asset).
  },
  {
    id: '2',
    name: "Damocle'Sword",
    tags: ['Angular', 'VR', 'Micro-frontend'],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 2, featured: true },
    detailSlug: 'damoclesSword',
    appSlug: 'damoclesSword',
    // image: pending a captured screenshot of the damoclesSword home hero.
  },
  {
    id: '3',
    name: 'Odontogram',
    tags: ['Angular', 'SVG'],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 1, featured: false },
    detailSlug: 'odontogram',
    appSlug: 'odontogram',
    image: () =>
      import('../../assets/odontogram_screenshot.png').then((m) => m.default),
  },
  {
    id: '4',
    name: 'Restaurant Point Of Sale',
    tags: ['Angular', 'WebSocket', 'Responsive'],
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    visual: { columnSpan: 1, featured: false },
    // detailSlug omitted — detail page deferred.
    // appSlug omitted — no live app deployed yet, so the card shows the
    // "Project not available" disabled state.
    image: () =>
      import('../../assets/pos_screenshot.png').then((m) => m.default),
  },
];
