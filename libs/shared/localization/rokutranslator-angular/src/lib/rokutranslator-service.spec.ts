import { ChangeDetectionStrategy, Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { provideRokuTranslator } from './provide-rokutranslator';
import { RokuTranslatorPipe } from './rokutranslator-pipe';
import {
  LoaderFunction,
  RokuTranslatorService,
} from './rokutranslator-service';

/** A loader whose promise the test settles, so a render happens before it does. */
function deferredLoader(): { loader: LoaderFunction; resolve: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((res) => (release = res));

  return {
    loader: () => gate.then(() => ({ home: { hero: { headline: 'Ahoy' } } })),
    resolve: () => release(),
  };
}

function configure(namespace: string, loader: LoaderFunction): void {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideRokuTranslator({
        locales: ['en'],
        defaultNamespace: namespace,
        loader,
      }),
    ],
  });
}

/**
 * No `init` here any more. Since plan 0005 `provideRokuTranslator` creates the
 * app's translator and the service inits it, so `configure` is the whole setup and
 * each test gets an instance of its own rather than sharing one process-wide.
 */
describe('RokuTranslatorService load completion', () => {
  it('settles loaded$ with false and flips loaded when a loader rejects', async () => {
    const rejecting = jest.fn(() => Promise.reject(new Error('404 on chunk')));
    configure('ns-rejecting', rejecting as unknown as LoaderFunction);

    const service = TestBed.inject(RokuTranslatorService);

    // The emission is the contract, not the completion: firstValueFrom rejects
    // with EmptyError on an observable that completes empty, which for a route
    // resolver means a cancelled navigation and a blank page. Awaiting it is
    // exactly what such a caller does.
    await expect(firstValueFrom(service.loaded$)).resolves.toBe(false);
    expect(service.loaded()).toBe(true);
    expect(rejecting).toHaveBeenCalled();
  });

  it('settles loaded$ with true when every loader succeeds', async () => {
    configure('ns-resolving', () =>
      Promise.resolve({ home: { hero: { headline: 'Ahoy' } } })
    );

    const service = TestBed.inject(RokuTranslatorService);

    await expect(firstValueFrom(service.loaded$)).resolves.toBe(true);
    expect(service.loaded()).toBe(true);
  });

  it('replays the settled value to a caller that subscribes afterwards', async () => {
    configure('ns-late', () => Promise.resolve({ greeting: 'Ahoy' }));

    const service = TestBed.inject(RokuTranslatorService);
    await firstValueFrom(service.loaded$);

    // A resolver running on a later navigation still gets a value rather than an
    // empty completion.
    await expect(firstValueFrom(service.loaded$)).resolves.toBe(true);
  });
});

@Component({
  selector: 'lib-onpush-binding',
  imports: [RokuTranslatorPipe],
  template: `{{ 'home.hero.headline' | rokuT }}`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class OnPushBinding {}

/**
 * Default change detection, so a pass over the tree reaches the child without
 * checking it. An OnPush view is skipped unless something marked it dirty, which
 * is the whole point of the test below: only the load-state signal can do that.
 */
@Component({
  selector: 'lib-host',
  imports: [OnPushBinding],
  template: `<lib-onpush-binding />`,
})
class Host {}

describe('RokuTranslatorPipe', () => {
  function text(fixture: ComponentFixture<Host>): string {
    return (fixture.nativeElement.textContent ?? '').trim();
  }

  it('re-renders an OnPush host when the load completes', async () => {
    const { loader, resolve } = deferredLoader();
    configure('ns-onpush', loader);

    const fixture = TestBed.createComponent(Host);
    // Injecting the service is what starts the load; in an app the injector does
    // it when the first component asks for the pipe.
    const service = TestBed.inject(RokuTranslatorService);

    fixture.autoDetectChanges();
    await fixture.whenStable();

    // First paint is the key, which is correct: nothing has loaded yet.
    expect(text(fixture)).toBe('home.hero.headline');

    resolve();
    await firstValueFrom(service.loaded$);
    await fixture.whenStable();

    // No detectChanges() forcing it. The signal write inside the service is the
    // only thing that could have marked this view dirty.
    expect(text(fixture)).toBe('Ahoy');
  });
});
