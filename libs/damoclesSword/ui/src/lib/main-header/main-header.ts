import { AsyncPipe, CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { RouterModule } from '@angular/router';
import {
  RokuTranslatorPipe,
  RokuTranslatorService,
} from '@portfolio/localization/rokutranslator-angular';
import { LanguageSelector } from '../language-selector/language-selector';

export interface HeaderBreakpoints {
  mobileDropdown?: string;
}

const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_HEADER_BREAKPOINT = '-16';
const MOBILE_DROPDOWN_BREAKPOINT = '1600px';

enum HeaderBreakpointKeys {
  MOBILE_DROPDOWN = 'mobileDropdown',
}

const HeaderBreakpointDefaultValues = {
  [HeaderBreakpointKeys.MOBILE_DROPDOWN]: '1600px',
};

const HeaderBreakpointClasses = {
  [HeaderBreakpointKeys.MOBILE_DROPDOWN]: 'mobile-version',
};

@Component({
  selector: 'lib-damoclesSword-main-header',
  imports: [
    CommonModule,
    AsyncPipe,
    RouterModule,
    LanguageSelector,
    RokuTranslatorPipe,
  ],
  templateUrl: './main-header.html',
  styleUrl: './main-header.scss',
})
export class MainHeader {
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );

  compReady = signal(false);

  languages = input<string[]>([]);
  selectedLanguage = input<string>(DEFAULT_LANGUAGE);
  languageChange = output<string>();

  navLinks = input<{ label: string; url: string[] }[]>([]);

  breakpoints = input<HeaderBreakpoints>({
    [HeaderBreakpointKeys.MOBILE_DROPDOWN]: MOBILE_DROPDOWN_BREAKPOINT,
  });

  showNavMenu = signal(false);

  private _rokuTranslatorServ = inject(RokuTranslatorService);
  private _resizeObserver = new ResizeObserver((entries) =>
    this._onResize(entries[0])
  );
  private _elementRef = inject(ElementRef);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }

  ngOnInit() {
    this._resizeObserver.observe(this._elementRef.nativeElement);
  }

  ngOnDestroy() {
    this._resizeObserver.disconnect();
  }

  toggleNavMenu() {
    this.showNavMenu.update((show) => !show);
  }

  private _onResize(entry: ResizeObserverEntry) {
    // Undefined would be the default design (desktop)
    let breakpointToSet: HeaderBreakpointKeys | undefined;

    for (const [key, value] of Object.entries(this.breakpoints())) {
      const breakpointValue = parseInt(value);
      if (entry.contentRect.width <= breakpointValue) {
        breakpointToSet = key as HeaderBreakpointKeys;
        break; // Stop at the first matching breakpoint
      }
    }

    this._switchBreakpointClass(breakpointToSet);
  }

  private _switchBreakpointClass(breakpointKey?: HeaderBreakpointKeys) {
    if (breakpointKey) {
      const className = HeaderBreakpointClasses[breakpointKey];
      this._elementRef.nativeElement.classList.add(className);
    }

    // Remove other breakpoint classes
    for (const [key, otherClass] of Object.entries(HeaderBreakpointClasses)) {
      if (key !== breakpointKey && otherClass) {
        this._elementRef.nativeElement.classList.remove(otherClass);
      }
    }
  }
}
