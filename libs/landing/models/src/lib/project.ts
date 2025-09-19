import { ProjectTranslation } from './project-translation';

export interface Project {
  id: string;
  repoLink: string;
}

export type TranslatedProject = Project & ProjectTranslation;
