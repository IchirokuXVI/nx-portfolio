import { CommonModule } from '@angular/common';
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
import { LogoBrand } from '../logoBrand/logoBrand';

export type HeaderBreakpoints = {
  [key in HeaderBreakpointKeys]: number;
};

const DEFAULT_LANGUAGE = 'en';
export const DEFAULT_HEADER_BREAKPOINT = '-16';

export enum HeaderBreakpointKeys {
  MOBILE_DROPDOWN = 'mobileDropdown',
  DESKTOP = 'desktop',
}

const HeaderBreakpointDefaultValues = {
  [HeaderBreakpointKeys.MOBILE_DROPDOWN]: 1600,
  [HeaderBreakpointKeys.DESKTOP]: Number.MAX_SAFE_INTEGER,
};

const HeaderBreakpointClasses = {
  [HeaderBreakpointKeys.MOBILE_DROPDOWN]: 'mobile-version',
  [HeaderBreakpointKeys.DESKTOP]: 'desktop-version',
};

@Component({
  selector: 'lib-damoclesSword-main-header',
  imports: [
    CommonModule,
    RouterModule,
    LanguageSelector,
    RokuTranslatorPipe,
    LogoBrand,
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
    [HeaderBreakpointKeys.MOBILE_DROPDOWN]:
      HeaderBreakpointDefaultValues[HeaderBreakpointKeys.MOBILE_DROPDOWN],
    [HeaderBreakpointKeys.DESKTOP]:
      HeaderBreakpointDefaultValues[HeaderBreakpointKeys.DESKTOP],
  });

  showNavMenu = signal(false);
  currentBreakpoint = signal<HeaderBreakpointKeys>(
    HeaderBreakpointKeys.DESKTOP
  );

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
    const configuredBreakpoints = this.breakpoints();
    let breakpointToSet: HeaderBreakpointKeys | undefined;

    for (const [key, value] of Object.entries(configuredBreakpoints)) {
      const breakpointValue = value;

      const matchesBreakpoint = entry.contentRect.width <= breakpointValue;
      const isLowerThanPreviousMatch =
        !breakpointToSet ||
        breakpointValue < configuredBreakpoints[breakpointToSet];

      if (matchesBreakpoint && isLowerThanPreviousMatch) {
        breakpointToSet = key as HeaderBreakpointKeys;
      }
    }

    console.log(breakpointToSet);

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
