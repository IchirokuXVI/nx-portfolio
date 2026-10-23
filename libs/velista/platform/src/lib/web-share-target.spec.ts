import { TestBed } from '@angular/core/testing';
import { BrowserFacade } from './browser-facade';
import { SHARE_TARGET, WebShareTarget } from './share-target';
import { fakeBrowserFacade } from './testing/velista-testing';

describe('WebShareTarget', () => {
  function withShare(share?: (data: ShareData) => Promise<void>) {
    TestBed.configureTestingModule({
      providers: [
        {
          provide: BrowserFacade,
          useValue: fakeBrowserFacade(new Map(), {
            window: { navigator: { share } },
          } as unknown as Partial<BrowserFacade>),
        },
      ],
    });
    return TestBed.inject(SHARE_TARGET);
  }

  it('is the default SHARE_TARGET', () => {
    expect(withShare()).toBeInstanceOf(WebShareTarget);
  });

  it('shares, and hands the data over in the same tick as the call', async () => {
    const share = jest.fn(() => Promise.resolve());
    const target = withShare(share);

    const outcome = target.share({ url: 'https://velista.app/join/K' });

    // Before any await: the browser needs the click's activation, and a hop first
    // would spend it.
    expect(share).toHaveBeenCalledWith({ url: 'https://velista.app/join/K' });
    expect(target.canShare()).toBe(true);
    await expect(outcome).resolves.toBe('shared');
  });

  it('reports a closed sheet as dismissed, not as a failure', async () => {
    const target = withShare(() =>
      Promise.reject(new DOMException('closed', 'AbortError'))
    );

    await expect(target.share({ url: 'u' })).resolves.toBe('dismissed');
  });

  it('reports a refusal as unavailable, so the caller copies instead', async () => {
    const target = withShare(() =>
      Promise.reject(new DOMException('no gesture', 'NotAllowedError'))
    );

    await expect(target.share({ url: 'u' })).resolves.toBe('unavailable');
  });

  it('is unavailable where the browser has no share sheet', async () => {
    const target = withShare(undefined);

    expect(target.canShare()).toBe(false);
    await expect(target.share({ url: 'u' })).resolves.toBe('unavailable');
  });

  it('is unavailable on the server, where there is no window', async () => {
    TestBed.configureTestingModule({
      providers: [{ provide: BrowserFacade, useValue: fakeBrowserFacade() }],
    });
    const target = TestBed.inject(SHARE_TARGET);

    expect(target.canShare()).toBe(false);
    await expect(target.share({ url: 'u' })).resolves.toBe('unavailable');
  });
});
