import { ProjectArea, ProjectAreaStatus } from '@portfolio/landing/models';

export const PROJECT_AREAS: readonly ProjectArea[] = [
  {
    id: '1',
    project: '1',
    area: '1',
    progress: 80,
    status: ProjectAreaStatus.IN_PROGRESS,
  },
  {
    id: '2',
    project: '1',
    area: '2',
    progress: 0,
    status: ProjectAreaStatus.PENDING,
  },
  {
    id: '3',
    project: '1',
    area: '3',
    progress: 50,
    status: ProjectAreaStatus.ON_HOLD,
  },
  {
    id: '4',
    project: '2',
    area: '1',
    progress: 100,
    status: ProjectAreaStatus.COMPLETED,
  },
  {
    id: '5',
    project: '2',
    area: '2',
    progress: 0,
    status: ProjectAreaStatus.PENDING,
  },
  {
    id: '6',
    project: '3',
    area: '1',
    progress: 0,
    status: ProjectAreaStatus.PENDING,
  },
  {
    id: '7',
    project: '3',
    area: '2',
    progress: 0,
    status: ProjectAreaStatus.PENDING,
  },
];
