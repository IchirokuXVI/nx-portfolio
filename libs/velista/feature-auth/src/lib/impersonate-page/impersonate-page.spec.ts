import { Location } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import {
  ImpersonationSession,
  type ImpersonationExchange,
} from '@portfolio/velista/data-access';
import type { SessionTokens } from '@portfolio/velista/models';
import { provideVelistaTesting } from '@portfolio/velista/platform';
import { ImpersonatePage } from './impersonate-page';

const TOKENS: SessionTokens = {
  userId: 'u1',
  kind: 'REGISTERED',
  username: 'marta_r',
  accessToken: 'at',
  refreshToken: 'rt',
};

async function render(
  fragment: string | null,
  answers: ImpersonationExchange[]
) {
  TestBed.resetTestingModule();

  const calls: string[] = [];
  const support = {
    exchange: jest.fn(async (code: string) => {
      calls.push(`exchange ${code}`);
      return answers.shift() ?? { state: 'failed' };
    }),
    begin: jest.fn((tokens: SessionTokens) =>
      calls.push(`begin ${tokens.userId}`)
    ),
  };

  await TestBed.configureTestingModule({
    imports: [ImpersonatePage, RokuTranslatorTestingModule.forTesting()],
    providers: [
      provideRouter([]),
      provideVelistaTesting(),
      { provide: ImpersonationSession, useValue: support },
      { provide: ActivatedRoute, useValue: { snapshot: { fragment } } },
    ],
  }).compileComponents();

  const location = TestBed.inject(Location);
  jest.spyOn(location, 'path').mockReturnValue('/en/auth/impersonate');
  jest
    .spyOn(location, 'replaceState')
    .mockImplementation((path: string) => void calls.push(`replace ${path}`));

  const fixture = TestBed.createComponent(ImpersonatePage);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();

  return { fixture, support, calls, location };
}

function textOf(fixture: { nativeElement: unknown }): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

// Velista `0133`, target 3.
describe('ImpersonatePage', () => {
  it('takes the fragment out of the address before it asks anything', async () => {
    const { calls } = await render('code=abc', [
      { state: 'opened', tokens: TOKENS },
    ]);

    expect(calls[0]).toBe('replace /en/auth/impersonate');
    expect(calls[1]).toBe('exchange abc');
  });

  it('hands a good code to the session, which writes it and leaves the document', async () => {
    const { support, fixture } = await render('code=abc', [
      { state: 'opened', tokens: TOKENS },
    ]);

    expect(support.begin).toHaveBeenCalledWith(TOKENS);
    // Still the spinner: the next thing on screen is home, in a new document.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('lib-outcome-screen')
    ).toBeNull();
  });

  it('says the link no longer works for a code the server refuses, and writes nothing', async () => {
    const { support, fixture } = await render('code=old', [
      { state: 'invalid' },
    ]);

    expect(support.begin).not.toHaveBeenCalled();
    expect(textOf(fixture)).toContain('support.handoff.invalidTitle');
    expect(textOf(fixture)).toContain('support.handoff.invalidBody');
    // No way into the app.
    expect(
      (fixture.nativeElement as HTMLElement).querySelector('button, a')
    ).toBeNull();
  });

  it.each([
    ['no fragment', null],
    ['a fragment with no code', 'other=1'],
    ['an empty code', 'code='],
  ])('says the same for %s, and asks nothing', async (_, fragment) => {
    const { support, fixture } = await render(fragment, []);

    expect(support.exchange).not.toHaveBeenCalled();
    expect(support.begin).not.toHaveBeenCalled();
    expect(textOf(fixture)).toContain('support.handoff.invalidTitle');
  });

  it('offers the same code again when the server did not answer', async () => {
    const { support, fixture } = await render('code=abc', [
      { state: 'failed' },
      { state: 'opened', tokens: TOKENS },
    ]);

    expect(textOf(fixture)).toContain('support.handoff.failedTitle');
    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('button')
      ?.click();
    await fixture.whenStable();

    expect(support.exchange).toHaveBeenLastCalledWith('abc');
    expect(support.begin).toHaveBeenCalledWith(TOKENS);
  });
});
