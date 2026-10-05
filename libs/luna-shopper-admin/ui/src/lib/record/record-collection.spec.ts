import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { Viewport } from '../viewport';
import {
  RecordCollection,
  type CollectionLink,
  type RecordCollectionRow,
} from './record-collection';

/**
 * A collection of the record, as a panel or as one link (admin plan 0052,
 * section 3.9).
 */

const spellings: readonly RecordCollectionRow[] = [
  {
    id: 'b_2',
    title: 'HACENDADO',
    trailing: '41 products',
    link: ['/', 'brands', 'b_2'],
  },
  { id: 'b_3', title: 'Hacendado S.A.', trailing: null, link: null },
];

const all: CollectionLink = {
  commands: ['/', 'brands'],
  queryParams: { linkedTo: 'b_1' },
};

@Component({
  imports: [RecordCollection],
  template: `
    <lib-record-collection
      (retry)="retries.set(retries() + 1)"
      [all]="all()"
      [count]="count()"
      [emptyKey]="emptyKey()"
      [heading]="'Other spellings'"
      [more]="more()"
      [rows]="rows()"
      [shape]="shape()"
      [status]="status()"
    >
      <button sectionAction type="button">Link a spelling</button>
    </lib-record-collection>
  `,
})
class Host {
  readonly shape = signal<'panel' | 'link'>('panel');
  readonly count = signal<number | null>(null);
  readonly rows = signal<readonly RecordCollectionRow[]>(spellings);
  readonly more = signal(false);
  readonly all = signal<CollectionLink | null>(all);
  readonly emptyKey = signal<string | null>(null);
  readonly status = signal<'loading' | 'ready' | 'error'>('ready');
  readonly retries = signal(0);
}

function render(set: (host: Host) => void = () => undefined, compact = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Host, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      { provide: Viewport, useValue: { compact: signal(compact) } },
    ],
  });

  const fixture = TestBed.createComponent(Host);
  set(fixture.componentInstance);
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

describe('RecordCollection as a panel', () => {
  it('draws the heading, its count and the action of the heading row', () => {
    const { host } = render((panel) => panel.count.set(2));

    expect(host.querySelector('h2')?.textContent?.trim()).toBe(
      'Other spellings'
    );
    expect(host.querySelector('[data-count]')?.textContent?.trim()).toBe('2');
    expect(host.querySelector('.head button')?.textContent?.trim()).toBe(
      'Link a spelling'
    );
  });

  it('draws a row that opens as a link, and one that does not as text', () => {
    const { host } = render();
    const [first, second] = [...host.querySelectorAll('li')];

    expect(first.querySelector('a')?.getAttribute('href')).toBe('/brands/b_2');
    expect(first.textContent).toContain('HACENDADO');
    expect(first.textContent).toContain('41 products');
    expect(first.querySelector('lib-chevron-left-icon')).not.toBeNull();

    expect(second.querySelector('a')).toBeNull();
    expect(second.textContent).toContain('Hacendado S.A.');
    expect(second.querySelector('lib-chevron-left-icon')).toBeNull();
  });

  it('offers no See all while it shows every row', () => {
    expect(render().host.querySelector('[data-see-all]')).toBeNull();
    expect(
      render((panel) => panel.count.set(2)).host.querySelector('[data-see-all]')
    ).toBeNull();
  });

  it('says See all with the count when the list holds more than it shows', () => {
    const link = render((panel) => panel.count.set(12)).host.querySelector(
      '[data-see-all]'
    );

    expect(link?.textContent?.trim()).toBe('record.collection.seeAllCount');
    expect(link?.getAttribute('href')).toBe('/brands?linkedTo=b_1');
  });

  it('says See all alone when there is more and nobody counted', () => {
    expect(
      render((panel) => panel.more.set(true))
        .host.querySelector('[data-see-all]')
        ?.textContent?.trim()
    ).toBe('record.collection.seeAll');
  });

  it('offers no See all with nowhere for it to lead', () => {
    expect(
      render((panel) => {
        panel.more.set(true);
        panel.all.set(null);
      }).host.querySelector('[data-see-all]')
    ).toBeNull();
  });

  it('says the sentence of the collection when it is empty, and None yet without one', () => {
    const named = render((panel) => {
      panel.rows.set([]);
      panel.emptyKey.set('brands.spellings.empty');
    }).host.querySelector('[data-collection-empty]');
    const plain = render((panel) => panel.rows.set([])).host.querySelector(
      '[data-collection-empty]'
    );

    expect(named?.textContent?.trim()).toBe('brands.spellings.empty');
    expect(plain?.textContent?.trim()).toBe('record.collection.none');
  });

  it('says it is loading, and draws no row yet', () => {
    const { host } = render((panel) => panel.status.set('loading'));
    const line = host.querySelector('[data-collection-loading]');

    expect(line?.getAttribute('aria-busy')).toBe('true');
    expect(line?.textContent?.trim()).toBe('record.collection.loading');
    expect(host.querySelector('li')).toBeNull();
  });

  it('says the read failed, and asks again when the operator does', () => {
    const { fixture, host } = render((panel) => panel.status.set('error'));
    const line = host.querySelector('[data-collection-error]');

    expect(line?.getAttribute('role')).toBe('alert');
    expect(line?.textContent).toContain('record.collection.failed');

    line?.querySelector('button')?.click();

    expect(fixture.componentInstance.retries()).toBe(1);
  });
});

describe('RecordCollection as one link', () => {
  const link = (panel: Host) => panel.shape.set('link');

  it('is one row with the heading and the count, which opens the list', () => {
    const { host } = render((panel) => {
      link(panel);
      panel.count.set(41);
    });
    const row = host.querySelector('[data-collection-link]');

    expect(row?.tagName).toBe('A');
    expect(row?.getAttribute('href')).toBe('/brands?linkedTo=b_1');
    expect(row?.textContent).toContain('Other spellings');
    expect(row?.querySelector('[data-count]')?.textContent?.trim()).toBe('41');
    expect(host.querySelector('li')).toBeNull();
  });

  it('draws no count when it is given none', () => {
    const { host } = render(link);

    expect(host.querySelector('[data-collection-link]')).not.toBeNull();
    expect(host.querySelector('[data-count]')).toBeNull();
  });

  it('says None yet when it is empty, and is not a link', () => {
    const { host } = render((panel) => {
      link(panel);
      panel.count.set(0);
    });

    expect(host.querySelector('a')).toBeNull();
    expect(
      host.querySelector('[data-collection-empty]')?.textContent
    ).toContain('record.collection.none');
  });

  it('is not a link with nowhere to lead', () => {
    const { host } = render((panel) => {
      link(panel);
      panel.count.set(41);
      panel.all.set(null);
    });

    expect(host.querySelector('a')).toBeNull();
    expect(host.querySelector('[data-count]')?.textContent?.trim()).toBe('41');
  });
});

describe('RecordCollection on a phone', () => {
  it('draws a panel as the link shape: one row that opens the list', () => {
    const { host } = render((panel) => panel.count.set(12), true);

    expect(host.querySelector('[data-collection-link]')).not.toBeNull();
    expect(host.querySelector('li')).toBeNull();
    expect(host.querySelector('lib-record-section')).toBeNull();
  });

  it('says None yet for a panel that was read and holds nothing', () => {
    const { host } = render((panel) => panel.rows.set([]), true);

    expect(host.querySelector('a')).toBeNull();
    expect(
      host.querySelector('[data-collection-empty]')?.textContent
    ).toContain('record.collection.none');
  });
});
