import { provideLocationMocks } from '@angular/common/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  DEPLOYMENT_SERVICE,
  DeploymentStore,
  GatewayError,
  HARVEST_SERVICE,
  HarvestMemory,
  ServerReachability,
} from '@portfolio/luna-shopper-admin/data-access';
import { ResourceReferences } from '@portfolio/luna-shopper-admin/feature-resource';
import { ADMIN_API_CONFIG } from '@portfolio/luna-shopper-admin/models';
import {
  DECISIONS_MAX_OPERATIONS,
  isDecisionsFile,
  parseDecisionsFile,
} from './decisions-file';
import { DecisionsFilePanel } from './decisions-file-panel';
import { EntriesQueuePage } from './entries-queue-page';

/**
 * Applying a curation decisions file from the entries queue (admin plan 0035,
 * section 3).
 *
 * The panel runs against the in memory harvester, which checks every operation
 * before it writes anything, the way the route does. So an applied file really
 * binds the rows, and a refused one really leaves them where they were.
 */

const NOW = '2026-09-03T10:00:00.000Z';
const GATEWAY = 'http://localhost:3000';

/** A decisions file, as the curation CLI writes it. */
function jsonl(...lines: unknown[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n') + '\n';
}

const HEADER = {
  header: true,
  runId: 'run-2026-09-20',
  mainUrl: GATEWAY,
  rehearsalUrl: 'http://localhost:43000',
  model: 'sonnet',
  startedAt: '2026-09-20T09:00:00.000Z',
};

const CREATE_MILK = {
  entryId: 'entry-milk',
  entryName: 'Leche entera',
  supermarketId: 'm',
  expect: { status: 'UNRESOLVED', lastSeenAt: NOW },
  decision: 'CREATE',
  proposedDecision: null,
  itemId: null,
  itemRef: null,
  item: {
    nameEs: 'Leche entera 1 L',
    nameEn: 'Whole milk 1 L',
    brand: 'Hacendado',
    ean: '8480000123456',
    unitSize: 1,
    category: 'DAIRY',
    defaultUnit: 'LITER',
  },
  ref: 'new-1',
  confidence: 0.9,
  issues: [],
  reasoning: 'A new product.',
};

const LINK_BREAD = {
  entryId: 'entry-bread',
  entryName: 'Pan de molde',
  expect: { status: 'CANDIDATE', lastSeenAt: NOW },
  decision: 'LINK',
  itemId: 'it_bread',
  itemRef: null,
  item: null,
  ref: null,
};

const LINK_LEAFLET_TO_NEW = {
  entryId: 'entry-leche-leaflet',
  entryName: 'LECHE ENTERA',
  expect: { status: 'CANDIDATE', lastSeenAt: '2026-09-03T07:20:05.000Z' },
  decision: 'LINK',
  itemId: null,
  itemRef: 'new-1',
  item: null,
  ref: null,
};

const REVIEW_ACEITE = {
  entryId: 'entry-aceite',
  entryName: 'Aceite',
  expect: { status: 'UNRESOLVED', lastSeenAt: '2026-09-03T07:20:05.000Z' },
  decision: 'REVIEW',
};

/** A decided row that is not pending any more, which refuses the file. */
const LINK_REJECTED = {
  entryId: 'entry-lote',
  entryName: 'Lote',
  expect: { status: 'UNRESOLVED', lastSeenAt: NOW },
  decision: 'LINK',
  itemId: 'it_x',
  itemRef: null,
  item: null,
  ref: null,
};

/** A file input's change event holding one file. */
function chosen(text: string): Event {
  return {
    target: { files: [{ text: async () => text }] },
  } as unknown as Event;
}

const drain = async () => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

async function renderPanel(gateway = GATEWAY) {
  const memory = new HarvestMemory();
  const apply = jest.spyOn(memory, 'applyEntryDecisions');

  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [DecisionsFilePanel, RokuTranslatorTestingModule.forTesting()],
    providers: [
      { provide: HARVEST_SERVICE, useValue: memory },
      { provide: ADMIN_API_CONFIG, useValue: { gatewayBaseUrl: gateway } },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(DecisionsFilePanel);
  fixture.detectChanges();
  return { fixture, memory, apply, panel: fixture.componentInstance };
}

async function choose(
  fixture: ComponentFixture<DecisionsFilePanel>,
  text: string
) {
  await fixture.componentInstance.chooseFile(chosen(text));
  fixture.detectChanges();
}

async function press(
  fixture: ComponentFixture<unknown>,
  selector: string
): Promise<void> {
  const button = fixture.nativeElement.querySelector(
    selector
  ) as HTMLButtonElement | null;
  expect(button).not.toBeNull();
  button?.click();
  await drain();
  fixture.detectChanges();
}

const q = (fixture: ComponentFixture<unknown>, selector: string) =>
  fixture.nativeElement.querySelector(selector) as HTMLElement | null;

async function entryStatus(memory: HarvestMemory, id: string) {
  const page = await memory.listEntries({ limit: 100, status: undefined });
  const found = page.items.find((entry) => entry.id === id);
  if (found !== undefined) {
    return found.status;
  }
  for (const status of ['ACTIVE', 'REJECTED'] as const) {
    const other = await memory.listEntries({ limit: 100, status });
    const hit = other.items.find((entry) => entry.id === id);
    if (hit !== undefined) {
      return hit.status;
    }
  }
  return null;
}

describe('parseDecisionsFile', () => {
  it('builds the request the CLI builds, and sends nothing for a REVIEW', () => {
    const read = parseDecisionsFile(
      jsonl(HEADER, CREATE_MILK, LINK_BREAD, LINK_LEAFLET_TO_NEW, REVIEW_ACEITE)
    );
    if (!isDecisionsFile(read)) {
      throw new Error('expected a file');
    }

    expect(read.header).toEqual({
      runId: 'run-2026-09-20',
      mainUrl: GATEWAY,
      startedAt: '2026-09-20T09:00:00.000Z',
    });
    expect(read.reviews).toBe(1);
    expect(read.request).toEqual({
      runId: 'run-2026-09-20',
      operations: [
        {
          op: 'createItem',
          entryId: 'entry-milk',
          ref: 'new-1',
          item: {
            name: { es: 'Leche entera 1 L', en: 'Whole milk 1 L' },
            brand: 'Hacendado',
            ean: '8480000123456',
            unitSize: 1,
            category: 'DAIRY',
            defaultUnit: 'LITER',
          },
          expect: { status: 'UNRESOLVED', lastSeenAt: NOW },
        },
        {
          op: 'accept',
          entryId: 'entry-bread',
          itemId: 'it_bread',
          expect: { status: 'CANDIDATE', lastSeenAt: NOW },
        },
        {
          op: 'accept',
          entryId: 'entry-leche-leaflet',
          itemRef: 'new-1',
          expect: {
            status: 'CANDIDATE',
            lastSeenAt: '2026-09-03T07:20:05.000Z',
          },
        },
      ],
    });
    expect(read.rows.map((row) => [row.kind, row.target])).toEqual([
      ['createItem', 'new-1'],
      ['accept', 'it_bread'],
      ['accept', 'new-1'],
    ]);
  });

  it('names the line that is not JSON', () => {
    expect(parseDecisionsFile(`${JSON.stringify(HEADER)}\n{oops\n`)).toEqual({
      kind: 'notJson',
      line: 2,
    });
  });

  it('refuses a file with no header, and an empty one', () => {
    expect(parseDecisionsFile(jsonl(LINK_BREAD))).toEqual({
      kind: 'noHeader',
    });
    expect(parseDecisionsFile('\n\n')).toEqual({ kind: 'empty' });
  });

  it('refuses a file over the cap rather than splitting it', () => {
    const many = Array.from(
      { length: DECISIONS_MAX_OPERATIONS + 1 },
      (_, index) => ({ ...LINK_BREAD, entryId: `e-${index}` })
    );
    expect(parseDecisionsFile(jsonl(HEADER, ...many))).toEqual({
      kind: 'tooMany',
      count: DECISIONS_MAX_OPERATIONS + 1,
    });
  });
});

describe('DecisionsFilePanel', () => {
  it('draws every operation and sends nothing when a file is chosen', async () => {
    const { fixture, apply } = await renderPanel();
    await choose(
      fixture,
      jsonl(HEADER, CREATE_MILK, LINK_BREAD, LINK_LEAFLET_TO_NEW, REVIEW_ACEITE)
    );

    const rows = [
      ...fixture.nativeElement.querySelectorAll(
        '[data-decisions-review] tbody tr'
      ),
    ] as HTMLElement[];
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain(
      'harvest.entries.decisionsFile.kindCreate'
    );
    expect(rows[0].textContent).toContain('entry-milk');
    expect(rows[0].textContent).toContain('Leche entera 1 L');
    expect(rows[1].textContent).toContain('it_bread');
    expect(rows[1].textContent).toContain('Pan de molde');
    expect(q(fixture, '[data-decisions-other-gateway]')).toBeNull();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies the reviewed file, whole, and binds the rows', async () => {
    const { fixture, apply, memory, panel } = await renderPanel();
    const applied = jest.fn();
    panel.applied.subscribe(applied);

    await choose(
      fixture,
      jsonl(HEADER, CREATE_MILK, LINK_BREAD, LINK_LEAFLET_TO_NEW, REVIEW_ACEITE)
    );
    await press(fixture, '[data-apply-decisions]');

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0].operations).toHaveLength(3);
    expect(q(fixture, '[data-decisions-applied]')).not.toBeNull();
    expect(panel.answer()?.applied).toBe(true);
    expect(applied).toHaveBeenCalledTimes(1);

    // The leaflet row was bound to the product the same file created.
    const created = panel.answer()?.results[0].itemId;
    expect(created).toBeTruthy();
    expect(panel.answer()?.results[2].itemId).toBe(created);
    expect(await entryStatus(memory, 'entry-milk')).toBe('ACTIVE');
    expect(await entryStatus(memory, 'entry-leche-leaflet')).toBe('ACTIVE');
    expect(await entryStatus(memory, 'entry-aceite')).toBe('UNRESOLVED');
  });

  it('shows the step and the operation that refused the file, and writes nothing', async () => {
    const { fixture, memory, panel } = await renderPanel();
    const applied = jest.fn();
    panel.applied.subscribe(applied);

    await choose(fixture, jsonl(HEADER, LINK_BREAD, LINK_REJECTED));
    await press(fixture, '[data-apply-decisions]');

    expect(panel.answer()?.applied).toBe(false);
    expect(panel.answer()?.failedStep).toBe('VALIDATE');
    expect(q(fixture, '[data-decisions-refused]')?.textContent).toContain(
      'harvest.entries.decisionsFile.refused'
    );

    // One line refused it, with its code and the server's sentence; the other
    // is not listed as failed, and did not go through either.
    const failed = [
      ...fixture.nativeElement.querySelectorAll(
        '[data-decisions-failed] tbody tr'
      ),
    ] as HTMLElement[];
    expect(failed).toHaveLength(1);
    expect(failed[0].textContent).toContain('entry-lote');
    expect(failed[0].textContent).toContain(
      'harvest.entries.decisionsFile.error.NOT_PENDING'
    );
    expect(failed[0].textContent).toContain('REJECTED');
    expect(await entryStatus(memory, 'entry-bread')).toBe('CANDIDATE');
    expect(applied).not.toHaveBeenCalled();
  });

  it('keeps the review when the request is refused before any row is read', async () => {
    const { fixture, apply } = await renderPanel();
    apply.mockRejectedValueOnce(
      new GatewayError({
        code: 'validation_failed',
        status: 400,
        correlationId: '',
      })
    );

    await choose(fixture, jsonl(HEADER, LINK_BREAD));
    await press(fixture, '[data-apply-decisions]');

    expect(q(fixture, '[data-decisions-review]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain(
      'resource.error.validation'
    );
  });

  it('says so when the file was decided against another gateway', async () => {
    const { fixture } = await renderPanel('https://api.velista.app');
    await choose(fixture, jsonl(HEADER, LINK_BREAD));

    expect(q(fixture, '[data-decisions-other-gateway]')).not.toBeNull();
  });

  it('says which line is not JSON, and offers nothing to apply', async () => {
    const { fixture } = await renderPanel();
    await choose(fixture, 'not json at all\n');

    expect(fixture.nativeElement.textContent).toContain(
      'harvest.entries.decisionsFile.problem.notJson'
    );
    expect(q(fixture, '[data-apply-decisions]')).toBeNull();
  });
});

describe('the entries queue, with a decisions file', () => {
  it('opens the panel and reads the queue again once a file applied', async () => {
    const memory = new HarvestMemory();
    const list = jest.spyOn(memory, 'listEntries');

    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [EntriesQueuePage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        ContentLocaleStore,
        ServerReachability,
        provideRouter([]),
        provideLocationMocks(),
        { provide: HARVEST_SERVICE, useValue: memory },
        {
          provide: ResourceReferences,
          useValue: { search: async () => [], resolve: async () => null },
        },
        {
          provide: DEPLOYMENT_SERVICE,
          useValue: {
            read: async () => ({
              deployment: 'development',
              devAutologin: false,
            }),
          },
        },
        DeploymentStore,
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(EntriesQueuePage);
    fixture.detectChanges();
    await drain();
    fixture.detectChanges();
    const readsBefore = list.mock.calls.length;

    await press(fixture, '[data-open-decisions]');
    const panel = fixture.debugElement.query(
      (element) => element.componentInstance instanceof DecisionsFilePanel
    ).componentInstance as DecisionsFilePanel;

    await panel.chooseFile(chosen(jsonl(HEADER, LINK_BREAD)));
    fixture.detectChanges();
    await press(fixture, '[data-apply-decisions]');
    await drain();

    expect(panel.answer()?.applied).toBe(true);
    expect(list.mock.calls.length).toBeGreaterThan(readsBefore);
  });
});
