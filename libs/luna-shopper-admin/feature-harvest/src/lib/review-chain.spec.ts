import { provideLocationMocks } from '@angular/common/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { ReviewChain } from './review-chain';

/**
 * The chain the four queues of Review are narrowed to (admin plan 0044,
 * target 4). The address is the state: read from the `chain` query parameter
 * and written back there.
 */

@Component({ selector: 'lib-test-landing', template: '' })
class Landing {}

/** A navigation takes more than microtasks to finish, so wait a real turn. */
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise<void>((done) => setTimeout(done));
  }
};

async function at(
  url: string
): Promise<{ chain: ReviewChain; router: Router }> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: '**', component: Landing }]),
      provideLocationMocks(),
    ],
  });

  const router = TestBed.inject(Router);
  await router.navigateByUrl(url);

  return { chain: TestBed.inject(ReviewChain), router };
}

describe('ReviewChain', () => {
  it('reads the chain the address names', async () => {
    const { chain } = await at('/harvest/review/products?chain=sm_deza');

    expect(chain.chain()).toBe('sm_deza');
  });

  it('is no chain when the address names none', async () => {
    const { chain } = await at('/harvest/review/products');

    expect(chain.chain()).toBe('');
  });

  /** A link and the browser's back button both move the chain. */
  it('follows the address as it changes', async () => {
    const { chain, router } = await at('/harvest/review/products?chain=sm_a');

    await router.navigateByUrl('/harvest/review/shops?chain=sm_b');
    expect(chain.chain()).toBe('sm_b');

    await router.navigateByUrl('/harvest/review/shops');
    expect(chain.chain()).toBe('');
  });

  describe('choosing a chain', () => {
    /** The queue reloads without waiting for the navigation. */
    it('moves the signal at once', async () => {
      const { chain } = await at('/harvest/review/products');

      chain.choose('sm_deza');

      expect(chain.chain()).toBe('sm_deza');
    });

    it('writes the chain into the address, where it stays', async () => {
      const { chain, router } = await at('/harvest/review/products');

      chain.choose('sm_deza');
      await settle();

      expect(router.url).toBe('/harvest/review/products?chain=sm_deza');
      expect(chain.chain()).toBe('sm_deza');
    });

    it('keeps the other parameters of the address', async () => {
      const { chain, router } = await at(
        '/harvest/review/products?brandKey=mahou&view=groups'
      );

      chain.choose('sm_deza');
      await settle();

      const params = router.parseUrl(router.url).queryParams;
      expect(params).toEqual({
        brandKey: 'mahou',
        view: 'groups',
        chain: 'sm_deza',
      });
    });

    it('replaces one chain with another', async () => {
      const { chain, router } = await at('/harvest/review/shops?chain=sm_a');

      chain.choose('sm_b');
      await settle();

      expect(router.url).toBe('/harvest/review/shops?chain=sm_b');
    });

    it('takes the parameter away for no chain, and keeps the others', async () => {
      const { chain, router } = await at(
        '/harvest/review/products?chain=sm_a&view=groups'
      );

      chain.choose('');
      await settle();

      expect(router.url).toBe('/harvest/review/products?view=groups');
      expect(chain.chain()).toBe('');
    });

    /** A filter is not a place the back button should return to. */
    it('replaces the entry of the history and adds none', async () => {
      const { chain, router } = await at('/harvest/review/products');
      const navigated = jest.spyOn(router, 'navigateByUrl');

      chain.choose('sm_deza');
      await settle();

      expect(navigated).toHaveBeenCalledTimes(1);
      expect(navigated.mock.calls[0][1]).toEqual({ replaceUrl: true });
    });
  });

  describe('the parameters a link to another queue carries', () => {
    it('is the chain, so the next queue opens narrowed', async () => {
      const { chain } = await at('/harvest/review/products?chain=sm_deza');

      expect(chain.params()).toEqual({ chain: 'sm_deza' });
    });

    it('is nothing with no chain chosen', async () => {
      const { chain } = await at('/harvest/review/products');

      expect(chain.params()).toEqual({});
    });
  });
});
