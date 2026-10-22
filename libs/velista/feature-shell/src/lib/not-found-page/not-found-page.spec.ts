import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import { AppUpdates } from '@portfolio/velista/platform';
import {
  NOT_FOUND_CHECK_LIMIT_MS,
  NOT_FOUND_QUIET_MS,
  NotFoundPage,
} from './not-found-page';

describe('NotFoundPage (plan 0150)', () => {
  const url = '/es/auth/reset-password?token=t';

  let settle: (newer: boolean) => void;
  let updates: {
    newerVersionForUnknownPage: jest.Mock<Promise<boolean>, [string]>;
    reloadForUnknownPage: jest.Mock<void, [string]>;
  };
  let fixture: ComponentFixture<NotFoundPage>;

  /** Lets the answer's `then` run. */
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  function create(navigating = true): void {
    updates = {
      newerVersionForUnknownPage: jest.fn(
        () => new Promise<boolean>((resolve) => (settle = resolve))
      ),
      reloadForUnknownPage: jest.fn(),
    };

    const finalUrl = { serialized: url };
    TestBed.configureTestingModule({
      imports: [NotFoundPage, RokuTranslatorTestingModule.forTesting()],
      providers: [
        { provide: AppUpdates, useValue: updates },
        {
          provide: Router,
          useValue: {
            url: '/es/home',
            currentNavigation: () =>
              navigating ? { finalUrl, extractedUrl: finalUrl } : null,
            serializeUrl: (tree: typeof finalUrl) => tree.serialized,
          },
        },
      ],
    });

    fixture = TestBed.createComponent(NotFoundPage);
    fixture.detectChanges();
  }

  const face = () => fixture.componentInstance.face();
  const heading = () =>
    (fixture.nativeElement as HTMLElement).querySelector('h1');

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('asks about the URL of its own navigation, not the page before it', () => {
    create();

    expect(updates.newerVersionForUnknownPage).toHaveBeenCalledWith(url);
  });

  it('falls back to the router URL outside a navigation', () => {
    create(false);

    expect(updates.newerVersionForUnknownPage).toHaveBeenCalledWith('/es/home');
  });

  it('draws nothing while a quick answer may still come', () => {
    create();

    jest.advanceTimersByTime(NOT_FOUND_QUIET_MS - 1);
    fixture.detectChanges();

    expect(face()).toBe('quiet');
    expect(heading()).toBeNull();
  });

  it('says it is looking once the answer takes longer', () => {
    create();

    jest.advanceTimersByTime(NOT_FOUND_QUIET_MS);
    fixture.detectChanges();

    expect(face()).toBe('checking');
    expect(heading()).not.toBeNull();
  });

  it('draws the 404 when nothing newer exists, and reloads nothing', async () => {
    create();

    settle(false);
    await flushMicrotasks();
    fixture.detectChanges();

    expect(face()).toBe('missing');
    expect(heading()).not.toBeNull();
    expect(updates.reloadForUnknownPage).not.toHaveBeenCalled();

    // The timers are cleared, so nothing moves the face afterwards.
    jest.advanceTimersByTime(NOT_FOUND_CHECK_LIMIT_MS);
    expect(face()).toBe('missing');
  });

  it('says it is updating and reloads on the same URL when a version is ready', async () => {
    create();

    settle(true);
    await flushMicrotasks();

    expect(face()).toBe('updating');
    expect(updates.reloadForUnknownPage).toHaveBeenCalledWith(url);
  });

  it('draws the 404 after the limit, and still reloads on a late yes', async () => {
    create();

    jest.advanceTimersByTime(NOT_FOUND_CHECK_LIMIT_MS);
    expect(face()).toBe('missing');

    settle(true);
    await flushMicrotasks();

    expect(face()).toBe('updating');
    expect(updates.reloadForUnknownPage).toHaveBeenCalledWith(url);
  });

  it('never reloads once the page is left', async () => {
    create();

    fixture.destroy();
    settle(true);
    await flushMicrotasks();

    expect(updates.reloadForUnknownPage).not.toHaveBeenCalled();
  });
});
