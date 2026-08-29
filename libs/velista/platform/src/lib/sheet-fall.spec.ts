import { TestBed } from '@angular/core/testing';
import type {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
} from '@angular/router';
import { OpenSheet, sheetFallGuard, type FallingSheet } from './sheet-fall';

/** A sheet that records the ask and lets the test decide when it lands. */
function stubSheet(): FallingSheet & { asks: number; land(): void } {
  let landed: (() => void) | null = null;

  return {
    asks: 0,
    fall(): Promise<void> {
      this.asks += 1;
      return new Promise<void>((resolve) => {
        landed = resolve;
      });
    },
    land(): void {
      landed?.();
    },
  };
}

/** The guard's four arguments, none of which it reads. */
function runGuard(): Promise<boolean> {
  return TestBed.runInInjectionContext(() =>
    sheetFallGuard(
      {},
      {} as ActivatedRouteSnapshot,
      {} as RouterStateSnapshot,
      {} as RouterStateSnapshot
    )
  ) as Promise<boolean>;
}

describe('OpenSheet', () => {
  let open: OpenSheet;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    open = TestBed.inject(OpenSheet);
  });

  it('asks the sheet on screen to fall', async () => {
    const sheet = stubSheet();
    open.register(sheet);

    const falling = open.fall();
    expect(sheet.asks).toBe(1);

    sheet.land();
    await expect(falling).resolves.toBeUndefined();
  });

  it('resolves at once when no sheet is registered', async () => {
    // A sheet route whose component draws something other than a panel, which is what
    // `CreateGroupSheet` does when the guest account is spent. Nothing to animate, and
    // a guard that waited would hang the navigation for ever.
    await expect(open.fall()).resolves.toBeUndefined();
  });

  it('forgets a sheet when it is released', async () => {
    const sheet = stubSheet();
    open.register(sheet);
    open.release(sheet);

    await open.fall();
    expect(sheet.asks).toBe(0);
  });

  it('keeps the newer sheet when an older one is released late', async () => {
    // Angular constructs the incoming component before destroying the outgoing one, so
    // the release always arrives after the next registration. Clearing blindly there
    // would leave the new sheet unable to animate, once, on the first exit after it.
    const older = stubSheet();
    const newer = stubSheet();

    open.register(older);
    open.register(newer);
    open.release(older);

    void open.fall();
    expect(newer.asks).toBe(1);
  });
});

describe('sheetFallGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('waits for the panel to land, then allows the navigation', async () => {
    const sheet = stubSheet();
    TestBed.inject(OpenSheet).register(sheet);

    let allowed: boolean | null = null;
    const decision = runGuard().then((value) => (allowed = value));

    // Still on screen: this is the whole point on the back button, where the router
    // would otherwise have destroyed the panel already.
    await Promise.resolve();
    expect(allowed).toBeNull();

    sheet.land();
    await decision;
    expect(allowed).toBe(true);
  });

  it('allows a navigation off a route with no sheet on it', async () => {
    await expect(runGuard()).resolves.toBe(true);
  });

  it('reads the registry before it suspends', () => {
    // `inject` is legal only until a guard's first await, so resolving `OpenSheet`
    // inside the promise chain would throw NG0203 on exactly the exit this guard
    // exists for, and nowhere a spec would normally look. Called with no injection
    // context at all it must therefore throw **synchronously**; one that injected late
    // would hand back a promise here and fail only much later.
    expect(() =>
      sheetFallGuard(
        {},
        {} as ActivatedRouteSnapshot,
        {} as RouterStateSnapshot,
        {} as RouterStateSnapshot
      )
    ).toThrow();
  });
});
