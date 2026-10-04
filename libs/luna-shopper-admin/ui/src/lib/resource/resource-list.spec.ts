import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  FieldDescriptor,
  InfoContent,
  ResourceRowView,
} from '@portfolio/luna-shopper-admin/models';
import { ResourceList } from './resource-list';

/**
 * The list, in its two layouts and its four states (plan 0004, sections 3
 * and 8).
 *
 * Everything here is set through inputs, which is the whole reason the layout
 * switch is a `compact` input rather than a CSS media query: jsdom reports every
 * media query as unmatched, so a purely stylistic switch would leave the one
 * piece of per entity judgement in the descriptor asserted by nothing.
 */

const columns: FieldDescriptor[] = [
  { kind: 'text', name: 'name', label: 'shops.name' },
  { kind: 'text', name: 'websiteUrl', label: 'shops.website', format: 'url' },
  { kind: 'text', name: 'brand', label: 'shops.brand' },
];

/** What the descriptor says survives to a phone: two of the three columns. */
const compactColumns: FieldDescriptor[] = [columns[0], columns[2]];

const rows: ResourceRowView[] = [
  {
    id: 'a',
    title: 'Bonpreu',
    cells: {
      name: { text: 'Bonpreu' },
      websiteUrl: {
        text: 'https://bonpreu.example',
        href: 'https://bonpreu.example',
      },
      brand: { text: 'Q11924747' },
    },
    row: { id: 'a' },
  },
  {
    id: 'b',
    title: 'Consum',
    cells: {
      name: { text: 'Consum' },
      websiteUrl: { text: '', key: 'resource.value.none' },
      brand: { text: 'Q8350308' },
    },
    row: { id: 'b' },
  },
];

async function render(
  inputs: Partial<{
    compact: boolean;
    loading: boolean;
    failed: boolean;
    empty: boolean;
    noMatch: boolean;
    hasMore: boolean;
    canCreate: boolean;
    canDelete: boolean;
    canOpen: boolean;
    rows: readonly ResourceRowView[];
    heading: 'page' | 'pane' | 'none';
    headingLevel: 1 | 2;
    createKey: string;
    layout: 'auto' | 'rows';
    currentId: string | null;
    info: InfoContent | null;
  }> = {}
): Promise<ComponentFixture<ResourceList>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceList, RokuTranslatorTestingModule.forTesting()],
    // A reference cell with somewhere to go renders a routerLink anchor.
    providers: [provideRouter([])],
  }).compileComponents();

  const fixture = TestBed.createComponent(ResourceList);
  fixture.componentRef.setInput('titleKey', 'shops.many');
  fixture.componentRef.setInput('columns', columns);
  fixture.componentRef.setInput('compactColumns', compactColumns);
  fixture.componentRef.setInput('rows', inputs.rows ?? rows);

  for (const [name, value] of Object.entries(inputs)) {
    if (name !== 'rows') {
      fixture.componentRef.setInput(name, value);
    }
  }

  fixture.detectChanges();
  return fixture;
}

const query = (fixture: ComponentFixture<ResourceList>, selector: string) =>
  fixture.nativeElement.querySelectorAll(selector) as NodeListOf<HTMLElement>;

describe('a reference cell with somewhere to go (admin plan 0023)', () => {
  const linked: ResourceRowView[] = [
    {
      id: 'a',
      title: 'Bonpreu',
      cells: {
        name: { text: 'Bonpreu' },
        websiteUrl: { text: '', key: 'resource.value.none' },
        brand: {
          text: 'Olive oil',
          reference: { resource: 'product-groups', id: 'pg1' },
          link: ['/', 'product-groups', 'pg1'],
        },
      },
      row: { id: 'a' },
    },
  ];

  /**
   * A real anchor, not a styled button: named by the text it shows, in its own
   * tab stop, and openable in a new tab, which is half the point of a link in
   * a table.
   */
  it('draws the cell as an internal anchor', async () => {
    const fixture = await render({ rows: linked });

    const anchor = query(fixture, 'tbody td a')[0];
    expect(anchor?.getAttribute('href')).toBe('/product-groups/pg1');
    expect(anchor?.textContent?.trim()).toBe('Olive oil');
    expect(anchor?.getAttribute('target')).toBeNull();
  });

  it('draws the same anchor on the card', async () => {
    const fixture = await render({ rows: linked, compact: true });

    const anchor = query(fixture, '.card a')[0];
    expect(anchor?.getAttribute('href')).toBe('/product-groups/pg1');
  });
});

describe('ResourceList layout', () => {
  it('draws a table above the breakpoint', async () => {
    const fixture = await render({ compact: false });

    expect(query(fixture, 'table')).toHaveLength(1);
    expect(query(fixture, '.card')).toHaveLength(0);
    expect(query(fixture, 'tbody tr')).toHaveLength(2);
  });

  it('draws cards below it, from the same inputs', async () => {
    const fixture = await render({ compact: true });

    expect(query(fixture, 'table')).toHaveLength(0);
    expect(query(fixture, '.card')).toHaveLength(2);
  });

  it('gives the table a column per descriptor column, plus one for actions', async () => {
    const fixture = await render({ compact: false });

    expect(query(fixture, 'thead th')).toHaveLength(columns.length + 1);
  });

  /**
   * The judgement the generic component cannot make. A fifteen column table on
   * a phone is unusable however it scrolls, so a card shows only what the
   * descriptor said survives.
   */
  it('puts only the descriptor-named fields on a card', async () => {
    const fixture = await render({ compact: true });

    const labels = [...query(fixture, '.card dt')].map(
      (element) => element.textContent?.trim() ?? ''
    );

    expect(labels).toEqual([
      'shops.name',
      'shops.brand',
      'shops.name',
      'shops.brand',
    ]);
    expect(labels).not.toContain('shops.website');
  });
});

describe('ResourceList states', () => {
  it('says it is loading rather than showing an empty table', async () => {
    const fixture = await render({ loading: true, rows: [] });

    expect(query(fixture, 'table')).toHaveLength(0);
    expect(query(fixture, '[role="status"]')).toHaveLength(1);
  });

  it('says there is nothing here', async () => {
    const fixture = await render({ empty: true, rows: [] });

    expect(fixture.nativeElement.textContent).toContain('resource.list.empty');
  });

  /**
   * The distinction the whole state machine exists for. An operator staring at
   * "no supermarkets" because a filter from three screens ago is still set is
   * the failure this prevents, so the sentence is different and it comes with a
   * way out.
   */
  it('tells no match apart from empty, and offers a way to clear it', async () => {
    const fixture = await render({ noMatch: true, rows: [] });

    expect(fixture.nativeElement.textContent).toContain(
      'resource.list.noMatch'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.list.empty'
    );

    const buttons = [...query(fixture, 'button')].filter((button) =>
      button.textContent?.includes('resource.action.clearFilters')
    );
    expect(buttons).toHaveLength(1);
  });

  it('emits the clear when that way out is taken', async () => {
    const fixture = await render({ noMatch: true, rows: [] });
    let cleared = 0;
    fixture.componentInstance.clear.subscribe(() => (cleared += 1));

    const button = [...query(fixture, 'button')].find((element) =>
      element.textContent?.includes('resource.action.clearFilters')
    );
    button?.click();

    expect(cleared).toBe(1);
  });

  it('reports a failure and offers the request again', async () => {
    const fixture = await render({ failed: true, rows: [] });
    let retried = 0;
    fixture.componentInstance.retry.subscribe(() => (retried += 1));

    expect(query(fixture, '[role="alert"]')).toHaveLength(1);
    const button = [...query(fixture, 'button')].find((element) =>
      element.textContent?.includes('resource.action.retry')
    );
    button?.click();

    expect(retried).toBe(1);
  });
});

describe('ResourceList controls', () => {
  it('offers a create control only when the descriptor allows one', async () => {
    const without = await render({ canCreate: false });
    expect(
      [...query(without, 'button')].some((element) =>
        element.textContent?.includes('resource.action.create')
      )
    ).toBe(false);

    const with_ = await render({ canCreate: true });
    expect(
      [...query(with_, 'button')].some((element) =>
        element.textContent?.includes('resource.action.create')
      )
    ).toBe(true);
  });

  it('opens a row by its own name', async () => {
    const fixture = await render({ compact: false });
    const opened: string[] = [];
    fixture.componentInstance.open.subscribe((id) => opened.push(id));

    query(fixture, 'tbody .title')[1].click();

    expect(opened).toEqual(['b']);
  });

  it('asks to load more only when there is more', async () => {
    const without = await render({ hasMore: false });
    expect(
      [...query(without, 'button')].some((element) =>
        element.textContent?.includes('resource.action.more')
      )
    ).toBe(false);

    const with_ = await render({ hasMore: true });
    expect(
      [...query(with_, 'button')].some((element) =>
        element.textContent?.includes('resource.action.more')
      )
    ).toBe(true);
  });
});

const INFO: InfoContent = {
  title: 'shops.info.title',
  points: ['shops.info.one'],
};

const texts = (fixture: ComponentFixture<ResourceList>, selector: string) =>
  [...query(fixture, selector)].map(
    (element) => element.textContent?.trim() ?? ''
  );

/**
 * What the list draws above itself (admin plan 0042). A list is the whole
 * page, a column beside the row that is open, or a tab of a page, and only the
 * first of the three owns the page header.
 */
describe('ResourceList heading', () => {
  it('draws the page header when it is the whole page', async () => {
    const fixture = await render({ canCreate: true });

    expect(query(fixture, 'lib-page-header')).toHaveLength(1);
    expect(texts(fixture, 'lib-page-header h1')).toEqual(['shops.many']);
    expect(query(fixture, '.pane-head')).toHaveLength(0);
    expect(query(fixture, '.tools')).toHaveLength(0);
    expect(texts(fixture, 'lib-page-header .page-actions button')).toEqual([
      'resource.action.create',
    ]);
  });

  /**
   * The open row's page draws the page header, so the column only says what it
   * lists. Under an open row that title is the second level.
   */
  it('draws a title of its own and no page header as a pane', async () => {
    const fixture = await render({
      heading: 'pane',
      canCreate: true,
      info: INFO,
    });

    expect(query(fixture, 'lib-page-header')).toHaveLength(0);
    expect(texts(fixture, '.pane-head h2')).toEqual(['shops.many']);
    expect(query(fixture, 'h1')).toHaveLength(0);
    expect(query(fixture, '.pane-head lib-info-button')).toHaveLength(1);
    expect(texts(fixture, '.pane-head [data-create]')).toEqual([
      'resource.action.create',
    ]);
  });

  /** With nothing open beside it the column is all the page has. */
  it('makes the pane title the h1 while no row is open', async () => {
    const fixture = await render({ heading: 'pane', headingLevel: 1 });

    expect(texts(fixture, '.pane-head h1')).toEqual(['shops.many']);
    expect(query(fixture, 'h2')).toHaveLength(0);
  });

  it('leaves the add button out of a pane that cannot create', async () => {
    const fixture = await render({ heading: 'pane' });

    expect(query(fixture, '[data-create]')).toHaveLength(0);
    expect(query(fixture, '.pane-head lib-info-button')).toHaveLength(0);
  });

  /** A tab: the page above drew the header and the tab says what is listed. */
  it('draws no heading at all as a tab, and still the add button', async () => {
    const fixture = await render({ heading: 'none', canCreate: true });

    expect(query(fixture, 'lib-page-header')).toHaveLength(0);
    expect(query(fixture, '.pane-head')).toHaveLength(0);
    expect(query(fixture, 'h1, h2')).toHaveLength(0);
    expect(texts(fixture, '.tools [data-create]')).toEqual([
      'resource.action.create',
    ]);
  });

  it('keeps the info button on a tab', async () => {
    const fixture = await render({ heading: 'none', info: INFO });

    expect(query(fixture, '.tools lib-info-button')).toHaveLength(1);
    expect(query(fixture, '[data-create]')).toHaveLength(0);
  });

  it('draws nothing above a tab that has neither', async () => {
    const fixture = await render({ heading: 'none' });

    expect(query(fixture, '.tools')).toHaveLength(0);
    expect(query(fixture, 'table')).toHaveLength(1);
  });

  it('emits the create from each of the three', async () => {
    for (const [heading, selector] of [
      ['page', 'lib-page-header .page-actions button'],
      ['pane', '.pane-head [data-create]'],
      ['none', '.tools [data-create]'],
    ] as const) {
      const fixture = await render({ heading, canCreate: true });
      let created = 0;
      fixture.componentInstance.create.subscribe(() => (created += 1));

      query(fixture, selector)[0].click();

      expect(created).toBe(1);
    }
  });

  /** "New" says too little where the resource has a better word: "Add a shop". */
  it('says what the descriptor calls the add button, in all three', async () => {
    for (const heading of ['page', 'pane', 'none'] as const) {
      const fixture = await render({
        heading,
        canCreate: true,
        createKey: 'catalog.shops.add',
      });

      expect(fixture.nativeElement.textContent).toContain('catalog.shops.add');
      expect(fixture.nativeElement.textContent).not.toContain(
        'resource.action.create'
      );
    }
  });
});

const briefed: ResourceRowView[] = [
  {
    ...rows[0],
    brief: { heading: 'Calle Feria 12', line: 'Sevilla 41004', trailing: '3' },
    states: [
      { label: 'catalog.shops.state.ownOrder', tone: 'good' },
      { label: 'catalog.shops.state.guessed', tone: 'waiting' },
    ],
  },
  {
    ...rows[1],
    brief: { heading: 'Avenida del Puerto 1', line: '', trailing: null },
  },
  // No brief at all: the row's title stands in for the heading.
  { id: 'c', title: 'Dia', cells: {}, row: { id: 'c' } },
];

/**
 * A column beside the open row (admin plan 0042): one line per row whatever
 * the width, drawn from the row's `brief`.
 */
describe('ResourceList rows layout', () => {
  it('draws one button per row and neither a table nor cards', async () => {
    for (const compact of [false, true]) {
      const fixture = await render({ layout: 'rows', rows: briefed, compact });

      expect(query(fixture, '[data-row]')).toHaveLength(3);
      expect(query(fixture, 'table')).toHaveLength(0);
      expect(query(fixture, '.card')).toHaveLength(0);
    }
  });

  it('heads a row with its brief heading, and with its title without one', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });

    expect(texts(fixture, '.row-heading')).toEqual([
      'Calle Feria 12',
      'Avenida del Puerto 1',
      'Dia',
    ]);
  });

  it('draws the line and the states under the heading', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });
    const first = query(fixture, '[data-row]')[0];

    expect(first.querySelector('.row-line > span')?.textContent).toBe(
      'Sevilla 41004'
    );
    expect(
      [...first.querySelectorAll('.state-chip')].map((chip) => [
        chip.textContent?.trim(),
        chip.getAttribute('data-tone'),
      ])
    ).toEqual([
      ['catalog.shops.state.ownOrder', 'good'],
      ['catalog.shops.state.guessed', 'waiting'],
    ]);
  });

  it('draws no second line for a row with nothing to say there', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });
    const [, second, third] = [...query(fixture, '[data-row]')];

    expect(second.querySelector('.row-line')).toBeNull();
    expect(third.querySelector('.row-line')).toBeNull();
  });

  /** A number the gateway did not give is not drawn as a zero or a dash. */
  it('draws the trailing number only where the row has one', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });
    const [first, second, third] = [...query(fixture, '[data-row]')];

    expect(first.querySelector('.row-trailing')?.textContent).toBe('3');
    expect(second.querySelector('.row-trailing')).toBeNull();
    expect(third.querySelector('.row-trailing')).toBeNull();
  });

  it('marks the open row as current, and no other', async () => {
    const fixture = await render({
      layout: 'rows',
      rows: briefed,
      currentId: 'b',
    });
    const buttons = [...query(fixture, '[data-row]')];

    expect(
      buttons.map((button) => button.getAttribute('aria-current'))
    ).toEqual([null, 'true', null]);
    expect(
      buttons.map((button) => button.classList.contains('current'))
    ).toEqual([false, true, false]);
  });

  it('marks none while nothing is open', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });

    expect(query(fixture, '[aria-current]')).toHaveLength(0);
  });

  it('opens the row that was pressed', async () => {
    const fixture = await render({ layout: 'rows', rows: briefed });
    const opened: string[] = [];
    fixture.componentInstance.open.subscribe((id) => opened.push(id));

    query(fixture, '[data-row]')[1].click();

    expect(opened).toEqual(['b']);
  });

  /** The open row's own page has the delete, so the column offers none. */
  it('draws no delete on a row', async () => {
    const fixture = await render({
      layout: 'rows',
      rows: briefed,
      canDelete: true,
    });

    expect(fixture.nativeElement.textContent).not.toContain(
      'resource.action.delete'
    );
  });

  it('still says the list is empty in place of the rows', async () => {
    const fixture = await render({ layout: 'rows', rows: [], empty: true });

    expect(query(fixture, '.rows')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('resource.list.empty');
  });
});

/** The states of a row, beside its name in the table and on its card. */
describe('ResourceList state chips', () => {
  const stated: ResourceRowView[] = [
    {
      ...rows[0],
      states: [
        { label: 'catalog.scopes.state.default', tone: 'good' },
        { label: 'catalog.shops.state.map', tone: 'neutral' },
      ],
    },
    rows[1],
  ];

  it('draws them in the first cell of the table, beside the name', async () => {
    const fixture = await render({ rows: stated });
    const [first, second] = [...query(fixture, 'tbody tr')];

    const chips = [...first.querySelectorAll('td:first-child .state-chip')];
    expect(
      chips.map((chip) => [
        chip.textContent?.trim(),
        chip.getAttribute('data-tone'),
      ])
    ).toEqual([
      ['catalog.scopes.state.default', 'good'],
      ['catalog.shops.state.map', 'neutral'],
    ]);
    expect(first.querySelectorAll('.state-chip')).toHaveLength(2);
    expect(second.querySelectorAll('.state-chip')).toHaveLength(0);
  });

  it('draws them beside a name that does not open as well', async () => {
    const fixture = await render({ rows: stated, canOpen: false });

    expect(
      query(fixture, 'tbody tr:first-child td:first-child .state-chip')
    ).toHaveLength(2);
  });

  it('draws them on the card, and no empty line on a card without any', async () => {
    const fixture = await render({ rows: stated, compact: true });
    const [first, second] = [...query(fixture, '.card')];

    expect(
      [...first.querySelectorAll('.states .state-chip')].map((chip) =>
        chip.textContent?.trim()
      )
    ).toEqual(['catalog.scopes.state.default', 'catalog.shops.state.map']);
    expect(second.querySelector('.states')).toBeNull();
  });
});
