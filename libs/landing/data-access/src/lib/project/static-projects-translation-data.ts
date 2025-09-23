import { ProjectTranslation } from '@portfolio/landing/models';

export const PROJECTS_TRANSLATIONS: readonly ProjectTranslation[] = [
  {
    id: '1',
    projectId: '1',
    locale: 'en',
    name: 'Portfolio',
    description:
      'My personal portfolio website built with NX and different technologies, primarily Angular 20. It is a very complete project with module federation, translation, testing and CI/CD. I tried to follow best practices for everything to improve my overall skills and learn new things.',
    appLink: '/en',
    image: '',
  },
  {
    id: '2',
    projectId: '1',
    locale: 'es',
    name: 'Portafolio',
    description:
      'Mi sitio portafolio web construido con NX y diferentes tecnologías, principalmente Angular 20. Es un proyecto muy completo con federación de módulos, traducción, pruebas y CI/CD. Intenté seguir las mejores prácticas en todo lo posible para aprender y mejorar durante el desarrollo.',
    appLink: '/es',
    image: '',
  },

  // Odontogram
  {
    id: '3',
    projectId: '2',
    locale: 'en',
    name: 'Odontogram',
    description:
      'Full odontogram to save treatments and keep the history of patients. One of my first UI projects made solely by me. Teeth can have treatments that affect up to six zones and also more than one tooth.',
    appLink: '/en/odontogram',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/odontogram_screenshot.png`).then(
      (m) => m.default
    ),
  },
  {
    id: '4',
    projectId: '2',
    locale: 'es',
    name: 'Odontograma',
    description:
      'Odontograma completo para guardar tratamientos y mantener el historial de los pacientes. Uno de mis primeros proyectos centrado en la interfaz hecho completamente por mí. Los dientes pueden tener tratamientos que afectan hasta seis zonas y también a más de un diente.',
    appLink: '/es/odontogram',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/odontogram_screenshot.png`).then(
      (m) => m.default
    ),
  },

  // Restaurant Point Of Sale
  {
    id: '5',
    projectId: '3',
    locale: 'en',
    name: 'Restaurant Point Of Sale',
    description:
      'My biggest project so far. Complete POS with support for remote printing over the internet (not only local), WebSocket, fully responsive with an exclusive mobile view for easier use and many more features.',
    appLink: '/en/point-of-sale',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/pos_screenshot.png`).then((m) => m.default),
  },
  {
    id: '6',
    projectId: '3',
    locale: 'es',
    name: 'TPV Hostelería',
    description:
      'Mi proyecto más grande hasta ahora. TPV completo con soporte para impresión remota a través de internet (no solo local), WebSocket, totalmente responsive con una vista exclusiva para móviles para un uso más sencillo y muchas más funcionalidades.',
    appLink: '/es/point-of-sale',
    // @ts-expect-error For some reason the png module does not work so even tho the IDE shows no error, the compiler does
    image: import(`../../../assets/pos_screenshot.png`).then((m) => m.default),
  },
];
