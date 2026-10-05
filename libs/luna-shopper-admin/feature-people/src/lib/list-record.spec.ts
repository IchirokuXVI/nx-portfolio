import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import {
  DIRECTORY_SERVICE,
  type DirectoryServiceI,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  RecordPage,
  ResourceChanges,
  ResourceRegistry,
} from '@portfolio/luna-shopper-admin/feature-resource';
import { compositeId } from '@portfolio/luna-shopper-admin/models';
import { ConfirmDialog } from '@portfolio/luna-shopper-admin/ui';
import { LISTS } from './lists';
import { LIST_SEED, USER_SEED, ZONE_SEED } from './people-seed';
import {
  bootShoppers,
  controlSaying,
  currentUrl,
  find,
  findAll,
  recordingDirectory,
  settle,
  ShoppersTestHost,
  textOf,
} from './shoppers.testing';

/**
 * A list of a zone and one of its lines, on the record page (admin plan
 * 0058).
 *
 * The cases of `people-screens.spec.ts` about a list and its lines are here,
 * over `RecordPage` with `LISTS` and over `ListLinesPanel`. Everything runs
 * against the in-memory gateway, and the section is mounted where the app
 * mounts it, so the links between a list, its zone, its lines and the person
 * who made it are the real ones.
 *
 * Assertions are on keys and not on sentences wherever a string is
 * interpolated: the testing translator does not interpolate.
 */

const [ROSA] = USER_SEED;
const [KITCHEN] = ZONE_SEED;
const [WEEKLY] = LIST_SEED;

const PEOPLE = '/shoppers/people';
const ZONES = '/shoppers/zones';

const address = `${ZONES}/${KITCHEN.id}/lists/${WEEKLY.id}`;

const withDirectory = (directory: DirectoryServiceI) => [
  { provide: DIRECTORY_SERVICE, useValue: directory },
];

type Fixture = ComponentFixture<ShoppersTestHost>;

const recordPage = (fixture: Fixture): RecordPage =>
  fixture.debugElement.query(By.directive(RecordPage)).componentInstance;

const lineRow = (fixture: Fixture, id: string) =>
  find(fixture, `lib-list-lines-panel [data-line="${id}"]`) as HTMLElement;

const pending = WEEKLY.lines.find((line) => line.approvalStatus === 'PENDING');

/** The titles of the sections of the page, in the order they are drawn. */
const sectionHeadings = (fixture: Fixture) =>
  findAll(fixture, 'lib-record-page lib-record-section h2').map((heading) =>
    heading.textContent?.trim()
  );

/**
 * Open the app somewhere else, change the list in the in-memory table, and
 * then go to the list. So a case can read a row the fixture does not hold.
 */
async function bootWith(change: Record<string, unknown>): Promise<Fixture> {
  const fixture = await bootShoppers(PEOPLE);
  await TestBed.inject(ResourceRegistry)
    .gatewayFor(LISTS)
    .update(WEEKLY.id, change);

  await TestBed.inject(Router).navigateByUrl(address);
  await settle(fixture);
  await settle(fixture);
  return fixture;
}

describe('a list of a zone', () => {
  /**
   * A list is read by its own id. So an address that names another zone goes
   * to the list's own address, and never draws the list under that zone. The
   * record page does this for any record under a parent (admin plan 0056).
   */
  it('goes to the list own zone when the address names another one', async () => {
    const other = ZONE_SEED.find((zone) => zone.id !== KITCHEN.id);
    expect(other).toBeDefined();

    const fixture = await bootShoppers(
      `${ZONES}/${other?.id}/lists/${WEEKLY.id}`
    );
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(address);
  });

  it('is the record page, with one section and the lines as a panel', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, 'lib-record-page .page-title')?.textContent).toBe(
      'Weekly shop'
    );
    // One section, then the panel, then the Record block. No field is left
    // over for a section of its own.
    expect(sectionHeadings(fixture)).toEqual([
      'people.lists.section.list',
      'people.lists.record.lines',
      'record.facts.heading',
    ]);
    expect(
      findAll(fixture, 'lib-record-view .sections lib-field-row').length
    ).toBe(3);
    expect(textOf(fixture)).toContain('people.lists.autoApproveLines');
    expect(textOf(fixture)).toContain('people.lists.sharedWithZone');
    // It reads first.
    expect(find(fixture, 'lib-field-control')).toBeNull();
    expect(recordPage(fixture).store().mode()).toBe('read');
  });

  it('goes back to the Lists tab of its zone', async () => {
    const fixture = await bootShoppers(address);

    expect(
      find(fixture, 'lib-record-page .page-back')?.getAttribute('href')
    ).toBe(`${ZONES}/${KITCHEN.id}/lists`);
  });

  it('says who adds a line behind the info button', async () => {
    const fixture = await bootShoppers(address);

    expect(textOf(fixture)).not.toContain('people.lists.info.adds');

    find<HTMLButtonElement>(
      fixture,
      'lib-record-page lib-info-button button'
    )?.click();
    fixture.detectChanges();

    expect(textOf(fixture)).toContain('people.lists.info.corrects');
    expect(textOf(fixture)).toContain('people.lists.info.adds');
  });
});

describe('the Record block of a list', () => {
  it('says who made it, by name, as a link to the person', async () => {
    const fixture = await bootShoppers(address);
    await settle(fixture);

    const by = find(fixture, 'lib-record-view [data-fact="added"] [data-by]');
    expect(by?.textContent).toContain('record.facts.by');

    const link = by?.querySelector('a');
    expect(link?.textContent?.trim()).toBe('rosa');
    expect(link?.getAttribute('href')).toBe(`${PEOPLE}/${ROSA.userId}`);
    // By name, and never by the ID.
    expect(by?.textContent).not.toContain(WEEKLY.createdByUserId);
  });

  it('says when it last changed, the zone it is in, and its ID', async () => {
    const fixture = await bootShoppers(address);

    expect(find(fixture, '[data-fact="changed"]')).not.toBeNull();
    expect(find(fixture, '[data-fact="zoneName"]')?.textContent).toContain(
      'Kitchen'
    );
    expect(find(fixture, '[data-fact="id"]')?.textContent).toContain(WEEKLY.id);
  });

  /** The line is drawn from the row, and never guessed. */
  it('draws no "by" for a row that carries nobody', async () => {
    const fixture = await bootWith({ createdByUserId: null });

    expect(find(fixture, '[data-fact="added"]')).not.toBeNull();
    expect(find(fixture, '[data-fact="added"] [data-by]')).toBeNull();
  });

  /** A person whose account is gone is never drawn as a bare ID. */
  it('says so when the person is gone, and draws no ID', async () => {
    const gone = '99999999-9999-4999-8999-999999999999';
    const fixture = await bootWith({ createdByUserId: gone });
    await settle(fixture);

    const by = find(fixture, '[data-fact="added"] [data-by]');
    expect(by?.textContent).toContain('record.value.gone');
    expect(by?.textContent).not.toContain(gone);
    expect(by?.querySelector('a')).toBeNull();
  });
});

describe('a list as a form', () => {
  it('turns into a form on Edit, with two switches and the one caution', async () => {
    const fixture = await bootShoppers(address);

    // A caution is read before the action, and reading acts on nothing.
    expect(find(fixture, '[data-caution]')).toBeNull();

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);

    expect(currentUrl()).toBe(address);
    expect(recordPage(fixture).store().mode()).toBe('edit');
    expect(find(fixture, '[data-caution]')?.textContent).toContain(
      'people.zoneCaution'
    );
    expect(findAll(fixture, 'lib-record-view lib-switch')).toHaveLength(2);
    // The lines are no part of the form, and stay where they are.
    expect(find(fixture, 'lib-list-lines-panel [data-lines]')).not.toBeNull();
  });

  /** A switch changes with Save, and never by the press alone. */
  it('writes a switch only on Save', async () => {
    const fixture = await bootShoppers(address);
    const gateway = TestBed.inject(ResourceRegistry).gatewayFor(LISTS);

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);

    const [, shared] = findAll<HTMLButtonElement>(
      fixture,
      'lib-record-view lib-switch button'
    );
    shared.click();
    await settle(fixture);

    expect(recordPage(fixture).store().bar()).toEqual({
      kind: 'dirty',
      changes: 1,
    });
    expect((await gateway.read(WEEKLY.id))['sharedWithZone']).toBe(true);

    find<HTMLButtonElement>(fixture, 'lib-save-bar [data-save]')?.click();
    await settle(fixture);
    await settle(fixture);

    expect((await gateway.read(WEEKLY.id))['sharedWithZone']).toBe(false);
    expect(recordPage(fixture).store().mode()).toBe('read');
  });

  /**
   * The lines are no part of the form. An answer given while the page is a
   * form still shows in the panel, and the form keeps what was typed.
   */
  it('answers a line while the page is a form, and keeps the form', async () => {
    const fixture = await bootShoppers(address);

    find<HTMLButtonElement>(fixture, '[data-edit]')?.click();
    await settle(fixture);
    const [, shared] = findAll<HTMLButtonElement>(
      fixture,
      'lib-record-view lib-switch button'
    );
    shared.click();
    await settle(fixture);

    lineRow(fixture, pending?.id ?? '')
      .querySelector<HTMLButtonElement>('[data-action="approve-line"]')
      ?.click();
    await settle(fixture);
    controlSaying(fixture, 'people.lines.confirm.approve.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(lineRow(fixture, pending?.id ?? '').classList).not.toContain(
      'waiting'
    );
    expect(recordPage(fixture).store().mode()).toBe('edit');
    expect(recordPage(fixture).store().bar()).toEqual({
      kind: 'dirty',
      changes: 1,
    });
  });

  /** The old address of the form, which links out in the world still name. */
  it('leads the old address of the form to the list as a form', async () => {
    const fixture = await bootShoppers(`${address}/edit`);
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(address);
    expect(recordPage(fixture).store().mode()).toBe('edit');
  });
});

describe('deleting a list', () => {
  it('is in the More menu, asks by name, and then goes to the lists of the zone', async () => {
    const fixture = await bootShoppers(address);
    const changes = TestBed.inject(ResourceChanges);
    const zones = changes.version('zones');

    const entry = find<HTMLButtonElement>(
      fixture,
      'lib-record-page lib-page-header [pageMoreDanger][data-delete]'
    );
    expect(entry).not.toBeNull();

    entry?.click();
    await settle(fixture);

    const question = fixture.debugElement.query(By.directive(ConfirmDialog))
      .componentInstance as ConfirmDialog;
    expect(question.headingKey()).toBe('record.delete.heading');
    expect(question.headingArgs()).toMatchObject({ name: 'Weekly shop' });
    // Nothing is deleted before the yes.
    expect(currentUrl()).toBe(address);

    find<HTMLButtonElement>(
      fixture,
      '[data-delete-question] [data-confirm]'
    )?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(`${ZONES}/${KITCHEN.id}/lists`);
    expect(textOf(fixture)).not.toContain('Weekly shop');
    // The zone counts its lists, so whoever shows the zones reads again.
    expect(changes.version('zones')).toBeGreaterThan(zones);
  });

  it('leaves the list alone when the question is dismissed', async () => {
    const fixture = await bootShoppers(address);

    find<HTMLButtonElement>(fixture, 'lib-record-page [data-delete]')?.click();
    await settle(fixture);
    find<HTMLButtonElement>(
      fixture,
      '[data-delete-question] [data-dismiss]'
    )?.click();
    await settle(fixture);

    expect(currentUrl()).toBe(address);
    expect(find(fixture, '[data-delete-question]')).toBeNull();
  });
});

describe('the Lines panel of a list', () => {
  // The fixture is what makes the specs below mean anything.
  it('has a line that waits in the fixture', () => {
    expect(pending).toBeDefined();
  });

  it('is the one place that shows what a household wrote down', async () => {
    const fixture = await bootShoppers(address);
    const panel = find(fixture, 'lib-list-lines-panel');

    expect(panel?.textContent).toContain('Milk, two litres');
    expect(panel?.textContent).toContain('people.lists.approval.PENDING');
    expect(findAll(fixture, 'lib-list-lines-panel [data-line]')).toHaveLength(
      WEEKLY.lines.length
    );
    // The count the list holds, beside the heading and in no section.
    expect(panel?.querySelector('[data-count]')?.textContent).toBe(
      String(WEEKLY.lineCount)
    );
    expect(
      find(fixture, 'lib-record-view .sections lib-field-row')?.textContent
    ).not.toContain('people.lists.lineCount');
  });

  it('puts a line that waits on the waiting wash, with both answers', async () => {
    const fixture = await bootShoppers(address);
    const row = lineRow(fixture, pending?.id ?? '');

    expect(row.classList).toContain('waiting');
    expect(
      [...row.querySelectorAll('[data-action]')].map((button) =>
        button.getAttribute('data-action')
      )
    ).toEqual(['approve-line', 'reject-line']);
  });

  /** "Approve" and "Reject" are on a line that waits, and on no other. */
  it('offers neither answer on a line that was answered', async () => {
    const fixture = await bootShoppers(address);
    const answered = WEEKLY.lines.filter(
      (line) => line.approvalStatus !== 'PENDING'
    );

    expect(answered.length).toBeGreaterThan(0);
    for (const line of answered) {
      const row = lineRow(fixture, line.id);

      expect(row.classList).not.toContain('waiting');
      expect([...row.querySelectorAll('[data-action]')]).toEqual([]);
      // What every line has is still there.
      expect(row.querySelector('[data-delete-line]')).not.toBeNull();
    }
  });

  /** The state changes in the panel, and the page is not left. */
  it('approves a line once confirmed, and the panel then says so', async () => {
    const fixture = await bootShoppers(address);

    lineRow(fixture, pending?.id ?? '')
      .querySelector<HTMLButtonElement>('[data-action="approve-line"]')
      ?.click();
    await settle(fixture);
    // Nothing changed before the yes.
    expect(lineRow(fixture, pending?.id ?? '').classList).toContain('waiting');

    controlSaying(fixture, 'people.lines.confirm.approve.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    const row = lineRow(fixture, pending?.id ?? '');
    expect(currentUrl()).toBe(address);
    expect(row.classList).not.toContain('waiting');
    expect(row.textContent).toContain('people.lists.approval.APPROVED');
    expect(row.querySelector('[data-action]')).toBeNull();
    expect(find(fixture, 'lib-confirm-dialog')).toBeNull();
  });

  it('rejects a line through the service, once confirmed', async () => {
    const { calls, directory } = recordingDirectory();
    const fixture = await bootShoppers(address, withDirectory(directory));

    lineRow(fixture, pending?.id ?? '')
      .querySelector<HTMLButtonElement>('[data-action="reject-line"]')
      ?.click();
    await settle(fixture);
    expect(calls).toEqual([]);

    controlSaying(fixture, 'people.lines.confirm.reject.confirm')?.click();
    await settle(fixture);

    expect(calls).toEqual([`line:${WEEKLY.id}:${pending?.id}:REJECTED`]);
  });

  it('offers delete on every line, and no way to add one', async () => {
    const fixture = await bootShoppers(address);

    expect(findAll(fixture, '[data-delete-line]')).toHaveLength(
      WEEKLY.lines.length
    );
    expect(controlSaying(fixture, 'resource.action.create')).toBeUndefined();
  });

  it('deletes a line once confirmed', async () => {
    const fixture = await bootShoppers(address);
    const [first] = WEEKLY.lines;
    const lines = TestBed.inject(ResourceRegistry).byName('list-lines');
    expect(lines).toBeDefined();

    lineRow(fixture, first.id)
      .querySelector<HTMLButtonElement>('[data-delete-line]')
      ?.click();
    await settle(fixture);
    expect(textOf(fixture)).toContain('resource.confirm.delete.heading');

    controlSaying(fixture, 'resource.confirm.delete.confirm')?.click();
    await settle(fixture);
    await settle(fixture);

    expect(find(fixture, 'lib-confirm-dialog')).toBeNull();
    expect(currentUrl()).toBe(address);
    // The line is gone from its own table.
    if (lines !== undefined) {
      await expect(
        TestBed.inject(ResourceRegistry)
          .gatewayFor(lines)
          .read(compositeId([WEEKLY.id, first.id]))
      ).rejects.toBeDefined();
    }
  });

  /**
   * A press on a line opens its record, which reads first. So the link says
   * no `?edit=1`: nothing on it says "Edit".
   */
  it('opens a line to be read, and that page goes back to the list', async () => {
    const fixture = await bootShoppers(address);
    const [first] = WEEKLY.lines;
    const line = `${address}/lines/${compositeId([WEEKLY.id, first.id])}`;

    const link = lineRow(fixture, first.id).querySelector<HTMLAnchorElement>(
      '[data-open-line]'
    );
    expect(link?.getAttribute('href')).toBe(line);

    link?.click();
    await settle(fixture);
    await settle(fixture);

    expect(currentUrl()).toBe(line);
    expect(find(fixture, 'lib-record-view')).not.toBeNull();
    expect(find(fixture, 'lib-field-control')).toBeNull();

    find<HTMLAnchorElement>(fixture, 'lib-record-page .page-back')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(currentUrl()).toBe(address);
  });
});

describe('the record of one line', () => {
  const [first] = WEEKLY.lines;
  const line = `${address}/lines/${compositeId([WEEKLY.id, first.id])}`;

  it('draws one section, and says who added the line', async () => {
    const fixture = await bootShoppers(line);
    await settle(fixture);

    expect(sectionHeadings(fixture)).toEqual([
      'people.lines.section.line',
      'record.facts.heading',
    ]);

    const by = find(fixture, '[data-fact="added"] [data-by]');
    expect(by?.querySelector('a')?.textContent?.trim()).toBe('rosa');
    expect(by?.querySelector('a')?.getAttribute('href')).toBe(
      `${PEOPLE}/${first.createdByUserId}`
    );
    expect(find(fixture, '[data-fact="changed"]')).not.toBeNull();
    expect(find(fixture, '[data-fact="listName"]')?.textContent).toContain(
      'Weekly shop'
    );
  });
});
