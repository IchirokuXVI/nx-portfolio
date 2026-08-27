import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { writeAppLocale } from '@portfolio/localization/rokutranslator-angular';
import { remoteRoutes } from './entry.routes';

@Component({ selector: 'app-mounted-sibling', template: '' })
class MountedSibling {}

/**
 * landingV2 mounted the way the shell mounts it: **last**, at the empty path, below a
 * sibling that owns a real mount. That nesting is the whole of what this app's
 * migration has to prove, so the spec reproduces it rather than testing the app's
 * table alone.
 */
function mount() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        // A stand-in for odontogram, velista and the rest: what matters is that a
        // mounted app sits above the empty path entry.
        { path: 'somewhere', component: MountedSibling },
        { path: '', children: remoteRoutes },
      ]),
    ],
  });

  return TestBed.inject(Router);
}

describe('landingV2 mounted at the site root', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    writeAppLocale('landingV2', 'es');
  });

  it('leaves a supported locale alone', async () => {
    const router = mount();

    await router.navigateByUrl('/en');

    expect(router.url).toBe('/en');
  });

  /**
   * The empty mount case, and the one the shell used to perform on this app's behalf
   * before its bundle had loaded.
   */
  it('inserts the locale at the bare root', async () => {
    const router = mount();

    await router.navigateByUrl('/');

    expect(router.url).toBe('/es');
  });

  it('inserts the locale in front of a page path', async () => {
    const router = mount();

    await router.navigateByUrl('/projects/odontogram');

    expect(router.url).toBe('/es/projects/odontogram');
  });

  it('replaces a locale the app does not support', async () => {
    const router = mount();

    await router.navigateByUrl('/zz/projects/odontogram');

    expect(router.url).toBe('/es/projects/odontogram');
  });

  it('rewrites a supported locale to its canonical form', async () => {
    const router = mount();

    await router.navigateByUrl('/en-US');

    expect(router.url).toBe('/en');
  });

  /**
   * The ordering rule from the shell's table, asserted from this side too: the empty
   * path app must not swallow a sibling's mount.
   */
  it('does not swallow a mounted sibling', async () => {
    const router = mount();

    await router.navigateByUrl('/somewhere');

    expect(router.url).toBe('/somewhere');
  });
});
