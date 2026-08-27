import type { Provider } from '@angular/core';
import { AssetMemory } from './asset/asset-memory';
import { ContactMock } from './contact/contact-mock';
import { NewsMemory } from './news/news-memory';
import { ProjectMemory } from './project/project-memory';

/**
 * The `data-access` services the app layer has to install.
 *
 * All four were `providedIn: 'root'`, and under the shell that root is the
 * *portfolio's* injector, one level above everything damoclesSword provides. It
 * worked only because none of them reaches an app scoped value: every one is an
 * in-memory or mock implementation with no configuration to find. That is an accident
 * rather than a design, and it is the same accident velista hit the moment it gained a
 * backend (rule D5).
 */
export const DAMOCLES_DATA_ACCESS_PROVIDERS: Provider[] = [
  AssetMemory,
  ContactMock,
  NewsMemory,
  ProjectMemory,
];
