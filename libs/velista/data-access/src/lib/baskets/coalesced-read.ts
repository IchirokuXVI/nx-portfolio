/**
 * When a read that events ask for goes out (velista `0143`, section 5).
 *
 * - **The first ask after a quiet time reads at once**, so the first change of
 *   a burst is on screen after one round trip.
 * - **Asks that arrive while that read is out, or within `quietMs` after it
 *   landed, are gathered** into one more read, which waits until `quietMs` pass
 *   with no ask.
 * - **That wait has a ceiling.** A read that was asked for is started no later
 *   than `ceilingMs` after the first ask it gathers, however many asks follow.
 *   A read already out when the ceiling comes is let land first, and the next
 *   one starts as it lands.
 *
 * So a burst costs one read at once, then at most one for each `ceilingMs` it
 * lasts, then one after it ends. A burst of one ask a second for ten seconds,
 * with a ceiling of 3000 ms, costs four or five reads, not two.
 *
 * The timers are the phone's own and measure only how long to wait. Nothing here
 * compares a time of the server with the time of the phone.
 */
export class CoalescedRead {
  /** The read this has out, or null. */
  private _out: Promise<void> | null = null;
  /** Running while the quiet time after the last read has not passed. */
  private _quiet: ReturnType<typeof setTimeout> | null = null;
  /** The wait for asks to stop. */
  private _wait: ReturnType<typeof setTimeout> | null = null;
  /** The ceiling of that wait, from the first ask it gathers. */
  private _ceiling: ReturnType<typeof setTimeout> | null = null;
  /** Somebody asked, and no read started since. */
  private _asked = false;
  /** The ceiling came while a read was out, so the next one starts as it lands. */
  private _dueOnLanding = false;

  constructor(
    private readonly _read: () => Promise<void>,
    private readonly _quietMs: number,
    private readonly _ceilingMs: number
  ) {}

  /** Whether a read this started is out. */
  get reading(): boolean {
    return this._out !== null;
  }

  /** Ask for a read. See the class for when it goes out. */
  ask(): void {
    if (this._out === null && this._quiet === null && !this._asked) {
      void this._run();
      return;
    }
    this._asked = true;
    this._ceiling ??= setTimeout(() => this._due(), this._ceilingMs);
    if (this._out === null) {
      this._restartWait();
    }
  }

  /** Ask for a read that does not wait for a quiet time. */
  askNow(): void {
    this._asked = true;
    this._due();
  }

  /**
   * Forget every ask, because the basket was let go. A read already out lands,
   * and nothing follows it.
   */
  cancel(): void {
    this._clear();
    if (this._quiet !== null) {
      clearTimeout(this._quiet);
      this._quiet = null;
    }
    this._asked = false;
    this._dueOnLanding = false;
  }

  private _restartWait(): void {
    if (this._wait !== null) {
      clearTimeout(this._wait);
    }
    this._wait = setTimeout(() => this._due(), this._quietMs);
  }

  private _due(): void {
    this._clear();
    if (this._out !== null) {
      this._dueOnLanding = true;
      return;
    }
    void this._run();
  }

  private async _run(): Promise<void> {
    this._clear();
    if (this._quiet !== null) {
      clearTimeout(this._quiet);
      this._quiet = null;
    }
    this._asked = false;
    this._dueOnLanding = false;

    const out = this._read().catch(() => undefined);
    this._out = out;
    await out;
    this._out = null;

    this._quiet = setTimeout(() => {
      this._quiet = null;
    }, this._quietMs);
    if (this._dueOnLanding) {
      void this._run();
    } else if (this._asked) {
      this._restartWait();
    }
  }

  private _clear(): void {
    if (this._wait !== null) {
      clearTimeout(this._wait);
      this._wait = null;
    }
    if (this._ceiling !== null) {
      clearTimeout(this._ceiling);
      this._ceiling = null;
    }
  }
}
