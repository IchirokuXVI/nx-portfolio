export type ProjectKind = 'client-project' | 'game';

export type ProjectAddonKind = 'video' | 'image';

export type ProjectAddonPosition = 'right' | 'top-right';

export interface ProjectAddon {
  kind: ProjectAddonKind;
  position: ProjectAddonPosition;
  /**
   * Resolved asset URL. The service resolves the underlying asset key for you,
   * so consumers never need the {@link ../asset/asset-memory#AssetMemory}.
   */
  src: Promise<string>;
  alt?: string;
}

export interface Project {
  id: string;
  kind: ProjectKind;
  /** Project name (a proper noun — the same in every locale). */
  label: string;
  addons?: ProjectAddon[];
}

/** A single metadata chip (e.g. Platform / Virtual Reality). Both are localized. */
export interface ProjectTag {
  label: string;
  value: string;
}

export interface ProjectTranslation {
  id: string;
  projectId: string;
  locale: string;
  description: string;
  /** Extra metadata surfaced by detailed views; absent when a project has none. */
  tags?: ProjectTag[];
}

export type TranslatedProject = Project & ProjectTranslation;
