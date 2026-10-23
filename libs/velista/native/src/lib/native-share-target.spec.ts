import { TestBed } from '@angular/core/testing';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativeShareTarget } from './native-share-target';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

describe('NativeShareTarget', () => {
  let doubles: NativePluginDoubles;
  let target: NativeShareTarget;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    target = TestBed.inject(NativeShareTarget);
  });

  it('can always share, because the system sheet is always there', () => {
    expect(target.canShare()).toBe(true);
  });

  it('hands the link to the system sheet and reports it shared', async () => {
    const data = { title: 'Weekly shop', url: 'https://velista.app/join/ABC' };

    await expect(target.share(data)).resolves.toBe('shared');
    expect(doubles.shared).toEqual([data]);
  });

  it('reads a closed chooser as dismissed, so no copy fallback follows', async () => {
    doubles.shareError = new Error('Share canceled');

    await expect(target.share({ url: 'https://velista.app' })).resolves.toBe(
      'dismissed'
    );
  });

  it('reads any other refusal as unavailable, so the caller copies', async () => {
    doubles.shareError = new Error("Can't share while sharing is in progress");

    await expect(target.share({ url: 'https://velista.app' })).resolves.toBe(
      'unavailable'
    );
  });
});
