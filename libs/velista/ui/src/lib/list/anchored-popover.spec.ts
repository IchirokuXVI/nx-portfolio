import {
  CdkConnectedOverlay,
  type ConnectedPosition,
} from '@angular/cdk/overlay';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  AnchoredPopover,
  type AnchoredPopoverAlign,
  type AnchoredPopoverSide,
} from './anchored-popover';

/**
 * Where an anchored popover tries to sit. The overlay takes the first place of the
 * list that fits, so the order of the list is the side it prefers.
 *
 * The places are read off the CDK directive, which is what the component hands
 * them to. Nothing is opened here.
 */
let anchor: HTMLButtonElement;

async function render(inputs: {
  readonly align?: AnchoredPopoverAlign;
  readonly side?: AnchoredPopoverSide;
}): Promise<ComponentFixture<AnchoredPopover>> {
  TestBed.resetTestingModule();
  await TestBed.configureTestingModule({
    imports: [AnchoredPopover],
  }).compileComponents();

  anchor = document.createElement('button');
  document.body.append(anchor);

  const fixture = TestBed.createComponent(AnchoredPopover);
  fixture.componentRef.setInput('origin', anchor);
  if (inputs.align !== undefined) {
    fixture.componentRef.setInput('align', inputs.align);
  }
  if (inputs.side !== undefined) {
    fixture.componentRef.setInput('side', inputs.side);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  return fixture;
}

function positions(
  fixture: ComponentFixture<AnchoredPopover>
): ConnectedPosition[] {
  const node = fixture.debugElement.queryAllNodes(
    By.directive(CdkConnectedOverlay)
  )[0];
  return node?.injector.get(CdkConnectedOverlay).positions ?? [];
}

/** Which side of the anchor each place is on, in the order they are tried. */
function sides(fixture: ComponentFixture<AnchoredPopover>): string[] {
  return positions(fixture).map((place) =>
    place.originY === 'top' && place.overlayY === 'bottom' ? 'above' : 'below'
  );
}

afterEach(() => {
  anchor?.remove();
});

describe('AnchoredPopover', () => {
  it('tries above the anchor first unless told otherwise', async () => {
    const fixture = await render({});

    expect(sides(fixture)).toEqual(['above', 'below']);
  });

  it('tries below the anchor first when asked, and keeps above as the second place', async () => {
    const fixture = await render({ side: 'below' });

    expect(sides(fixture)).toEqual(['below', 'above']);
  });

  it('holds the same two places on either side, in the other order', async () => {
    const above = positions(await render({ side: 'above' }));
    const below = positions(await render({ side: 'below' }));

    expect(below).toEqual([...above].reverse());
  });

  it('keeps the edge it lines up with when the side changes', async () => {
    const start = await render({ side: 'below' });
    expect(positions(start).map((place) => place.originX)).toEqual([
      'start',
      'start',
    ]);

    const end = await render({ align: 'end', side: 'below' });
    expect(sides(end)).toEqual(['below', 'above']);
    expect(positions(end).map((place) => place.originX)).toEqual([
      'end',
      'end',
    ]);
    expect(positions(end).map((place) => place.overlayX)).toEqual([
      'end',
      'end',
    ]);
  });

  it('pushes the popover away from the anchor on each side', async () => {
    const fixture = await render({ side: 'below' });

    // Below is a gap under the anchor, and above is a gap over it.
    expect(positions(fixture).map((place) => place.offsetY)).toEqual([8, -8]);
  });

  it('gives the side that was asked for after it changes', async () => {
    const fixture = await render({});

    fixture.componentRef.setInput('side', 'below');
    fixture.detectChanges();

    expect(sides(fixture)).toEqual(['below', 'above']);
  });
});
