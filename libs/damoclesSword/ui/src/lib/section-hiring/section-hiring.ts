import { Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { BorderAlignment } from '../enums/border-alignment';
import { SectionLayout } from '../section-layout/section-layout';

interface Vacancy {
  role: string;
  department: string;
  description: string;
}

/**
 * "We Are Looking For People" band (light). Lists the currently open vacancies
 * in a responsive table. The rows carry already-namespaced i18n keys resolved
 * in the template via the `rokuT` pipe; static data is fine here (no backend).
 */
@Component({
  selector: 'lib-damocles-sword-section-hiring',
  imports: [RokuTranslatorPipe, SectionLayout],
  templateUrl: './section-hiring.html',
  styleUrl: './section-hiring.scss',
})
export class SectionHiring {
  readonly vacancies: Vacancy[] = [
    {
      role: 'section-hiring.vacancy-lead-3d-role',
      department: 'section-hiring.vacancy-lead-3d-department',
      description: 'section-hiring.vacancy-lead-3d-description',
    },
    {
      role: 'section-hiring.vacancy-concept-role',
      department: 'section-hiring.vacancy-concept-department',
      description: 'section-hiring.vacancy-concept-description',
    },
    {
      role: 'section-hiring.vacancy-producer-role',
      department: 'section-hiring.vacancy-producer-department',
      description: 'section-hiring.vacancy-producer-description',
    },
  ];

  get BorderAlignment() {
    return BorderAlignment;
  }
}
