import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { readFileSync } from 'fs';
import { join } from 'path';
import { CallToActionButton } from './call-to-action-button';

@Component({
  imports: [CallToActionButton],
  template: `<lib-damocles-sword-call-to-action-button [link]="link"
    >Projected label</lib-damocles-sword-call-to-action-button
  >`,
})
class HostComponent {
  link: string | unknown[] = [];
}

describe('CallToActionButton', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  it('projects its label content', () => {
    const host = fixture.nativeElement as HTMLElement;
    expect(
      host.querySelector('.call-to-action-button')?.textContent?.trim()
    ).toBe('Projected label');
  });

  /**
   * jsdom does not apply component stylesheets, so the resolved colour can't be
   * read off the element. Instead we verify the theming contract: the
   * stylesheet consumes the custom properties with fallbacks, and they are
   * overridable on the host.
   */
  describe('themeable css variables', () => {
    const scss = readFileSync(
      join(__dirname, 'call-to-action-button.scss'),
      'utf-8'
    );

    it('drives the background from --call-to-action-bg with a fallback', () => {
      expect(scss).toMatch(
        /background-color:\s*var\(\s*--call-to-action-bg\s*,/
      );
    });

    it('drives the accent from --call-to-action-accent with a fallback', () => {
      expect(scss).toMatch(/var\(\s*--call-to-action-accent\s*,/);
    });

    it('lets consumers override the background and accent on the host', () => {
      const el = (fixture.nativeElement as HTMLElement).querySelector(
        'lib-damocles-sword-call-to-action-button'
      ) as HTMLElement;

      el.style.setProperty('--call-to-action-bg', 'rgb(1, 2, 3)');
      el.style.setProperty('--call-to-action-accent', 'rgb(4, 5, 6)');

      expect(
        getComputedStyle(el).getPropertyValue('--call-to-action-bg').trim()
      ).toBe('rgb(1, 2, 3)');
      expect(
        getComputedStyle(el).getPropertyValue('--call-to-action-accent').trim()
      ).toBe('rgb(4, 5, 6)');
    });
  });
});
