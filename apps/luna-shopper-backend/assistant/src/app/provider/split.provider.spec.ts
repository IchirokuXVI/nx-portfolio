import { FakeModelProvider } from './fake-model.provider';
import { ModelTurnRole } from './model-provider';
import { SplitModelProvider } from './split.provider';

/**
 * The split (plan 0224, section 3): one provider answers, the other hears, and
 * each flag comes from the provider that does that job. Two fakes and no network
 * (rule A4).
 */
describe('SplitModelProvider', () => {
  const REQUEST = {
    system: 's',
    turns: [{ role: ModelTurnRole.USER, text: 'hola' }],
    tools: [],
    locale: 'es',
  };
  const RECORDING = {
    audio: new Uint8Array([1, 2, 3]),
    mimeType: 'audio/webm',
    locale: 'es',
  };

  it('answers a turn with the first provider only', async () => {
    const turns = new FakeModelProvider([FakeModelProvider.says('Hola.')]);
    const hearing = new FakeModelProvider();

    const reply = await new SplitModelProvider(turns, hearing).generate(
      REQUEST
    );

    expect(reply.text).toBe('Hola.');
    expect(turns.requests).toEqual([REQUEST]);
    expect(hearing.requests).toHaveLength(0);
  });

  it('transcribes with the second provider only', async () => {
    const turns = new FakeModelProvider();
    const hearing = new FakeModelProvider([], ['añade leche']);

    const heard = await new SplitModelProvider(turns, hearing).transcribe(
      RECORDING
    );

    expect(heard).toBe('añade leche');
    expect(hearing.transcriptions).toEqual([RECORDING]);
    expect(turns.transcriptions).toHaveLength(0);
  });

  it('is configured when the provider that answers is, whatever the hearing', () => {
    const turns = new FakeModelProvider();
    const hearing = new FakeModelProvider();
    hearing.configured = false;

    expect(new SplitModelProvider(turns, hearing).configured).toBe(true);

    turns.configured = false;
    hearing.configured = true;
    expect(new SplitModelProvider(turns, hearing).configured).toBe(false);
  });

  it('hears only when the hearing provider has a key and takes audio', () => {
    // A Claude key and no Gemini key: an assistant with no microphone.
    const turns = new FakeModelProvider();
    turns.transcriptionSupported = false;
    const hearing = new FakeModelProvider();

    expect(new SplitModelProvider(turns, hearing).transcriptionSupported).toBe(
      true
    );

    hearing.configured = false;
    expect(new SplitModelProvider(turns, hearing).transcriptionSupported).toBe(
      false
    );

    hearing.configured = true;
    hearing.transcriptionSupported = false;
    expect(new SplitModelProvider(turns, hearing).transcriptionSupported).toBe(
      false
    );
  });
});
