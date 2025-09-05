import { AreaStatus } from './area-status';

export interface ProjectArea {
  name: string;
  status: AreaStatus;
  progress: number;
  internalAreas?: Exclude<ProjectArea, 'internalAreas'>[];
}
