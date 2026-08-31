import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RokuTranslatorTestingModule } from '@portfolio/localization/rokutranslator-angular';
import type { CommentRowVm } from '@portfolio/velista/models';
import { CommentRow } from './comment-row';

/**
 * Plan 0041, section 9.2: a voice comment says its words were written by a machine.
 *
 * Plan 0039 made the transcript **be** the comment, in the same bubble, in the same
 * type, under the same person's name, and answered the cost of that by keeping the
 * recording: the audio is the record and the transcript is the reading of it. That
 * answer only works if the reader can tell which of the two they are looking at.
 */
function vm(overrides: Partial<CommentRowVm> = {}): CommentRowVm {
  return {
    id: 'c1',
    author: 'Marta',
    body: 'Get the big one',
    recording: null,
    transcription: null,
    pending: false,
    mine: false,
    createdAt: new Date('2026-08-30T10:00:00Z'),
    ...overrides,
  } as CommentRowVm;
}

async function render(
  comment: CommentRowVm
): Promise<ComponentFixture<CommentRow>> {
  TestBed.resetTestingModule();

  await TestBed.configureTestingModule({
    imports: [CommentRow, RokuTranslatorTestingModule.forTesting()],
  }).compileComponents();

  const fixture = TestBed.createComponent(CommentRow);
  fixture.componentRef.setInput('comment', comment);
  fixture.detectChanges();

  return fixture;
}

function source(fixture: ComponentFixture<CommentRow>): string | null {
  return (
    (fixture.nativeElement as HTMLElement).querySelector('.source')
      ?.textContent ?? null
  );
}

describe('CommentRow, where the words came from', () => {
  it('says a transcribed comment was written automatically', async () => {
    const fixture = await render(
      vm({
        transcription: 'DONE',
        recording: { src: '/audio/c1', durationSeconds: 12 },
      })
    );

    expect(source(fixture)).toContain('autoTranscript');
  });

  it('says nothing of the kind on a typed comment', async () => {
    // `transcription` is null exactly when somebody typed it, which is the whole
    // reason this is read off that field rather than inferred from a recording.
    const fixture = await render(vm());

    expect(source(fixture)).toBeNull();
  });

  it('says nothing while the transcription is still running', async () => {
    // The neutral phrase in the body already says the words are not here yet.
    // Saying a machine wrote the sentence that says no machine has written one
    // would be nonsense.
    const fixture = await render(
      vm({
        body: '',
        transcription: 'PENDING',
        recording: { src: '/audio/c1', durationSeconds: 12 },
      })
    );

    expect(source(fixture)).toBeNull();
  });

  it('says nothing when the transcription failed', async () => {
    const fixture = await render(
      vm({
        body: '',
        transcription: 'FAILED',
        recording: { src: '/audio/c1', durationSeconds: 12 },
      })
    );

    expect(source(fixture)).toBeNull();
  });

  it('says nothing on a bubble that is still being sent', async () => {
    const fixture = await render(vm({ body: '', pending: true }));

    expect(source(fixture)).toBeNull();
  });
});
