import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LinkedText, linkedParts } from './linked-text';

describe('linkedParts (velista 0173)', () => {
  it('cuts a sentence at its bracketed link', () => {
    expect(linkedParts('I accept the [Terms]')).toEqual({
      before: 'I accept the ',
      link: 'Terms',
      after: '',
    });
    expect(linkedParts('The [Terms] changed while this page was open')).toEqual(
      {
        before: 'The ',
        link: 'Terms',
        after: ' changed while this page was open',
      }
    );
  });

  it('draws a sentence with no pair, or a broken one, as text', () => {
    expect(linkedParts('No link here')).toEqual({
      before: 'No link here',
      link: null,
      after: '',
    });
    expect(linkedParts('Broken [link')).toEqual({
      before: 'Broken [link',
      link: null,
      after: '',
    });
    expect(linkedParts('Empty []')).toEqual({
      before: 'Empty []',
      link: null,
      after: '',
    });
  });
});

describe('LinkedText', () => {
  function render(text: string) {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(LinkedText);
    fixture.componentRef.setInput('text', text);
    fixture.componentRef.setInput('href', '/en/terms');
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('draws the words around one link, with no injected markup', () => {
    const host = render('I accept the [<b>Terms</b>]');

    const link = host.querySelector('a');
    expect(link?.textContent).toBe('<b>Terms</b>');
    expect(link?.getAttribute('href')).toBe('/en/terms');
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent?.trim()).toBe('I accept the <b>Terms</b>');
  });

  it('draws no space the sentence does not have, around the link', () => {
    const host = render('Hemos cambiado las [Condiciones]. Léelas');

    expect(host.textContent).toBe('Hemos cambiado las Condiciones. Léelas');
  });

  it('draws no link for a sentence that names none', () => {
    const host = render('Nothing to open');

    expect(host.querySelector('a')).toBeNull();
    expect(host.textContent?.trim()).toBe('Nothing to open');
  });
});
