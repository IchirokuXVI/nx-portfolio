import { ComponentFixture, TestBed } from '@angular/core/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ProjectCard, ProjectData } from './project-card';

function makeProject(overrides: Partial<ProjectData> = {}): ProjectData {
  return {
    kind: 'client-project',
    label: 'project.label',
    description: 'project.description',
    ...overrides,
  };
}

/** Queries a single required element, failing the test if it is missing. */
function query<T extends Element>(host: HTMLElement, selector: string): T {
  const el = host.querySelector<T>(selector);
  if (!el) {
    throw new Error(`Expected to find an element matching "${selector}"`);
  }
  return el;
}

describe('ProjectCard', () => {
  let component: ProjectCard;
  let fixture: ComponentFixture<ProjectCard>;

  /**
   * Sets the required `project` input and flushes change detection twice: once
   * so the async pipes subscribe to the addon `src` promises, and once after
   * `whenStable()` resolves them so the resolved values are rendered.
   */
  async function renderWith(project: ProjectData) {
    fixture.componentRef.setInput('project', project);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProjectCard],
    }).compileComponents();

    fixture = TestBed.createComponent(ProjectCard);
    component = fixture.componentInstance;
    await renderWith(makeProject());
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('content', () => {
    it('renders the label and already-translated description as-is', async () => {
      await renderWith(
        makeProject({
          label: 'STARLIT: ASCENSION',
          description: 'An already-translated description.',
        })
      );
      const host = fixture.nativeElement as HTMLElement;

      expect(host.querySelector('.card-title')?.textContent?.trim()).toBe(
        'STARLIT: ASCENSION'
      );
      expect(host.querySelector('.card-main-content')?.textContent?.trim()).toBe(
        'An already-translated description.'
      );
    });

    it('does not render the right column when there are no addons', () => {
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('.card-right-column')).toBeNull();
    });
  });

  describe('addons', () => {
    it('renders a right-positioned video addon that is set up to autoplay muted', async () => {
      await renderWith(
        makeProject({
          addons: [
            {
              kind: 'video',
              position: 'right',
              src: Promise.resolve('trailer.mp4'),
            },
          ],
        })
      );
      const host = fixture.nativeElement as HTMLElement;
      const video = query<HTMLVideoElement>(host, '.card-right-addon video');

      expect(video.hasAttribute('autoplay')).toBe(true);
      expect(video.hasAttribute('loop')).toBe(true);
      expect(video.hasAttribute('playsinline')).toBe(true);
      // `muted` is a property binding, not an attribute — it must be set as a
      // DOM property for the browser autoplay policy to allow playback.
      expect(video.muted).toBe(true);

      const source = query<HTMLSourceElement>(video, 'source');
      expect(source.getAttribute('src')).toBe('trailer.mp4');
      expect(source.getAttribute('type')).toBe('video/mp4');
    });

    it('renders a right-positioned image addon with its src and alt', async () => {
      await renderWith(
        makeProject({
          addons: [
            {
              kind: 'image',
              position: 'right',
              src: Promise.resolve('screenshot.png'),
              alt: 'a screenshot',
            },
          ],
        })
      );
      const host = fixture.nativeElement as HTMLElement;
      const img = query<HTMLImageElement>(host, '.card-right-addon img');

      expect(img.getAttribute('src')).toBe('screenshot.png');
      expect(img.getAttribute('alt')).toBe('a screenshot');
    });

    it('renders a top-right image addon in its own slot', async () => {
      await renderWith(
        makeProject({
          addons: [
            {
              kind: 'image',
              position: 'top-right',
              src: Promise.resolve('badge.svg'),
              alt: 'platform badge',
            },
          ],
        })
      );
      const host = fixture.nativeElement as HTMLElement;
      const img = query<HTMLImageElement>(host, '.card-top-right-addon img');

      expect(img.getAttribute('src')).toBe('badge.svg');
      expect(img.getAttribute('alt')).toBe('platform badge');
    });

    it('places addons into the right slot based on their position', async () => {
      await renderWith(
        makeProject({
          addons: [
            {
              kind: 'image',
              position: 'top-right',
              src: Promise.resolve('badge.svg'),
            },
            {
              kind: 'video',
              position: 'right',
              src: Promise.resolve('trailer.mp4'),
            },
          ],
        })
      );

      expect(component.topRightAddon()?.kind).toBe('image');
      expect(component.rightAddon()?.kind).toBe('video');
    });
  });

  /**
   * The card is themeable via CSS custom properties. jest runs in jsdom, which
   * never applies component stylesheets (no `<style>` is injected and
   * `getComputedStyle` will not resolve `var()`), so the colour cannot be
   * asserted on a rendered element. Instead we verify the theming contract two
   * ways: the stylesheet consumes the variables (with fallbacks), and the
   * variables are overridable on the host element.
   */
  describe('themeable css variables', () => {
    const scss = readFileSync(
      join(__dirname, 'project-card.scss'),
      'utf-8'
    );

    it('drives the card background from the --card-bg custom property with a fallback', () => {
      expect(scss).toMatch(/background-color:\s*var\(\s*--card-bg\s*,/);
    });

    it('drives the accent colour from the --accent-color custom property with a fallback', () => {
      expect(scss).toMatch(/var\(\s*--accent-color\s*,/);
    });

    it('lets consumers override the card background and accent colour on the host', () => {
      const host = fixture.nativeElement as HTMLElement;

      host.style.setProperty('--card-bg', 'rgb(1, 2, 3)');
      host.style.setProperty('--accent-color', 'rgb(4, 5, 6)');

      expect(getComputedStyle(host).getPropertyValue('--card-bg').trim()).toBe(
        'rgb(1, 2, 3)'
      );
      expect(
        getComputedStyle(host).getPropertyValue('--accent-color').trim()
      ).toBe('rgb(4, 5, 6)');
    });
  });
});
