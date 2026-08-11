import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnInit,
  signal,
  Type,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ProjectMemory } from '@portfolio/landing-v2/data-access';
import { TranslatedProject } from '@portfolio/landing-v2/models';
import {
  DamoclesContent,
  LandingV2UiModule,
  OdontogramContent,
  PortfolioContent,
} from '@portfolio/landing-v2/ui';
import { RokuTranslator } from '@portfolio/localization/rokutranslator';
import { RokuTranslatorService } from '@portfolio/localization/rokutranslator-angular';

/**
 * Maps a project id to the presentational content component that renders
 * its detail page. A single routed page (see routes.ts, one entry per
 * project id in route `data`) serves every project — adding a project only
 * means adding a content component here, not a whole new feature lib.
 *
 * Typed as `Type<unknown>` rather than a shared "content component" input
 * interface: each resolved component's own `project`/`backLink` are
 * `InputSignal`s (via `input.required<T>()`), not plain properties, so
 * there's no useful structural type to check the map's values against —
 * `NgComponentOutlet`'s `inputs` binding matches them by name at runtime.
 */
const CONTENT_BY_PROJECT_ID: Record<string, Type<unknown>> = {
  '1': PortfolioContent,
  '2': DamoclesContent,
  '3': OdontogramContent,
};

/**
 * Generic project detail page, routed at `/{locale}/projects/<slug>`
 * (landing-v2/feature-shell's routes.ts, one entry per project via route
 * `data: { projectId }`). Resolves the project's data via ProjectMemory and
 * dynamically builds the matching presentational content component from
 * `@portfolio/landing-v2/ui` at execution time (see CONTENT_BY_PROJECT_ID).
 *
 * Imports LandingV2UiModule itself (mirroring LandingV2Wrapper) — its
 * RokuTranslatorModule.withConfig() providers land in *this* component's
 * own injector, which is what NgComponentOutlet-created children (the
 * resolved content component) inherit. Without it, RokuTranslatorPipe
 * inside the dynamically-created component throws NG0201 (no provider
 * found), since being merely *registered* in LandingV2UiModule's
 * `components` array doesn't put a component in this injector tree.
 */
@Component({
  selector: 'lib-landing-v2-project-page',
  imports: [NgComponentOutlet, LandingV2UiModule],
  templateUrl: './project-page.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectPage implements OnInit {
  private _route = inject(ActivatedRoute);
  private _projectServ = inject(ProjectMemory);
  private _rokuTranslatorServ = inject(RokuTranslatorService);

  readonly locale = RokuTranslator.getLocale();
  readonly backLink = `/${this.locale}`;

  // Gates the whole render on the i18n namespace being loaded (mirrors
  // Landing's `compReady`) — RokuTranslatorPipe is a *pure* pipe, evaluated
  // once from a static key; rendering before `loaded$` fires would freeze
  // every `| rokuT` output on its untranslated fallback (the raw key)
  // forever, since a pure pipe never re-evaluates on its own.
  compReady = signal(false);

  project = signal<TranslatedProject | null>(null);
  content = signal<Type<unknown> | null>(null);

  constructor() {
    this._rokuTranslatorServ.loaded$.subscribe(() => {
      this.compReady.set(true);
    });
  }

  ngOnInit() {
    const projectId = this._route.snapshot.data['projectId'] as string;
    const content = CONTENT_BY_PROJECT_ID[projectId];

    if (!content) {
      throw new Error(
        `No detail-page content registered for project id "${projectId}"`
      );
    }

    this.content.set(content);
    this._projectServ
      .getById(projectId, this.locale)
      .subscribe((project) => this.project.set(project));
  }
}
