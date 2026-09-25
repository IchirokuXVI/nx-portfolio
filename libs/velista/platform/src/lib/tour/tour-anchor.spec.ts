import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TourAnchor } from './tour-anchor';
import { TourAnchors } from './tour-anchors';
import type { TourAnchorId } from './tour-stops';

@Component({
  imports: [TourAnchor],
  template: `
    @if (shown()) {
      <nav [libTourAnchor]="id()" data-testid="first">bar</nav>
    }
    @if (twice()) {
      <div libTourAnchor="nav" data-testid="second">again</div>
    }
  `,
})
class Host {
  readonly shown = signal(true);
  readonly twice = signal(false);
  readonly id = signal<TourAnchorId | null>('nav');
}

function render() {
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  const element = (id: string): HTMLElement =>
    (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${id}"]`
    ) as HTMLElement;

  return {
    fixture,
    host: fixture.componentInstance,
    anchors: TestBed.inject(TourAnchors),
    element,
  };
}

describe('TourAnchor', () => {
  it('registers its element on init', () => {
    const { anchors, element } = render();

    expect(anchors.elements().get('nav')).toBe(element('first'));
  });

  it('removes it on destroy', () => {
    const { fixture, host, anchors } = render();

    host.shown.set(false);
    fixture.detectChanges();

    expect(anchors.elements().has('nav')).toBe(false);
  });

  it('declares nothing for null, and follows an id that changes', () => {
    const { fixture, host, anchors, element } = render();

    host.id.set(null);
    fixture.detectChanges();
    expect(anchors.elements().size).toBe(0);

    host.id.set('groups');
    fixture.detectChanges();
    expect(anchors.elements().get('groups')).toBe(element('first'));
  });

  it('refuses a second element with the same id, loudly, and keeps the first', () => {
    const error = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { fixture, host, anchors, element } = render();

    host.twice.set(true);
    fixture.detectChanges();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('"nav"'));
    expect(anchors.elements().get('nav')).toBe(element('first'));

    // The refused one going away must not take the first one's registration with it.
    host.twice.set(false);
    fixture.detectChanges();
    expect(anchors.elements().get('nav')).toBe(element('first'));
    error.mockRestore();
  });

  it('is hidden from assistive technology while its card is up, and only then', () => {
    const { fixture, anchors, element } = render();
    expect(element('first').getAttribute('aria-hidden')).toBeNull();

    anchors.light('nav');
    fixture.detectChanges();
    expect(element('first').getAttribute('aria-hidden')).toBe('true');

    anchors.light(null);
    fixture.detectChanges();
    expect(element('first').getAttribute('aria-hidden')).toBeNull();
  });

  it('hands a waiting stop the element the moment it registers', async () => {
    const anchors = TestBed.inject(TourAnchors);
    const waiting = anchors.whenRegistered('assistant', 1000);
    const element = document.createElement('button');

    anchors.register('assistant', element);

    await expect(waiting).resolves.toBe(element);
  });
});
