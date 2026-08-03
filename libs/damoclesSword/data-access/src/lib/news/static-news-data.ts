import { AssetKey } from '../asset/asset';
import { NewsIcon } from './news';

/**
 * News as authored in the static data: it names its image by asset key. The
 * service resolves the key to a URL when building the public
 * {@link ./news#News} (mirroring how {@link ../project/static-project-data}
 * names project media).
 */
export interface StaticNews {
  id: string;
  icon?: NewsIcon;
  imageAsset?: AssetKey;
}

/**
 * Structural news data, standing in for a future server-backed endpoint. The
 * localized text lives in {@link ./static-news-translation-data} and is joined
 * in by {@link ./news-memory}, mirroring the landing project data-access.
 */
export const NEWS: readonly StaticNews[] = [
  {
    id: '1',
    icon: 'calendar',
    imageAsset: 'news-test-starlit',
  },
  {
    id: '2',
    icon: 'home',
    imageAsset: 'news-win-game-jam',
  },
];
