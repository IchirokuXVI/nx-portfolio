import { RecordingRunReport } from './run-report';
import { ReportWriteFailedError } from './run-report.sink';
import type { ReportedObservation } from './source-ingest';

/**
 * A report whose first chunk fails to write, wired as `RunExecutor` wires the
 * real sink (plan 0269, section 1), for the runner specs of plan 0267.
 *
 * It takes the first product as a chunk that the sink queued, and the write
 * of that chunk rejects once the runner is back in its own code: the failure
 * aborts the run's controller with a {@link ReportWriteFailedError}, which is
 * what the executor's `onWriteFailed` does. Every product after the failure
 * is dropped, as the sink drops it, and counted in {@link dropped} so a spec
 * can say how many the runner still handed over.
 *
 * What a spec pins with it is the runner: the abort reaches it through the
 * signal it already reads, and it asks for no page after that.
 *
 * Not a spec file, so it names no `jest` and is compiled with the app.
 */
export class FailingRunReport extends RecordingRunReport {
  /** The products reported after the write failed, which nothing writes. */
  dropped = 0;
  private failed = false;
  private queued = false;

  constructor(
    private readonly controller: AbortController,
    private readonly error: Error = new Error('The chunk write was refused.')
  ) {
    super();
  }

  override product(observation: ReportedObservation): void {
    if (this.failed) {
      this.dropped += 1;
      return;
    }
    super.product(observation);
    if (this.queued) {
      return;
    }
    this.queued = true;
    // The chunk's write runs on the sink's chain, so it fails after this
    // call returned, and before the next page answers.
    void Promise.resolve().then(() => {
      this.failed = true;
      this.controller.abort(new ReportWriteFailedError(this.error));
    });
  }
}
