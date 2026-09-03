import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type {
  FieldDescriptor,
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
    rows: readonly ResourceRowView[];
  }> = {}
): Promise<ComponentFixture<ResourceList>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [ResourceList, RokuTranslatorTestingModule.forTesting()],
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
