export interface ProjectVisual {
  /** Columns the card spans in the 2-col desktop grid. 1 or 2. */
  columnSpan: 1 | 2;
  /** Featured cards use the wide split layout (image beside text). */
  featured: boolean;
}

export interface Project {
  id: string;
  /** Proper noun — same in every locale. */
  name: string;
  /** Structural (locale-independent) tag chips, e.g. ['Angular', 'Nx']. */
  tags: string[];
  repoLink: string;
  /** Route to the in-portfolio detail page, e.g. '/en/projects/odontogram'. */
  detailLink?: string;
  /** Route to the live app, e.g. '/en/odontogram'. */
  appLink?: string;
  /**
   * The live app is this very site (the portfolio itself). When true the card
   * disables "View project" — you are already here.
   */
  isCurrentSite?: boolean;
  /**
   * Project screenshot. Optional: when absent, the card renders a generic
   * placeholder (0003) — there is no media-kind discriminator.
   */
  image?: string | Promise<string>;
  visual: ProjectVisual;
}

export interface ProjectTranslation {
  id: string;
  projectId: string;
  locale: string;
  /** Short one-liner under the title on the card. */
  tagline: string;
  description: string;
}

export type TranslatedProject = Project & ProjectTranslation;
