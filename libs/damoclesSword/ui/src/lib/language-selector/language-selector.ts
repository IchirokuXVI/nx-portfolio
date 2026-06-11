import { AsyncPipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  model,
  Signal,
  signal,
} from '@angular/core';

@Component({
  selector: 'damoclesSword-language-selector',
  imports: [AsyncPipe],
  templateUrl: './language-selector.html',
  styleUrl: './language-selector.scss',
  host: {
    '(document:click)': 'onDocumentClick($event.target)',
  },
})
export class LanguageSelector {
  languages = input<string[]>([]);
  selectedLanguage = model.required<string>();
  showLanguageOptions = signal(false);

  languageFlags: Signal<Record<string, Promise<string>>>;

  elementRef = inject(ElementRef);

  constructor() {
    // Validate the selected language and default to the first one if it's not valid
    effect(() => {
      const languages = this.languages();

      if (!languages.length) {
        console.error(
          'No languages available. Please provide at least one language.'
        );
        return;
      }

      const selectedLanguage = this.selectedLanguage();

      if (!selectedLanguage) {
        console.error(
          'No language selected. Defaulting to the first available language.'
        );

        this.selectedLanguage.set(this.languages()[0]);
        return;
      }

      if (!this.languages().includes(selectedLanguage)) {
        console.error(
          `Selected language ${selectedLanguage} is not in the list of available languages.`
        );

        this.selectedLanguage.set(this.languages()[0]);
        return;
      }
    });

    this.languageFlags = computed(() => {
      const flags: Record<string, Promise<string>> = {};

      for (const language of this.languages()) {
        flags[language] = this.loadFlag(language);
      }

      console.log('Loaded language flags:', flags);

      return flags;
    });
  }

  toggleShowOptions() {
    this.showLanguageOptions.update((show) => !show);
  }

  onDocumentClick(target: EventTarget | null) {
    const showingOptions = this.showLanguageOptions();

    // Skip if the dropdown is not open
    if (!showingOptions) return;

    const clickedInside =
      target && this.elementRef.nativeElement.contains(target);

    if (!clickedInside) {
      this.showLanguageOptions.set(false); // Close the dropdown if clicked outside
    }
  }

  onLanguageChange(selectedOption: string) {
    this.selectedLanguage.set(selectedOption);
  }

  loadFlag(languageCode: string): Promise<string> {
    return import(`./assets/flag-${languageCode}.svg`).then((m) => m.default);
  }
}
