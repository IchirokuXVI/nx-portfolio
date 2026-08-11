import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { EmailIcon, GithubIcon, LinkedinIcon } from '@portfolio/shared/ui';

@Component({
  selector: 'lib-landing-v2-site-footer',
  imports: [RokuTranslatorPipe, GithubIcon, LinkedinIcon, EmailIcon],
  templateUrl: './site-footer.html',
  styleUrl: './site-footer.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SiteFooter {
  // A component field evaluated when the footer is constructed — never a
  // hardcoded year (brief #6).
  readonly year = new Date().getFullYear();

  readonly githubUrl = 'https://github.com/ichirokuxvi';
  readonly linkedinUrl = 'https://www.linkedin.com/in/ichiroku/';
  readonly emailUrl = 'mailto:ichiroku.work@gmail.com';
}
