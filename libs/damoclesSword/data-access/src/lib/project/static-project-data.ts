import { AssetKey } from '../asset/asset';
import { ProjectAddonKind, ProjectAddonPosition, ProjectKind } from './project';

/**
 * Addon as authored in the static data: it names an asset by key. The service
 * resolves the key to a URL when building the public {@link ./project#Project}.
 */
interface StaticProjectAddon {
  kind: ProjectAddonKind;
  position: ProjectAddonPosition;
  asset: AssetKey;
  alt?: string;
}

export interface StaticProject {
  id: string;
  kind: ProjectKind;
  label: string;
  addons?: StaticProjectAddon[];
}

/**
 * Structural project data. The localized descriptions live in
 * {@link ./static-project-translation-data} and are joined in by
 * {@link ./project-memory}, the same way {@link ../news/static-news-data} is
 * joined with its translations. Projects will never be served from the backend,
 * so this is the permanent source rather than a mock.
 */
export const PROJECTS: readonly StaticProject[] = [
  {
    id: '1',
    kind: 'client-project',
    label: 'VR Sickness Reducer',
    addons: [
      {
        kind: 'video',
        position: 'right',
        asset: 'vr-sickness-reducer-demo',
      },
    ],
  },
  {
    id: '2',
    kind: 'client-project',
    label: 'Realistic Interactor',
    addons: [
      {
        kind: 'video',
        position: 'right',
        asset: 'realistic-interactor-demo',
      },
    ],
  },
  {
    id: '3',
    kind: 'game',
    label: 'STARLIT: ASCENSION',
    addons: [
      {
        kind: 'video',
        position: 'right',
        asset: 'starlit-ascension-trailer',
      },
      {
        kind: 'image',
        position: 'top-right',
        asset: 'starlit-logo',
      },
    ],
  },
];
