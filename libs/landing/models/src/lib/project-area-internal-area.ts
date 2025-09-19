import { ProjectAreaStatus } from './project-area-status';

export interface ProjectAreaInternalArea {
  id: string;
  projectArea: string;
  internalArea: string;
  progress: number;
  status: ProjectAreaStatus;
}
