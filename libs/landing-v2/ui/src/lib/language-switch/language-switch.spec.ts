import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RokuLocaleStore } from '@portfolio/localization/rokutranslator-angular';
import { LANDING_V2_APP_KEY } from '../landing-v2-locales';
import { LanguageSwitch } from './language-switch';

describe('LanguageSwitch', () => {
  let fixture: ComponentFixture<LanguageSwitch>;
  let localeStore: { locale: ReturnType<typeof signal<string>>; switchAppLocale: jest.Mock };

  beforeEach(async () => {
    localeStore = {
      locale: signal('en'),
      switchAppLocale: jest.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [LanguageSwitch],
      providers: [{ provide: RokuLocaleStore, useValue: localeStore }],
    }).compileComponents();

    fixture = TestBed.createComponent(LanguageSwitch);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('renders an en and es option, marking the current locale active', () => {
    const host = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.language-switch__option')
    );

    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'en',
      'es',
    ]);
    expect(buttons[0].getAttribute('aria-pressed')).toBe('true');
    expect(buttons[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('switches the app locale when a different option is clicked', () => {
    const host = fixture.nativeElement as HTMLElement;
    const [, esButton] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.language-switch__option')
    );

    esButton.click();

    expect(localeStore.switchAppLocale).toHaveBeenCalledWith(
      LANDING_V2_APP_KEY,
      'es'
    );
  });

  it('does not switch when clicking the already-active locale', () => {
    const host = fixture.nativeElement as HTMLElement;
    const [enButton] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.language-switch__option')
    );

    enButton.click();

    expect(localeStore.switchAppLocale).not.toHaveBeenCalled();
  });
});
