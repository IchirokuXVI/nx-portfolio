import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DeploymentStore } from '@portfolio/luna-shopper-admin/data-access';
import type { Deployment } from '@portfolio/luna-shopper-admin/models';
import { AppRoot } from './app-root';

/**
 * The accent colour is keyed off `data-deployment` on this element, so what the
 * attribute says **is** what colour the app wears (plan 0001, section 6).
 *
 * The assertion that matters is the negative one: an app that has not established
 * its environment must carry no attribute at all, so the stylesheet's resting grey
 * applies. If it fell back to a name, a failed read would paint the app in some
 * environment's colour without anybody having said that is the environment, which is
 * exactly the confident wrong answer the feature exists to prevent.
 */
async function render(deployment: Deployment | null | undefined) {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [AppRoot],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      {
        provide: DeploymentStore,
        useValue: { deployment: signal(deployment).asReadonly() },
      },
    ],
  }).compileComponents();

  const fixture = TestBed.createComponent(AppRoot);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('AppRoot', () => {
  it.each<Deployment>(['production', 'staging', 'development'])(
    'stamps %s so the stylesheet can colour the app',
    async (deployment) => {
      const host = await render(deployment);

      expect(host.getAttribute('data-deployment')).toBe(deployment);
    }
  );

  it('stamps nothing while the deployment is still being read', async () => {
    const host = await render(undefined);

    expect(host.hasAttribute('data-deployment')).toBe(false);
  });

  it('stamps nothing when the deployment could not be established', async () => {
    const host = await render(null);

    expect(host.hasAttribute('data-deployment')).toBe(false);
  });
});
