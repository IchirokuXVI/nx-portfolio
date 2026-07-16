import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  contentChild,
  inject,
  input,
  output,
  signal,
  TemplateRef,
} from '@angular/core';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';
import { FooterLogo } from '../footer-logo/footer-logo';
import { FooterMain } from '../footer-main/footer-main';
import { MainHeader } from '../main-header/main-header';
import { LayoutContent } from './layout-content';

@Component({
  selector: 'lib-damoclesSword-layout',
  imports: [MainHeader, FooterLogo, FooterMain, NgTemplateOutlet],
  templateUrl: './layout.html',
  styleUrl: './layout.scss',
})
export class Layout {
  languages = input<string[]>([]);
  selectedLanguage = input<string>('en');
  navLinks = input<{ label: string; url: string[] }[]>([]);
  languageChange = output<string>();

  // Routed content is passed as a deferred template (marked with the
  // LayoutContent directive) so it is only instantiated once translations
  // are loaded (see the @if below); otherwise its pure translate pipes
  // would render before load.
  content = contentChild(LayoutContent, { read: TemplateRef });

  compReady = signal(false);
  private _rokuTranslatorServ = inject(RokuTranslatorService);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }
}
