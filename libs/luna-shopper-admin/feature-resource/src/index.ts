// Named, and not `export *`: this barrel offers what another project imports,
// and nothing else (admin plan 0047). A name used only inside this library is
// imported there by its relative path. `no-unused-public-export.spec.ts`
// in the app fails when a name here has no importer outside the library.
export {
  provideResources,
  provideSections,
  sectionLink,
  sectionScreens,
  type AdminSection,
  type SectionCounts,
} from './lib/admin-section';
export { gatewayErrorKey } from './lib/gateway-error-key';
export { ResourceChanges } from './lib/resource-changes';
export { ResourceFormPage } from './lib/resource-form-page';
export { ResourceListPage } from './lib/resource-list-page';
export { ResourceReferences, ResourceRegistry } from './lib/resource-registry';
export {
  RESOURCE_DESCRIPTOR,
  RESOURCE_FORM_MODE,
  RESOURCE_ID_FROM,
  RESOURCE_ID_PARAM,
  RESOURCE_LIST_EMBED,
  routeParam,
} from './lib/resource-route-data';
export {
  adminRoutes,
  resourceCreateRoute,
  resourceFormBranch,
  resourceRoutes,
  resourceSplitRoute,
  resourceTabRoute,
} from './lib/routes';
