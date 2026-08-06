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

export interface ProjectTranslation {
  id: string;
  projectId: string;
  locale: string;
  description: string;
}

export type TranslatedProject = Project & ProjectTranslation;
