import { AsyncPipe, CommonModule } from '@angular/common';
import {
  Component,
  HostBinding,
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

export const DEFAULT_HEADER_BREAKPOINT = '-16';

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
  selectedLanguage = input<string>('en');
  languageChange = output<string>();

  navLinks = input<{ label: string; url: string[] }[]>([]);

  breakpoints = input<HeaderBreakpoints>({
    mobileDropdown: '1600px',
  });

  showNavMenu = signal(false);

  _rokuTranslatorServ = inject(RokuTranslatorService);

  @HostBinding('style.--damoclesSword-header-bp-mobile-dropdown')
  get mobileDropdownBp() {
    return this.breakpoints().mobileDropdown || '1600px';
  }

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }

  toggleNavMenu() {
    this.showNavMenu.update((show) => !show);
  }
}
