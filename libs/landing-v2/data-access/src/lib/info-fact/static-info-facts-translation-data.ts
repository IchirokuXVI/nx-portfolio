import { InfoFactTranslation } from '@portfolio/landing-v2/models';

/**
 * Per-locale hero facts (approved copy — D-hero-copy). `en` is the
 * default/fallback locale (see {@link ./info-facts-memory}).
 */
export const INFO_FACTS_TRANSLATIONS: readonly InfoFactTranslation[] = [
  // FOCUS
  {
    id: '1',
    factId: '1',
    locale: 'en',
    label: 'FOCUS',
    value: 'Web apps & automation',
  },
  {
    id: '2',
    factId: '1',
    locale: 'es',
    label: 'ENFOQUE',
    value: 'Apps web y automatización',
  },

  // STACK
  {
    id: '3',
    factId: '2',
    locale: 'en',
    label: 'STACK',
    value: 'Angular · Nx · TypeScript',
  },
  {
    id: '4',
    factId: '2',
    locale: 'es',
    label: 'STACK',
    value: 'Angular · Nx · TypeScript',
  },

  // ALSO
  {
    id: '5',
    factId: '3',
    locale: 'en',
    label: 'ALSO',
    value: 'Docker · k8s · CI/CD',
  },
  {
    id: '6',
    factId: '3',
    locale: 'es',
    label: 'TAMBIÉN',
    value: 'Docker · k8s · CI/CD',
  },

  // BASED
  {
    id: '7',
    factId: '4',
    locale: 'en',
    label: 'BASED',
    value: 'Spain',
    note: 'Working remotely',
  },
  {
    id: '8',
    factId: '4',
    locale: 'es',
    label: 'UBICACIÓN',
    value: 'España',
    note: 'En remoto',
  },
];
