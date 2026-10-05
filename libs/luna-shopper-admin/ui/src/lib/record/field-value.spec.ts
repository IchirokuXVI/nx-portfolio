import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { RecordValue } from '@portfolio/luna-shopper-admin/models';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScopeMark } from '../page/scope-mark';
import { FieldValue, NAME_UNREAD, NAMED_LANGUAGES } from './field-value';

/**
 * One value while the page reads (admin plan 0052, section 3.2). The testing
 * translator answers the key, so a word is asserted by its key.
 */

function render(value: RecordValue, inputs: Record<string, unknown> = {}) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [FieldValue, RokuTranslatorTestingModule.forTesting()],
    providers: [provideRouter([])],
  });

  const fixture = TestBed.createComponent(FieldValue);
  fixture.componentRef.setInput('value', value);
  for (const [name, held] of Object.entries(inputs)) {
    fixture.componentRef.setInput(name, held);
  }
  fixture.detectChanges();

  return { fixture, host: fixture.nativeElement as HTMLElement };
}

function text(host: HTMLElement): string {
  return host.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

describe('FieldValue', () => {
  it('reads an empty value as None, in the muted ink', () => {
    const { host } = render({ kind: 'none' });

    expect(host.querySelector('[data-none]')?.textContent?.trim()).toBe(
      'resource.value.none'
    );
    expect(host.querySelector('[data-none]')?.classList).toContain('none');
  });

  it('draws text, and a code in the mono face', () => {
    expect(text(render({ kind: 'text', text: 'Sevilla' }).host)).toBe(
      'Sevilla'
    );
    expect(
      render({ kind: 'text', text: 'Sevilla' }).host.querySelector('.mono')
    ).toBeNull();
    expect(
      render({
        kind: 'text',
        text: '8480000',
        mono: true,
      }).host.querySelector('.mono')?.textContent
    ).toBe('8480000');
  });

  it('draws a word through the translator, with what it carries', () => {
    expect(text(render({ kind: 'word', key: 'resource.value.yes' }).host)).toBe(
      'resource.value.yes'
    );
  });

  it('draws an address as a link that cannot reach back', () => {
    const link = render({
      kind: 'link',
      text: 'https://dia.es',
      href: 'https://dia.es',
    }).host.querySelector('a');

    expect(link?.getAttribute('href')).toBe('https://dia.es');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link?.textContent?.trim()).toBe('https://dia.es');
  });

  it('draws the words of a link in place of its address, where it has them', () => {
    const link = render({
      kind: 'link',
      text: 'https://osm.test/1',
      href: 'https://osm.test/1',
      label: 'shops.openOnMap',
    }).host.querySelector('a');

    expect(link?.getAttribute('href')).toBe('https://osm.test/1');
    expect(link?.textContent?.trim()).toBe('shops.openOnMap');
  });

  it('draws a picture with an empty alt beside its address, which is a link', () => {
    const { host } = render({ kind: 'image', src: 'https://cdn/x.png' });
    const picture = host.querySelector('img');

    expect(picture?.getAttribute('src')).toBe('https://cdn/x.png');
    expect(picture?.getAttribute('alt')).toBe('');
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      'https://cdn/x.png'
    );
  });

  it('keeps the grey square and the link when the picture does not load', () => {
    const { fixture, host } = render({
      kind: 'image',
      src: 'https://cdn/x.png',
    });

    host.querySelector('img')?.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('.thumb')).not.toBeNull();
    expect(host.querySelector('a')?.getAttribute('href')).toBe(
      'https://cdn/x.png'
    );

    // Another address is another picture, and is tried.
    fixture.componentRef.setInput('value', {
      kind: 'image',
      src: 'https://cdn/y.png',
    });
    fixture.detectChanges();
    expect(host.querySelector('img')?.getAttribute('src')).toBe(
      'https://cdn/y.png'
    );
  });

  it('draws one line for each language, and says which is not written', () => {
    const { host } = render({
      kind: 'lines',
      lines: [
        { locale: 'es', text: 'Leche entera' },
        { locale: 'en', text: null },
      ],
    });
    const lines = [...host.querySelectorAll('.line')];

    expect(lines).toHaveLength(2);
    expect(lines[0].querySelector('.lang')?.textContent).toBe('es');
    expect(lines[0].querySelector('.lang')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    // The language in words, for a screen reader.
    expect(lines[0].querySelector('.sr-only')?.textContent).toBe(
      'record.language.es'
    );
    expect(lines[0].querySelector('.text')?.textContent).toBe('Leche entera');
    expect(lines[0].querySelector('.text')?.getAttribute('lang')).toBe('es');
    expect(
      lines[1].querySelector('[data-not-written]')?.textContent?.trim()
    ).toBe('record.value.notWritten');
  });

  /** A key that has no text would be read out as the key. */
  it('says the code of a language that has no word', () => {
    const { host } = render({
      kind: 'lines',
      lines: [{ locale: 'pt', text: 'Leite gordo' }],
    });

    expect(host.querySelector('.line .sr-only')?.textContent?.trim()).toBe(
      'pt'
    );
  });

  it('names exactly the languages the catalogue has a word for', () => {
    const catalogue = JSON.parse(
      readFileSync(
        join(__dirname, '..', '..', '..', 'assets', 'i18n', 'en.json'),
        'utf8'
      )
    ) as { record: { language: Record<string, string> } };

    expect([...NAMED_LANGUAGES].sort()).toEqual(
      Object.keys(catalogue.record.language).sort()
    );
  });

  it('prints an object as it was printed for it', () => {
    expect(
      render({ kind: 'json', text: '{\n  "a": 1\n}' }).host.querySelector('pre')
        ?.textContent
    ).toBe('{\n  "a": 1\n}');
  });

  it('draws the amber state after the value', () => {
    const { host } = render({
      kind: 'text',
      text: 'Sevilla',
      check: { label: 'shops.check.guessed' },
    });

    expect(host.querySelector('[data-check]')?.textContent?.trim()).toBe(
      'shops.check.guessed'
    );
    expect(host.lastElementChild?.hasAttribute('data-check')).toBe(true);
    expect(host.firstElementChild?.textContent).toBe('Sevilla');
  });

  it('draws the mark of a scope before the value, named by its kind', () => {
    const { fixture } = render({
      kind: 'text',
      text: 'Córdoba',
      scope: { level: 2, label: 'scopes.kind.REGION' },
    });
    const mark: ScopeMark = fixture.debugElement.query(
      By.directive(ScopeMark)
    ).componentInstance;

    expect(mark.level()).toBe(2);
    expect(mark.label()).toBe('scopes.kind.REGION');
    expect(
      (fixture.nativeElement as HTMLElement).firstElementChild?.tagName
    ).toBe('LIB-SCOPE-MARK');
  });

  it('does not name the mark again when the value is the word for the kind', () => {
    const { fixture } = render({
      kind: 'word',
      key: 'scopes.kind.REGION',
      scope: { level: 2, label: 'scopes.kind.REGION' },
    });

    expect(
      fixture.debugElement
        .query(By.directive(ScopeMark))
        .componentInstance.label()
    ).toBe('');
  });
});

describe('FieldValue for one reference', () => {
  const brand: RecordValue = {
    kind: 'reference',
    resource: 'brands',
    id: 'b_1',
    name: 'Hacendado',
  };
  const unnamed: RecordValue = { ...brand, name: null };

  it('draws the name the value carries, as text when it has nowhere to go', () => {
    const { host } = render(brand);

    expect(text(host)).toBe('Hacendado');
    expect(host.querySelector('a')).toBeNull();
  });

  it('draws the name as a link when the page says where it leads', () => {
    const link = render(brand, {
      link: ['/', 'brands', 'b_1'],
    }).host.querySelector('a');

    expect(link?.textContent?.trim()).toBe('Hacendado');
    expect(link?.getAttribute('href')).toBe('/brands/b_1');
  });

  it('draws the name the page resolved for a value that carries none', () => {
    expect(text(render(unnamed, { name: 'Hacendado' }).host)).toBe('Hacendado');
    expect(text(render(unnamed, { names: { b_1: 'Hacendado' } }).host)).toBe(
      'Hacendado'
    );
  });

  it('says the name is being read, and never shows the ID in its place', () => {
    const { host } = render(unnamed);

    expect(host.querySelector('[data-resolving]')?.textContent?.trim()).toBe(
      'resource.reference.resolving'
    );
    expect(text(host)).not.toContain('b_1');
  });

  it('says so for a record that is gone, and never shows the ID', () => {
    const { host } = render(unnamed, { names: { b_1: null } });

    expect(host.querySelector('[data-gone]')?.textContent?.trim()).toBe(
      'record.value.gone'
    );
    expect(text(host)).not.toContain('b_1');
  });

  /** A read that failed has not said the record is gone. */
  it('says the name could not be read, and never "gone", when the read failed', () => {
    const { host } = render(unnamed, { names: { b_1: NAME_UNREAD } });

    expect(host.querySelector('[data-gone]')).toBeNull();
    expect(host.querySelector('[data-unread]')?.textContent?.trim()).toBe(
      'record.value.unread'
    );
    expect(text(host)).not.toContain('b_1');
  });

  it('keeps the link of a name it could not read', () => {
    const { host } = render(unnamed, {
      names: { b_1: NAME_UNREAD },
      link: ['/brands', 'b_1'],
    });

    expect(host.querySelector('a[data-unread]')?.getAttribute('href')).toBe(
      '/brands/b_1'
    );
  });

  it('says the same on one of several references', () => {
    const { host } = render(
      { kind: 'references', resource: 'categories', ids: ['c_1', 'c_2'] },
      { names: { c_1: NAME_UNREAD, c_2: null } }
    );
    const lines = [...host.querySelectorAll('li')];

    expect(lines[0].querySelector('[data-unread]')).not.toBeNull();
    expect(lines[0].querySelector('[data-gone]')).toBeNull();
    expect(lines[1].querySelector('[data-gone]')).not.toBeNull();
  });
});

describe('FieldValue for several references', () => {
  const categories: RecordValue = {
    kind: 'references',
    resource: 'categories',
    ids: ['c_1', 'c_2', 'c_3'],
    ordered: true,
  };
  const names = { c_1: 'Lácteos, Leche', c_2: null };

  it('draws one line for each, in the order of the row', () => {
    const { host } = render(categories, { names });
    const lines = [...host.querySelectorAll('li')];

    expect(lines).toHaveLength(3);
    expect(lines[0].textContent).toContain('Lácteos, Leche');
    expect(lines[1].querySelector('[data-gone]')).not.toBeNull();
    expect(lines[2].querySelector('[data-resolving]')).not.toBeNull();
    expect(text(host)).not.toMatch(/c_[123]/);
  });

  it('says Main on the first where the order counts, and nowhere where it does not', () => {
    const ordered = render(categories, { names }).host;
    const marks = [...ordered.querySelectorAll('li')].map(
      (line) => line.querySelector('[data-main]') !== null
    );

    expect(marks).toEqual([true, false, false]);
    expect(
      render({ ...categories, ordered: false }, { names }).host.querySelector(
        '[data-main]'
      )
    ).toBeNull();
  });

  it('links only the ones the page gave a place to go', () => {
    const { host } = render(categories, {
      names: { ...names, c_3: 'Desayuno, Leche' },
      links: { c_1: ['/', 'categories', 'c_1'] },
    });
    const lines = [...host.querySelectorAll('li')];

    expect(lines[0].querySelector('a')?.getAttribute('href')).toBe(
      '/categories/c_1'
    );
    expect(lines[2].querySelector('a')).toBeNull();
    expect(lines[2].textContent).toContain('Desayuno, Leche');
  });

  /** Admin plan 0056, section 2: how far each price scope reaches. */
  it('draws the mark the page gave before a target, and none before the others', () => {
    const { fixture, host } = render(categories, {
      names: { ...names, c_3: 'Desayuno, Leche' },
      marks: { c_1: { level: 2, label: 'scope.kind.region' } },
    });
    const lines = [...host.querySelectorAll('li')];
    const marks = fixture.debugElement.queryAll(By.directive(ScopeMark));

    expect(marks).toHaveLength(1);
    expect(lines[0].firstElementChild?.tagName.toLowerCase()).toBe(
      'lib-scope-mark'
    );
    expect((marks[0].componentInstance as ScopeMark).level()).toBe(2);
    expect((marks[0].componentInstance as ScopeMark).label()).toBe(
      'scope.kind.region'
    );
    expect(lines[1].querySelector('lib-scope-mark')).toBeNull();
  });
});
