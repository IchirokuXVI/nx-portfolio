import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  CATEGORY_TREE_ALL,
  CATEGORY_TREE_NONE,
  CategoryTree,
  type CategoryTreeNode,
} from './category-tree';

/**
 * The category tree that narrows the product list (admin plan 0043, target
 * 2). Presentational: it is handed nodes and says which one was pressed.
 */

const NODES: readonly CategoryTreeNode[] = [
  {
    id: 'dairy',
    name: 'Dairy and eggs',
    count: 3410,
    children: [
      { id: 'milk', name: 'Milk', count: 412, children: [] },
      { id: 'eggs', name: 'Eggs', count: null, children: [] },
    ],
  },
  { id: 'drinks', name: 'Drinks', count: 0, children: [] },
];

async function render(
  inputs: Partial<{
    selected: string;
    allCount: number | null;
    showNone: boolean;
  }> = {}
) {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [CategoryTree, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(CategoryTree);
  fixture.componentRef.setInput('nodes', NODES);
  fixture.componentRef.setInput('label', 'Categories');
  for (const [name, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, value);
  }
  const chosen: string[] = [];
  fixture.componentInstance.choose.subscribe((id) => chosen.push(id));
  fixture.detectChanges();
  await Promise.resolve();
  fixture.detectChanges();
  return { fixture, chosen };
}

const entry = (fixture: ComponentFixture<CategoryTree>, id: string) =>
  fixture.nativeElement.querySelector(
    `[data-category="${id}"]`
  ) as HTMLButtonElement | null;

describe('CategoryTree', () => {
  it('is a navigation with every product first and no category last', async () => {
    const { fixture } = await render();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('nav')?.getAttribute('aria-label')).toBe(
      'Categories'
    );
    const ids = [...element.querySelectorAll('[data-category]')].map((node) =>
      node.getAttribute('data-category')
    );
    // The children are not drawn until their category is opened.
    expect(ids).toEqual([CATEGORY_TREE_ALL, 'dairy', 'drinks', 'none']);
    expect(element.textContent).toContain('catalog.categoryTree.all');
    expect(element.textContent).toContain('catalog.categoryTree.none');
  });

  it('draws the count the gateway gave, and none where it gave none', async () => {
    const { fixture } = await render();

    expect(entry(fixture, 'dairy')?.textContent).toContain('3,410');
    // A zero is a count that was given.
    expect(entry(fixture, 'drinks')?.querySelector('.count')?.textContent).toBe(
      '0'
    );
    // Nobody counted every product, so "All products" says no number.
    expect(
      entry(fixture, CATEGORY_TREE_ALL)?.querySelector('.count')
    ).toBeNull();
    // And "No category" never has one.
    expect(entry(fixture, 'none')?.querySelector('.count')).toBeNull();

    fixture.componentInstance.toggle('dairy');
    fixture.detectChanges();
    expect(entry(fixture, 'eggs')?.querySelector('.count')).toBeNull();
  });

  it('says how many products there are when it is told', async () => {
    const { fixture } = await render({ allCount: 48210 });

    expect(entry(fixture, CATEGORY_TREE_ALL)?.textContent).toContain('48,210');
  });

  it('chooses a category when its name is pressed, and opens it', async () => {
    const { fixture, chosen } = await render();

    entry(fixture, 'dairy')?.click();
    fixture.detectChanges();

    expect(chosen).toEqual(['dairy']);
    expect(entry(fixture, 'milk')).not.toBeNull();

    entry(fixture, 'milk')?.click();
    expect(chosen).toEqual(['dairy', 'milk']);
  });

  it('opens and closes a category by its chevron, without choosing it', async () => {
    const { fixture, chosen } = await render();
    const twist = fixture.nativeElement.querySelector(
      'button.twist'
    ) as HTMLButtonElement;

    expect(twist.getAttribute('aria-expanded')).toBe('false');
    twist.click();
    fixture.detectChanges();

    expect(twist.getAttribute('aria-expanded')).toBe('true');
    expect(entry(fixture, 'milk')).not.toBeNull();
    expect(chosen).toEqual([]);

    twist.click();
    fixture.detectChanges();
    expect(entry(fixture, 'milk')).toBeNull();
  });

  /** A category with nothing inside it has nothing to open. */
  it('draws no chevron on a category that holds no other', async () => {
    const { fixture } = await render();

    expect(fixture.nativeElement.querySelectorAll('button.twist')).toHaveLength(
      1
    );
  });

  it('chooses every product and no category by the two constants', async () => {
    const { fixture, chosen } = await render({ selected: 'dairy' });

    entry(fixture, 'none')?.click();
    entry(fixture, CATEGORY_TREE_ALL)?.click();

    expect(chosen).toEqual([CATEGORY_TREE_NONE, CATEGORY_TREE_ALL]);
  });

  it('marks what is chosen as current', async () => {
    const { fixture } = await render({ selected: 'drinks' });

    expect(entry(fixture, 'drinks')?.getAttribute('aria-current')).toBe('true');
    expect(
      entry(fixture, CATEGORY_TREE_ALL)?.getAttribute('aria-current')
    ).toBeNull();
  });

  /** A list opened already narrowed to "Milk" shows "Dairy" open. */
  it('opens the category that holds what is chosen', async () => {
    const { fixture } = await render({ selected: 'milk' });

    expect(entry(fixture, 'milk')?.getAttribute('aria-current')).toBe('true');
  });

  it('offers no "No category" where it is told not to', async () => {
    const { fixture } = await render({ showNone: false });

    expect(entry(fixture, 'none')).toBeNull();
  });
});
