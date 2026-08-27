import { AsyncPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { TranslatedInfoFact } from '@portfolio/landing-v2/models';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import {
  DownloadIcon,
  EmailIcon,
  GithubIcon,
  LinkedinIcon,
} from '@portfolio/shared/ui';
import { InfoTable } from '../info-table/info-table';

@Component({
  selector: 'lib-landing-v2-hero',
  imports: [
    AsyncPipe,
    RokuTranslatorPipe,
    DownloadIcon,
    GithubIcon,
    LinkedinIcon,
    EmailIcon,
    InfoTable,
  ],
  templateUrl: './hero.html',
  styleUrl: './hero.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Hero {
  facts = input<TranslatedInfoFact[]>([]);
  resumeLink = input<Promise<string> | null>(null);

  readonly githubUrl = 'https://github.com/ichirokuxvi';
  readonly linkedinUrl = 'https://www.linkedin.com/in/ichiroku/';
  readonly emailUrl = 'mailto:ichiroku.work@gmail.com';
}
