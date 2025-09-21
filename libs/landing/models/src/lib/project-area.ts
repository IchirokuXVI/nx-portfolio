import { ProjectAreaStatus } from './project-area-status';

export interface ProjectArea {
  id: string;
  project: string;
  area: string;
  progress: number;
  status: ProjectAreaStatus;
}
