import { News } from './news';

/**
 * Structural news data, standing in for a future server-backed endpoint. The
 * localized text lives in {@link ./static-news-translation-data} and is joined
 * in by {@link ../news-memory}, mirroring the landing project data-access.
 */
export const NEWS: readonly News[] = [
  {
    id: '1',
    icon: 'calendar',
  },
  {
    id: '2',
    icon: 'home',
  },
];
