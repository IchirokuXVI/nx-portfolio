import { BasketDemandService } from '../baskets/basket-demand.service';
import { BasketLineAddService } from '../baskets/basket-line-add.service';
import { BasketLiveService } from '../baskets/basket-live.service';
import { BasketReadService } from '../baskets/basket-read.service';
import { BasketRevertService } from '../baskets/basket-revert.service';
import { BasketRowRenameService } from '../baskets/basket-row-rename.service';
import { BasketRowResolver } from '../baskets/basket-row-resolver';
import { BasketSettleService } from '../baskets/basket-settle.service';
import { BasketWriteContext } from '../baskets/basket-write.context';
import { LineService } from '../lists/line.service';
import { ListAccessService } from '../lists/list-access.service';
import { ListsModule } from '../lists/lists.module';
import { ProfileService } from '../profiles/profile.service';
import { ProfilesModule } from '../profiles/profiles.module';
import { ZonesModule } from '../zones/zones.module';
import { GeneratedListSweepService } from './generated-list-sweep.service';
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

  it('can reach LineService, which every basket write goes through', () => {
    // The export this file exists for. Since plan 0136 a basket writes no row
    // of its own: the add, the demand and the rename all act on a list line
    // through this service, so without the export core refuses to start rather
    // than failing at the first write.
    expect(exportsOf(ListsModule)).toContain(LineService);
  });

  it('can reach ListAccessService, which resolves a covered list to its zone', () => {
    expect(exportsOf(ListsModule)).toContain(ListAccessService);
  });

  it('can reach ProfileService, which resolves a run to its sources', () => {
    expect(exportsOf(ProfilesModule)).toContain(ProfileService);
  });

  it('provides the read and the five writes on a row', () => {
    // Plan 0136, section 10. The waiting settlements, the origins, the split,
    // the outstanding, the stored basket line and its rename went with the
    // three tables, and what stands in their place is a read of `list_lines`
    // and five writes on a row of it. They live in `baskets/` and are declared
    // here on purpose (the module's own comment says why), so this is the one
    // spec that can see the move.
    const providers = providersOf(GeneratedListsModule);
    expect(providers).toContain(BasketReadService);
    expect(providers).toContain(BasketLiveService);
    expect(providers).toContain(BasketRowResolver);
    expect(providers).toContain(BasketWriteContext);
    expect(providers).toContain(BasketSettleService);
    expect(providers).toContain(BasketRevertService);
    expect(providers).toContain(BasketDemandService);
    expect(providers).toContain(BasketLineAddService);
    expect(providers).toContain(BasketRowRenameService);
  });

  it('exports the basket read, which the history and the back office count through', () => {
    // Plan 0136, section 7.4 and 7.5: an open basket has no stored rows to
    // count, so both callers compose them. An export rather than a second
    // definition of a basket row in SQL, which would be free to disagree with
    // the screen.
    expect(exportsOf(GeneratedListsModule)).toContain(BasketReadService);
  });

  it('provides the sweep, which nothing injects and Nest alone would start', () => {
    // Plan 0059's backstop has no caller: it is a timer that Nest starts on
    // bootstrap, so a missing provider is not a failed injection anywhere but a
    // sweep that silently never runs and baskets that stay live for ever.
    expect(providersOf(GeneratedListsModule)).toContain(
      GeneratedListSweepService
    );
  });

  it('exports the basket service, which account deletion reaches for', () => {
    // Plan 0011's saga drops a departing account's baskets, and it does that
    // through this service rather than by reaching into the repositories.
    expect(exportsOf(GeneratedListsModule)).toContain(GeneratedListService);
  });
});
