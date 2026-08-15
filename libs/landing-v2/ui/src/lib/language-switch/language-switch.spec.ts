import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { switchAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { LANDING_V2_APP_KEY } from '../landing-v2-locales';
import { LanguageSwitch } from './language-switch';

jest.mock('@portfolio/localization/rokutranslator', () => {
  return {
    RokuTranslator: {
      getLocale: jest.fn().mockReturnValue('en'),
    },
  };
});

jest.mock('@portfolio/localization/rokutranslator-angular', () => {
  return {
    switchAppLocale: jest.fn(),
  };
});

describe('LanguageSwitch', () => {
  let fixture: ComponentFixture<LanguageSwitch>;

  beforeEach(async () => {
    jest.clearAllMocks();
    (RokuTranslator.getLocale as jest.Mock).mockReturnValue('en');

    await TestBed.configureTestingModule({
      imports: [LanguageSwitch],
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

    expect(switchAppLocale).toHaveBeenCalledWith(LANDING_V2_APP_KEY, 'es');
  });

  it('does not switch when clicking the already-active locale', () => {
    const host = fixture.nativeElement as HTMLElement;
    const [enButton] = Array.from(
      host.querySelectorAll<HTMLButtonElement>('.language-switch__option')
    );

    enButton.click();

    expect(switchAppLocale).not.toHaveBeenCalled();
  });
});
