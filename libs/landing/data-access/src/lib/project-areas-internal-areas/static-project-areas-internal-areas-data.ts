import {
  ProjectAreaInternalArea,
  ProjectAreaStatus,
} from '@portfolio/landing/models';

export const PROJECT_AREAS_INTERNAL_AREAS: readonly ProjectAreaInternalArea[] =
  [
    // Project 1 - Frontend (projectArea 1)
    {
      id: '1',
      projectArea: '1',
      internalArea: '6', // NX
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '2',
      projectArea: '1',
      internalArea: '18', // MFE
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '3',
      projectArea: '1',
      internalArea: '4', // Angular
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '4',
      projectArea: '1',
      internalArea: '8', // Jest
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '5',
      projectArea: '1',
      internalArea: '9', // Cypress
      progress: 0,
      status: ProjectAreaStatus.PENDING,
    },

    // Project 1 - Backend (projectArea 2)
    {
      id: '6',
      projectArea: '2',
      internalArea: '19', // C# Microservice
      progress: 0,
      status: ProjectAreaStatus.PENDING,
    },
    {
      id: '7',
      projectArea: '2',
      internalArea: '20', // SQL
      progress: 0,
      status: ProjectAreaStatus.PENDING,
    },

    // Project 1 - DevOps (projectArea 3)
    {
      id: '8',
      projectArea: '3',
      internalArea: '12', // CI/CD
      progress: 50,
      status: ProjectAreaStatus.IN_PROGRESS,
    },
    {
      id: '9',
      projectArea: '3',
      internalArea: '7', // Docker
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '10',
      projectArea: '3',
      internalArea: '13', // SSL-renewal
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },

    // Project 2 - Frontend (projectArea 4)
    {
      id: '11',
      projectArea: '4',
      internalArea: '14', // Teeth Images
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '12',
      projectArea: '4',
      internalArea: '15', // Draw on tooth
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '13',
      projectArea: '4',
      internalArea: '16', // Add treatments
      progress: 100,
      status: ProjectAreaStatus.COMPLETED,
    },
    {
      id: '14',
      projectArea: '4',
      internalArea: '11', // Testing
      progress: 70,
      status: ProjectAreaStatus.IN_PROGRESS,
    },

    // Project 2 - Backend (projectArea 5)
    // (no internalAreas)

    // Project 3 - Frontend (projectArea 6)
    {
      id: '15',
      projectArea: '6',
      internalArea: '17', // Migration to Angular 20
      progress: 0,
      status: ProjectAreaStatus.PENDING,
    },

    // Project 3 - Backend (projectArea 7)
    // (no internalAreas)
  ];
