import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { ResourceListPage } from '@portfolio/luna-shopper-admin/feature-resource';
import { HarvestNotice } from '@portfolio/luna-shopper-admin/ui';
import { HarvestShell } from './harvest-shell';
import { SourcesGateway } from './sources-gateway';

/**
 * The Sources part of Setup: the generic list of the chain sources, and the
 * two things around it that are the harvester's and not a list's (admin plan
 * 0059, target 10).
 *
 * - **With no harvester, it says so.** The harvester can be absent from a
 *   cluster, and a failed read then means "not deployed here" and not "the
 *   gateway did not answer". The generic list knows one failure and offers a
 *   retry for it. So when the read of the list fails, this part draws the
 *   notice every harvester screen draws, and no list.
 * - **OpenStreetMap is one line under the list.** It is asked for every
 *   postal code and has no source to switch or to configure (backend plan
 *   0153). A sentence of the descriptor would also be drawn on the page of
 *   each source, where "it has no row here" says nothing.
 *
 * The list itself is `ResourceListPage`, which reads the descriptor from the
 * route this part is mounted at.
 */
@Component({
  selector: 'lib-sources-tab',
  imports: [HarvestNotice, ResourceListPage, RokuTranslatorPipe],
  template: `
    @if (gateway.listFailed()) {
      <lib-harvest-notice
        (retry)="gateway.retryList()"
        [absent]="shell.absent()"
      />
    } @else {
      <lib-resource-list-page />

      <p class="always">{{ 'harvest.sources.osmAlways' | rokuT }}</p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex: 1;
      flex-direction: column;
      gap: var(--admin-space-3);
      min-inline-size: 0;
    }

    .always {
      font-size: 0.8125rem;
      color: var(--admin-ink-muted);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourcesTab {
  readonly gateway = inject(SourcesGateway);
  readonly shell = inject(HarvestShell);
}
