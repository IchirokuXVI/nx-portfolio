import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ContentLocaleStore,
  GatewayError,
  RecordStore,
} from '@portfolio/luna-shopper-admin/data-access';
import {
  defineResource,
  type ResourceGateway,
  type ResourceRow,
} from '@portfolio/luna-shopper-admin/models';
import { Viewport } from '@portfolio/luna-shopper-admin/ui';
import { provideSections } from './admin-section';
import { RecordView } from './record-view';

/**
 * The body of the record page (admin plan 0053, section 2.2).
 *
 * The view is handed a store and draws it. So each case builds the store in
 * the state it is about, and asserts on what is on the screen.
 */

interface Shop extends ResourceRow {
  id: string;
  name: Record<string, string>;
  chainId: string;
  tagIds: string[];
  open: boolean;
  slug: string;
  key: string;
  visits: number;
  note: string | null;
  createdAt: string;
}

const ROW: Shop = {
  id: 's1',
  name: { en: 'Centre', es: 'Centro' },
  chainId: 'c1',
  tagIds: ['t1', 't_gone'],
  open: true,
  slug: 'centro',
  key: 'k-centro',
  visits: 12,
  note: null,
  createdAt: '2026-09-12T10:41:00.000Z',
};

/** Which chains and tags were read, so "one reference, one read" can be held. */
const reads: string[] = [];

function reading(
  rows: Readonly<Record<string, ResourceRow>>
): ResourceGateway<ResourceRow> {
  return {
    list: async () => ({ items: [], nextCursor: null }),
    read: async (id) => {
      reads.push(id);
      const row = rows[id];
      if (row === undefined) {
        throw new GatewayError({
          code: 'not_found',
          status: 404,
          correlationId: '',
        });
      }
      return row;
    },
    create: () => Promise.reject(new Error('not used')),
    update: () => Promise.reject(new Error('not used')),
    remove: () => Promise.reject(new Error('not used')),
  };
}

/** A target with a page of its own: a reference to it is a link. */
const CHAINS = defineResource<{ id: string; name: string }>({
  name: 'chains',
  segment: 'chains',
  labels: { one: 'chains.one', many: 'chains.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'chains.name' }],
  list: { columns: ['name'], compact: ['name'] },
  actions: { edit: true },
  gateway: () => reading({ c1: { id: 'c1', name: 'Deza' } }),
});

/** A target with no page: a reference to it is text. */
const TAGS = defineResource<{ id: string; name: string }>({
  name: 'tags',
  segment: 'tags',
  labels: { one: 'tags.one', many: 'tags.many' },
  title: (row) => row.name,
  fields: [{ kind: 'text', name: 'name', label: 'tags.name' }],
  list: { columns: ['name'], compact: ['name'] },
  gateway: () => reading({ t1: { id: 't1', name: 'Fresh' } }),
});

const notices = signal<readonly string[]>([]);

const SHOPS = defineResource<Shop>({
  name: 'shops',
  segment: 'shops',
  labels: { one: 'shops.one', many: 'shops.many' },
  title: (row) => row.slug,
  fields: [
    { kind: 'text', name: 'id', label: 'shops.id', editable: false },
    {
      kind: 'localized-text',
      name: 'name',
      label: 'shops.name',
      locales: ['en', 'es'],
      required: true,
    },
    {
      kind: 'reference',
      name: 'chainId',
      label: 'shops.chain',
      resource: 'chains',
      editable: 'create',
      required: true,
    },
    {
      kind: 'references',
      name: 'tagIds',
      label: 'shops.tags',
      resource: 'tags',
    },
    { kind: 'boolean', name: 'open', label: 'shops.open' },
    {
      kind: 'text',
      name: 'slug',
      label: 'shops.slug',
      required: true,
      help: 'shops.slugHelp',
    },
    {
      kind: 'text',
      name: 'key',
      label: 'shops.key',
      editable: false,
      setBy: 'shops.keySetBy',
    },
    { kind: 'number', name: 'visits', label: 'shops.visits', editable: false },
    { kind: 'text', name: 'note', label: 'shops.note', nullable: true },
    {
      kind: 'date',
      name: 'createdAt',
      label: 'shops.createdAt',
      editable: false,
      time: true,
    },
  ],
  list: { columns: ['slug'], compact: ['slug'] },
  parent: { resource: 'chains', param: 'chainId', filter: 'chainId' },
  caution: 'shops.caution',
  notices: () => notices,
  record: {
    sections: [
      { title: 'shops.section.name', fields: ['name', 'slug'] },
      { title: 'shops.section.where', fields: ['chainId', 'tagIds'] },
    ],
    facts: { added: 'createdAt' },
  },
  errorFields: { slug_taken: 'slug' },
  errorLinks: { shop_twin: { detail: 'shopId', resource: 'shops' } },
  actions: { create: true, edit: true },
  gateway: () => {
    throw new Error('the spec hands the store its own gateway');
  },
});

/** What the next save answers with. `null` saves. */
let refuseWith: GatewayError | null = null;
/** Held open by a case that looks at the page while a save is on its way. */
let hold: Promise<void> = Promise.resolve();

const gateway: ResourceGateway<ResourceRow> = {
  list: async () => ({ items: [], nextCursor: null }),
  read: async () => ROW,
  create: async (input) => ({ ...ROW, ...input, id: 's_new' }),
  update: async (_id, input) => {
    await hold;
    if (refuseWith !== null) {
      throw refuseWith;
    }
    return { ...ROW, ...input };
  },
  remove: () => Promise.reject(new Error('not used')),
};

interface Drawn {
  readonly fixture: ComponentFixture<RecordView>;
  readonly store: RecordStore<ResourceRow>;
  readonly element: HTMLElement;
}

async function draw(
  options: {
    readonly id?: string | null;
    readonly compact?: boolean;
    readonly parents?: Record<string, string>;
    readonly load?: boolean;
    readonly gateway?: ResourceGateway<ResourceRow>;
  } = {}
): Promise<Drawn> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [RecordView, RokuTranslatorTestingModule.forTesting()],
    providers: [
      ContentLocaleStore,
      provideRouter([]),
      provideSections({
        key: 'stuff',
        label: '',
        segment: 'stuff',
        resources: [CHAINS, TAGS, SHOPS],
      }),
      {
        provide: Viewport,
        useValue: {
          compact: signal(options.compact === true),
          split: signal(false),
        },
      },
    ],
  }).compileComponents();

  const store = new RecordStore<ResourceRow>(
    SHOPS,
    options.gateway ?? gateway,
    options.id === undefined ? 's1' : options.id
  );
  if (options.load !== false) {
    await store.load();
  }

  const fixture = TestBed.createComponent(RecordView);
  fixture.componentRef.setInput('descriptor', SHOPS);
  fixture.componentRef.setInput('store', store);
  fixture.componentRef.setInput('parents', options.parents ?? {});
  document.body.append(fixture.nativeElement);
  await settle(fixture);
  return { fixture, store, element: fixture.nativeElement };
}

/** Lets the lookups and a save settle, then redraws. */
async function settle(fixture: ComponentFixture<RecordView>): Promise<void> {
  fixture.detectChanges();
  await new Promise((resolve) => setTimeout(resolve, 0));
  fixture.detectChanges();
}

const CONTROLS = 'input, select, textarea, [role="switch"]';

/** The label of each row of the sections, in the order of the page. */
const labels = (element: HTMLElement) =>
  Array.from(element.querySelectorAll('.sections lib-field-row .label')).map(
    (label) =>
      (label.querySelector('label') ?? label).firstChild?.textContent?.trim()
  );

const rowOf = (element: HTMLElement, label: string) =>
  Array.from(element.querySelectorAll<HTMLElement>('lib-field-row')).find(
    (row) => row.querySelector('.label')?.textContent?.includes(label)
  ) as HTMLElement;

const refusal = (
  code: string,
  status: number,
  extra: {
    fieldErrors?: Record<string, string[]>;
    details?: Record<string, unknown>;
  } = {}
) => new GatewayError({ code, status, correlationId: '', ...extra });

describe('RecordView', () => {
  let drawn: Drawn;

  beforeEach(() => {
    reads.length = 0;
    refuseWith = null;
    hold = Promise.resolve();
    notices.set([]);
  });

  afterEach(() => drawn?.fixture.nativeElement.remove());

  describe('while the page reads', () => {
    /** A row that was opened to be read cannot be changed by a slip. */
    it('draws no control at all, and no bar', async () => {
      drawn = await draw();

      expect(drawn.element.querySelectorAll(CONTROLS)).toHaveLength(0);
      expect(drawn.element.querySelector('lib-field-control')).toBeNull();
      expect(drawn.element.querySelector('lib-save-bar')).toBeNull();
      expect(drawn.element.querySelectorAll('lib-field-value').length).toBe(
        // Eight fields in the sections, and the date of the Record block.
        9
      );
    });

    it('draws the sections of the descriptor, and the rest in a last one', async () => {
      drawn = await draw();

      expect(
        Array.from(drawn.element.querySelectorAll('.sections h2')).map(
          (heading) => heading.textContent?.trim()
        )
      ).toEqual([
        'shops.section.name',
        'shops.section.where',
        'record.section.other',
      ]);
      expect(labels(drawn.element)).toEqual([
        'shops.name',
        'shops.slug',
        'shops.chain',
        'shops.tags',
        'shops.open',
        'shops.key',
        'shops.visits',
        'shops.note',
      ]);
    });

    it('reads an empty value as "None", and a yes or no as a word', async () => {
      drawn = await draw();

      expect(
        rowOf(drawn.element, 'shops.note').querySelector('[data-none]')
      ).not.toBeNull();
      expect(rowOf(drawn.element, 'shops.open').textContent).toContain(
        'resource.value.yes'
      );
    });

    it('holds the date and the ID in the Record block, and in no section', async () => {
      drawn = await draw();
      const facts = drawn.element.querySelector('.facts') as HTMLElement;

      expect(facts.querySelector('h2')?.textContent?.trim()).toBe(
        'record.facts.heading'
      );
      expect(
        Array.from(facts.querySelectorAll('[data-fact]')).map((fact) =>
          fact.getAttribute('data-fact')
        )
      ).toEqual(['added', 'id']);
      expect(facts.querySelector('lib-record-id code')?.textContent).toBe('s1');
      expect(labels(drawn.element)).not.toContain('shops.createdAt');
      expect(labels(drawn.element)).not.toContain('shops.id');
    });

    /** One record is a handful of reads, whatever `nameLookup` says. */
    it('resolves every reference by name, each one once', async () => {
      drawn = await draw();

      expect([...reads].sort()).toEqual(['c1', 't1', 't_gone']);

      const chain = rowOf(drawn.element, 'shops.chain');
      // The registry knows a page for a chain, so its name is a link.
      expect(chain.querySelector('a')?.textContent?.trim()).toBe('Deza');
      expect(chain.querySelector('a')?.getAttribute('href')).toBe(
        '/stuff/chains/c1'
      );

      const tags = rowOf(drawn.element, 'shops.tags');
      const entries = Array.from(tags.querySelectorAll('li'));
      // A tag has no page, so its name is text and not a link.
      expect(entries[0].textContent).toContain('Fresh');
      expect(entries[0].querySelector('a')).toBeNull();
      // A reference whose record is gone says so, and does not keep looking.
      expect(entries[1].querySelector('[data-gone]')).not.toBeNull();
      expect(tags.querySelector('[data-resolving]')).toBeNull();
    });

    it('says when the save went through, to a screen reader too', async () => {
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', 'centre');
      await drawn.store.submit();
      await settle(drawn.fixture);

      const line = drawn.element.querySelector('[data-saved]');
      expect(line?.textContent).toContain('record.savedAt');
      expect(line?.getAttribute('role')).toBe('status');
      expect(drawn.element.querySelector('lib-save-bar')).toBeNull();
    });

    it('says "added" with a way to add another, when the page says so', async () => {
      drawn = await draw();
      const asked: number[] = [];
      drawn.fixture.componentInstance.addAnother.subscribe(() => asked.push(1));

      expect(drawn.element.querySelector('[data-added]')).toBeNull();

      drawn.fixture.componentRef.setInput('added', true);
      await settle(drawn.fixture);

      const line = drawn.element.querySelector('[data-added]') as HTMLElement;
      expect(line.textContent).toContain('record.added');
      expect(line.getAttribute('role')).toBe('status');
      (line.querySelector('button') as HTMLButtonElement).click();
      expect(asked).toEqual([1]);
    });

    /** The caution is read before the action, and reading acts on nothing. */
    it('draws no caution', async () => {
      drawn = await draw();

      expect(drawn.element.querySelector('[data-caution]')).toBeNull();
    });
  });

  describe('while the page is a form', () => {
    it('draws the same rows in the same order, so nothing moves', async () => {
      drawn = await draw();
      const before = labels(drawn.element);

      drawn.store.edit();
      await settle(drawn.fixture);

      expect(labels(drawn.element)).toEqual(before);
      expect(drawn.element.querySelector('lib-save-bar')).not.toBeNull();
      expect(
        drawn.element.querySelectorAll('lib-field-control').length
      ).toBeGreaterThan(0);
    });

    it('draws a field it cannot change as a value with a lock, and says why', async () => {
      drawn = await draw();
      drawn.store.edit();
      await settle(drawn.fixture);

      const reasonOf = (label: string) =>
        rowOf(drawn.element, label)
          .querySelector('lib-locked-value [data-reason]')
          ?.textContent?.trim();

      // The descriptor's own words win.
      expect(reasonOf('shops.key')).toBe('shops.keySetBy');
      // Settable once, and the record exists.
      expect(reasonOf('shops.chain')).toBe('record.locked.fixedOnAdd');
      // Neither: the system holds it.
      expect(reasonOf('shops.visits')).toBe('record.locked.system');
      // And none of the three is a control.
      for (const label of ['shops.key', 'shops.chain', 'shops.visits']) {
        expect(rowOf(drawn.element, label).querySelector(CONTROLS)).toBeNull();
      }
    });

    it('locks the parent of a new record that the address names', async () => {
      drawn = await draw({ id: null, parents: { chainId: 'c1' } });

      const chain = rowOf(drawn.element, 'shops.chain');
      expect(
        chain.querySelector('lib-locked-value [data-reason]')?.textContent
      ).toContain('record.locked.fromAddress');
      // By name, like every reference.
      expect(chain.textContent).toContain('Deza');
      expect(chain.querySelector(CONTROLS)).toBeNull();
    });

    it('asks for the parent when the address names none', async () => {
      drawn = await draw({ id: null });

      const chain = rowOf(drawn.element, 'shops.chain');
      expect(chain.querySelector('lib-locked-value')).toBeNull();
      expect(chain.querySelector('lib-field-control')).not.toBeNull();
    });

    /** A record that does not exist yet has no ID and no date. */
    it('draws only what a new record can state, and no Record block', async () => {
      drawn = await draw({ id: null, parents: { chainId: 'c1' } });

      expect(labels(drawn.element)).toEqual([
        'shops.name',
        'shops.slug',
        'shops.chain',
        'shops.tags',
        'shops.open',
        'shops.note',
      ]);
      expect(drawn.element.querySelector('.facts')).toBeNull();
      expect(
        rowOf(drawn.element, 'shops.slug').querySelector('.star')
      ).not.toBeNull();
      expect(
        drawn.element.querySelector('lib-save-bar [data-save]')?.textContent
      ).toContain('record.action.add');
    });

    it('says "Changed" beside a field that differs, until it does not', async () => {
      drawn = await draw();
      drawn.store.edit();
      await settle(drawn.fixture);
      expect(drawn.element.querySelector('[data-changed]')).toBeNull();

      drawn.store.set('slug', 'centre');
      await settle(drawn.fixture);
      expect(
        rowOf(drawn.element, 'shops.slug').querySelector('[data-changed]')
      ).not.toBeNull();
      expect(drawn.element.querySelectorAll('[data-changed]')).toHaveLength(1);

      drawn.store.set('slug', 'centro');
      await settle(drawn.fixture);
      expect(drawn.element.querySelector('[data-changed]')).toBeNull();
    });

    /**
     * A text in several languages is one box for each language, and no
     * element has the id of the control itself. The label points at the first
     * box, so a press on it reaches one.
     */
    it('ties each label to a control that exists', async () => {
      drawn = await draw();
      drawn.store.edit();
      await settle(drawn.fixture);

      const pointed = Array.from(
        drawn.element.querySelectorAll<HTMLLabelElement>('lib-field-row label')
      ).map((label) => label.htmlFor);

      expect(pointed).toContain('record-field-name-en');
      for (const id of pointed) {
        expect(drawn.element.querySelector(`[id="${id}"]`)).not.toBeNull();
      }
    });

    it('turns every control off while the save is on its way', async () => {
      let release: () => void = () => undefined;
      hold = new Promise<void>((resolve) => (release = resolve));
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', 'centre');
      await settle(drawn.fixture);

      const saving = drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      const controls = Array.from(
        drawn.element.querySelectorAll<HTMLInputElement>(
          '.sections input, .sections textarea, .sections [role="switch"]'
        )
      );
      expect(controls.length).toBeGreaterThan(0);
      expect(controls.every((control) => control.disabled)).toBe(true);
      expect(
        drawn.element.querySelector<HTMLButtonElement>(
          'lib-save-bar [data-cancel]'
        )?.disabled
      ).toBe(true);

      release();
      await saving;
    });

    it('says what was saved, and with which row', async () => {
      drawn = await draw();
      const saved: ResourceRow[] = [];
      drawn.fixture.componentInstance.saved.subscribe((row) => saved.push(row));
      drawn.store.edit();
      drawn.store.set('slug', 'centre');

      await drawn.fixture.componentInstance.save();

      expect(saved.map((row) => row['slug'])).toEqual(['centre']);
    });

    /** The page decides what Cancel does. The view only says it was pressed. */
    it('says that Cancel was pressed, and throws nothing away itself', async () => {
      drawn = await draw();
      const pressed: number[] = [];
      drawn.fixture.componentInstance.cancel.subscribe(() => pressed.push(1));
      drawn.store.edit();
      drawn.store.set('slug', 'centre');
      await settle(drawn.fixture);

      drawn.element
        .querySelector<HTMLButtonElement>('lib-save-bar [data-cancel]')
        ?.click();

      expect(pressed).toEqual([1]);
      expect(drawn.store.mode()).toBe('edit');
      expect(drawn.store.draft()['slug']).toBe('centre');
    });
  });

  describe('a refusal', () => {
    it('is said under the field it is about, and tied to its control', async () => {
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', '');
      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      const row = rowOf(drawn.element, 'shops.slug');
      const input = row.querySelector('input') as HTMLInputElement;
      const error = row.querySelector('[data-error]') as HTMLElement;

      expect(error.textContent).toContain('resource.error.required');
      expect(input.getAttribute('aria-invalid')).toBe('true');
      // The refusal first, then the help.
      expect(input.getAttribute('aria-describedby')).toBe(
        `${error.id} record-field-slug-help`
      );
      expect(drawn.element.querySelector('[data-refusal]')).toBeNull();
    });

    it('is said under the field when the descriptor says the code is about one', async () => {
      refuseWith = refusal('slug_taken', 409);
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', 'norte');
      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      expect(
        rowOf(drawn.element, 'shops.slug').querySelector('[data-error]')
      ).not.toBeNull();
      expect(drawn.element.querySelector('[data-refusal]')).toBeNull();
    });

    it('is one line above the first section when it is about no field, with its link', async () => {
      refuseWith = refusal('shop_twin', 409, { details: { shopId: 's9' } });
      drawn = await draw({ parents: { chainId: 'c1' } });
      drawn.store.edit();
      drawn.store.set('slug', 'norte');
      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      const line = drawn.element.querySelector('[data-refusal]') as HTMLElement;
      expect(line.getAttribute('role')).toBe('alert');
      expect(line.querySelector('a')?.getAttribute('href')).toBe(
        '/stuff/chains/c1/shops/s9'
      );
      // What was typed stays.
      expect(drawn.store.draft()['slug']).toBe('norte');
      // Before the sections in the document, so it is read first.
      expect(
        line.compareDocumentPosition(
          drawn.element.querySelector('.sections') as HTMLElement
        ) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
    });

    it('draws the lines in one order', async () => {
      refuseWith = refusal('validation_failed', 400, {
        fieldErrors: { phone: ['Not a number.'] },
      });
      notices.set(['shops.notice']);
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', 'norte');
      await drawn.fixture.componentInstance.save();
      drawn.fixture.componentRef.setInput('refusal', {
        key: 'shops.actionFailed',
        link: null,
      });
      await settle(drawn.fixture);

      expect(
        Array.from(drawn.element.querySelectorAll('.lines > *')).map(
          (line) =>
            line.getAttribute('data-tone') ??
            (line.classList.contains('notice') ? 'notice' : '')
        )
      ).toEqual(['notice', 'caution', 'refused', 'refused']);
      expect(
        drawn.element.querySelector('[data-refusal]')?.textContent
      ).toContain('shops.actionFailed');
      expect(
        drawn.element.querySelector('[data-stray]')?.textContent
      ).toContain('Not a number.');
    });

    it('puts the focus on the first refused field when asked to', async () => {
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', '');
      drawn.store.set('name', { en: '', es: '' });
      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      drawn.element
        .querySelector<HTMLButtonElement>('lib-save-bar [data-go-to-first]')
        ?.click();

      // The name is first on the page, though the descriptor names it after
      // nothing in particular: the order is the order of the sections.
      expect(document.activeElement?.id).toBe('record-field-name-en');
    });

    /** The bar of a phone has no room for "Go to the first". */
    it('moves to the first refused field by itself on a phone', async () => {
      drawn = await draw({ compact: true });
      drawn.store.edit();
      drawn.store.set('slug', '');
      await settle(drawn.fixture);

      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      expect(document.activeElement?.id).toBe('record-field-slug');
    });

    it('leaves the focus alone on a wide screen', async () => {
      drawn = await draw();
      drawn.store.edit();
      drawn.store.set('slug', '');
      await settle(drawn.fixture);

      await drawn.fixture.componentInstance.save();
      await settle(drawn.fixture);

      expect(document.activeElement?.id).not.toBe('record-field-slug');
    });
  });

  describe('while the record is on its way', () => {
    /** Only the values wait. The frame and the labels are there at once. */
    it('draws the frame and the labels, with a bar for each value', async () => {
      drawn = await draw({
        load: false,
        gateway: { ...gateway, read: () => new Promise(() => undefined) },
      });
      void drawn.store.load();
      await settle(drawn.fixture);

      expect(labels(drawn.element)).toHaveLength(8);
      expect(
        drawn.element.querySelectorAll('.sections [data-loading]')
      ).toHaveLength(8);
      expect(drawn.element.querySelector('lib-field-value')).toBeNull();
      expect(
        drawn.element.querySelector('.body')?.getAttribute('aria-busy')
      ).toBe('true');
      expect(drawn.element.querySelector('lib-save-bar')).toBeNull();
    });
  });

  describe('the notices of the resource', () => {
    it('follow the signal the descriptor built', async () => {
      drawn = await draw();
      expect(drawn.element.querySelector('.notice')).toBeNull();

      notices.set(['shops.notice']);
      await settle(drawn.fixture);

      expect(drawn.element.querySelector('.notice')?.textContent).toContain(
        'shops.notice'
      );
    });
  });
});
