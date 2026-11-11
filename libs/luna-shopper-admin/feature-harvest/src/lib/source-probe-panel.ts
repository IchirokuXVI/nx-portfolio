import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { RokuTranslatorPipe } from '@portfolio/localization/rokutranslator-angular';
import { HARVEST_SERVICE } from '@portfolio/luna-shopper-admin/data-access';
import { RECORD_CONTEXT } from '@portfolio/luna-shopper-admin/feature-resource';
import {
  redProbe,
  type ProbeVerdict,
} from '@portfolio/luna-shopper-admin/models';
import { RecordSection } from '@portfolio/luna-shopper-admin/ui';
import { ChainNames } from './chain-names';
import { PROBE_PAGE, ProbeNotice } from './probe-notice';

/** What the panel calls itself among the children of the `sources` record. */
export const SOURCE_PROBE_PANEL = 'probe';

/**
 * The warning of admin plan 0069 on the source record page (the owner,
 * 2026-11-11: "Show it").
 *
 * **The warning only.** It draws the same notice as a start does when the
 * chain's newest finished probe did not pass, and nothing else: no probe
 * button, no history, no line for a probe that passed. Those are the follow
 * up admin plan that backend `0219` section 13 names, which owns the page's
 * view of its probes.
 *
 * **Absent when there is nothing to warn about.** A pass, no finished probe, a
 * probe in flight over a pass, a chain whose adapter is never probed and a read
 * that failed all draw no panel. The other panels of a record page are
 * collections, which say "none" in their own frame. This one is a warning, as
 * the notice beside a start is, and a frame that only said "no warning" would
 * be read as a probe status this panel does not show.
 *
 * The record of a source is keyed on its chain (`rowId` of `SOURCES`), and
 * the probe route takes the chain, so the ID from `RECORD_CONTEXT` is what is
 * asked for. One page of probes, read once: the page builds the panel again
 * for another record.
 */
@Component({
  selector: 'lib-source-probe-panel',
  imports: [RokuTranslatorPipe, RecordSection, ProbeNotice],
  template: `
    @if (verdict(); as red) {
      <lib-record-section
        [heading]="'harvest.sources.section.probe' | rokuT"
        data-source-probe
      >
        <div class="body">
          <lib-probe-notice
            [chain]="chain()"
            [verdict]="red"
            variant="source"
          />
        </div>
      </lib-record-section>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    /* Nothing to warn about draws nothing, and takes no gap in the page. */
    :host(:empty) {
      display: none;
    }

    .body {
      padding: var(--admin-space-3) var(--admin-space-4);
      border-block-start: 1px solid var(--admin-border);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceProbePanel {
  private readonly _service = inject(HARVEST_SERVICE);
  private readonly _names = inject(ChainNames);

  /** The chain, from the page. The page builds this panel again for another. */
  private readonly _chain = inject(RECORD_CONTEXT).id;

  /** The red probe, or null for a pass, no probe, or a read that failed. */
  readonly verdict = signal<ProbeVerdict | null>(null);

  /** The chain's name, or null while the reference cannot name it. */
  readonly chain = computed(() => this._names.known(this._chain));

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    if (this._chain === '') {
      return;
    }
    void this._names.resolve([this._chain]).catch(() => undefined);
    try {
      const page = await this._service.listProbes(this._chain, {
        limit: PROBE_PAGE,
      });
      this.verdict.set(redProbe(page));
    } catch {
      // No warning. A route that did not answer has nothing to warn about.
      this.verdict.set(null);
    }
  }
}
