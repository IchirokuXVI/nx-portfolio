import { AsyncPipe } from '@angular/common';
import { Component, input, output } from '@angular/core';
import { RouterModule } from '@angular/router';
import { LanguageSelector } from '../language-selector/language-selector';

@Component({
  selector: 'lib-damoclesSword-main-header',
  imports: [AsyncPipe, RouterModule, LanguageSelector],
  templateUrl: './main-header.html',
  styleUrl: './main-header.scss',
})
export class MainHeader {
  // @ts-expect-error TypeScript cannot resolve dynamic imports with relative paths in module federation setup
  damoclesLogo = import(`../../../assets/damoclesSwordLogo.svg`).then(
    (m) => m.default
  );

  languages = input<string[]>([]);
  selectedLanguage = input<string>('en');
  languageChange = output<string>();
}
