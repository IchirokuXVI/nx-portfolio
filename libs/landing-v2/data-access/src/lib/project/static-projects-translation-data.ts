import { ProjectTranslation } from '@portfolio/landing-v2/models';

/**
 * Per-locale project copy, already translated, mirroring
 * {@link ../../../../damoclesSword/data-access/src/lib/project/static-project-translation-data}.
 * `en` is the default/fallback locale (see {@link ./project-memory}).
 */
export const PROJECTS_TRANSLATIONS: readonly ProjectTranslation[] = [
  // Portfolio
  {
    id: '1',
    projectId: '1',
    locale: 'en',
    tagline: 'This site: an Nx module-federation monorepo',
    description:
      'My personal portfolio website built with NX and different technologies, primarily Angular 21. It is a very complete project with module federation, translation, testing and CI/CD. I tried to follow best practices for everything to improve my overall skills and learn new things.',
  },
  {
    id: '2',
    projectId: '1',
    locale: 'es',
    tagline: 'Este sitio: un monorepo Nx con module federation',
    description:
      'Mi sitio portafolio web construido con NX y diferentes tecnologías, principalmente Angular 21. Es un proyecto muy completo con federación de módulos, traducción, pruebas y CI/CD. Intenté seguir las mejores prácticas en todo lo posible para aprender y mejorar durante el desarrollo.',
  },

  // Damocle'Sword
  {
    id: '3',
    projectId: '2',
    locale: 'en',
    tagline: 'VR game studio business site',
    description:
      "A marketing site for Damocle'Sword, a VR game studio, built as an Angular micro-frontend. Home, About, Services and Contact pages share a translated (EN/ES/FR) component system with a reactive contact form and a data-access layer for news and projects, including their VR titles such as STARLIT: ASCENSION.",
  },
  {
    id: '4',
    projectId: '2',
    locale: 'es',
    tagline: 'Web empresarial para un estudio de videojuegos VR',
    description:
      "Un sitio de marketing para Damocle'Sword, un estudio de videojuegos VR, construido como micro-frontend de Angular. Las páginas de Inicio, Nosotros, Servicios y Contacto comparten un sistema de componentes traducido (EN/ES/FR) con un formulario de contacto reactivo y una capa de datos para noticias y proyectos, incluidos sus títulos VR como STARLIT: ASCENSION.",
  },

  // Odontogram
  {
    id: '5',
    projectId: '3',
    locale: 'en',
    tagline: 'Dental chart with per-zone treatments & patient history',
    description:
      'Full odontogram to save treatments and keep the history of patients. One of my first UI projects made solely by me. Teeth can have treatments that affect up to six zones and also more than one tooth.',
  },
  {
    id: '6',
    projectId: '3',
    locale: 'es',
    tagline: 'Odontograma con tratamientos por zonas e historial de pacientes',
    description:
      'Odontograma completo para guardar tratamientos y mantener el historial de los pacientes. Uno de mis primeros proyectos centrado en la interfaz hecho completamente por mí. Los dientes pueden tener tratamientos que afectan hasta seis zonas y también a más de un diente.',
  },

  // Restaurant Point Of Sale
  {
    id: '7',
    projectId: '4',
    locale: 'en',
    tagline: 'Full restaurant POS with remote printing & live sync',
    description:
      'My biggest project so far. Complete POS with support for remote printing over the internet (not only local), WebSocket, fully responsive with an exclusive mobile view for easier use and many more features.',
  },
  {
    id: '8',
    projectId: '4',
    locale: 'es',
    tagline: 'TPV de hostelería con impresión remota y sincronización en vivo',
    description:
      'Mi proyecto más grande hasta ahora. TPV completo con soporte para impresión remota a través de internet (no solo local), WebSocket, totalmente responsive con una vista exclusiva para móviles para un uso más sencillo y muchas más funcionalidades.',
  },
];
