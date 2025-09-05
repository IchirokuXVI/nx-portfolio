import { AreaStatus, Project } from '@portfolio/landing/models';

export const PROJECTS: readonly Project[] = [
  {
    id: '1',
    name: 'Portfolio',
    description:
      'My personal portfolio website built with NX and different technologies, primarily Angular 20. Used module federation to create micro-frontends and also used Jest, Cypress and Playwright for testing.',
    appLink: '/',
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    image: '',
    areas: [
      {
        name: 'Frontend',
        status: AreaStatus.COMPLETED,
        progress: 80,
        internalAreas: [
          {
            name: 'NX',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'MFE',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Angular 20',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Jest',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Cypress',
            status: AreaStatus.PENDING,
            progress: 0,
          },
        ],
      },
      {
        name: 'Backend',
        status: AreaStatus.PENDING,
        progress: 0,
        internalAreas: [
          {
            name: 'C# Microservice',
            status: AreaStatus.PENDING,
            progress: 0,
          },
          {
            name: 'SQL',
            status: AreaStatus.PENDING,
            progress: 0,
          },
        ],
      },
      {
        name: 'DevOps',
        status: AreaStatus.IN_PROGRESS,
        progress: 50,
        internalAreas: [
          {
            name: 'CI/CD',
            status: AreaStatus.IN_PROGRESS,
            progress: 50,
          },
          {
            name: 'Docker',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'SSL renewal',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
        ],
      },
    ],
  },
  {
    id: '2',
    name: 'Odontogram',
    description:
      'Full odontogram to save treatments and keep the history of patients. One of my first UI projects made solely by me. Teeth can have treatments that affect up to six zones and also more than one tooth.',
    appLink: '/odontogram',
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/odontogram_screenshot.png`).then(
      (m) => m.default
    ),
    areas: [
      {
        name: 'Frontend',
        status: AreaStatus.COMPLETED,
        progress: 100,
        internalAreas: [
          {
            name: 'Teeth Images',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Draw on tooth',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Add treatments',
            status: AreaStatus.COMPLETED,
            progress: 100,
          },
          {
            name: 'Testing',
            status: AreaStatus.IN_PROGRESS,
            progress: 70,
          },
        ],
      },
      {
        name: 'Backend',
        status: AreaStatus.PENDING,
        progress: 0,
      },
    ],
  },
  {
    id: '3',
    name: 'Restaurant Point Of Sale',
    description:
      'My biggest project so far. Complete POS with support for remote printing over internet (not only local), WebSocket, fully responsive with an exclusive mobile view for easier use and many more.',
    appLink: '/point-of-sale',
    repoLink: 'https://github.com/ichirokuxvi/nx-portfolio',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/pos_screenshot.png`).then((m) => m.default),
    areas: [
      {
        name: 'Frontend',
        status: AreaStatus.PENDING,
        progress: 0,
        internalAreas: [
          {
            name: 'Migration to Angular 20',
            status: AreaStatus.PENDING,
            progress: 0,
          },
        ],
      },
      {
        name: 'Backend',
        status: AreaStatus.PENDING,
        progress: 0,
      },
    ],
  },
];
