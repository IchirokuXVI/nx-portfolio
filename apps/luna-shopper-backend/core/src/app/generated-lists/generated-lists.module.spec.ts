import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ListsModule } from '../lists/lists.module';
import { ProfileService } from '../profiles/profile.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { ZonesModule } from '../zones/zones.module';
import { GeneratedListBindService } from './generated-list-bind.service';
import { GeneratedListService } from './generated-list.service';
import { GeneratedListsModule } from './generated-lists.module';

/**
 * The wiring, which is the one thing about this module that nothing else here
 * can catch.
 *
 * A missing export is invisible to `nx build` and to every other spec in this
 * folder, because those construct the services by hand and hand them their
 * collaborators directly. It surfaces only when Nest actually resolves the
 * graph, which is to say in a running service, which is to say in CI's
 * integration stack after a green build. That is a slow way to learn that
 * `ListsModule` exports `ListAccessService` and not `LineService`.
 *
 * So this reads the module metadata instead: it needs no database, no broker and
 * no Nest bootstrap, and it fails in the second the export is dropped.
 */
describe('GeneratedListsModule wiring', () => {
  const importsOf = (module: unknown): unknown[] =>
    (Reflect.getMetadata('imports', module as object) as unknown[]) ?? [];
  const exportsOf = (module: unknown): unknown[] =>
    (Reflect.getMetadata('exports', module as object) as unknown[]) ?? [];
  const providersOf = (module: unknown): unknown[] =>
    (Reflect.getMetadata('providers', module as object) as unknown[]) ?? [];

  it('imports the three modules its services are constructed from', () => {
    const imports = importsOf(GeneratedListsModule);
    // ProfilesModule resolves which zones and lists a run draws from, ListsModule
    // is the write back path, and ZonesModule carries the event publisher.
    expect(imports).toContain(ProfilesModule);
    expect(imports).toContain(ListsModule);
    expect(imports).toContain(ZonesModule);
  });

  it('can reach LineService, which the write back goes through', () => {
    // The export this file exists for. Without it a basket line with a target
    // list could not be created through the ordinary add path, and core refuses
    // to start rather than failing at the first write.
    expect(exportsOf(ListsModule)).toContain(LineService);
  });

  it('can reach ListAccessService, which resolves a target list to its zone', () => {
    expect(exportsOf(ListsModule)).toContain(ListAccessService);
  });

  it('can reach ProfileService, which resolves a run to its sources', () => {
    expect(exportsOf(ProfilesModule)).toContain(ProfileService);
  });

  it('provides the bind service, which the sharing controller injects', () => {
    // Plan 0058's two message patterns are declared on a controller that takes
    // this in its constructor, so a missing provider is core refusing to start
    // rather than a route that answers wrongly. That is the right failure and it
    // is still one worth catching in a second rather than in CI's stack.
    expect(providersOf(GeneratedListsModule)).toContain(
      GeneratedListBindService
    );
  });

  it('exports the basket service, which account deletion reaches for', () => {
    // Plan 0011's saga drops a departing account's baskets, and it does that
    // through this service rather than by reaching into the repositories.
    expect(exportsOf(GeneratedListsModule)).toContain(GeneratedListService);
  });
});
