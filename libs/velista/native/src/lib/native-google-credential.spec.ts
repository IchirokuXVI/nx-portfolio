import { TestBed } from '@angular/core/testing';
import {
  NativeGoogleCredential,
  NativeGoogleCredentialError,
} from './native-google-credential';
import { NATIVE_PLUGINS } from './native-plugins';
import { NativePluginDoubles } from './testing/native-plugin-doubles';

/** A rejection as the Capacitor bridge delivers one: an error with the plugin's code. */
function refusal(code: string): Error {
  return Object.assign(new Error('Android said no'), { code });
}

describe('NativeGoogleCredential', () => {
  let doubles: NativePluginDoubles;
  let credential: NativeGoogleCredential;

  beforeEach(() => {
    doubles = new NativePluginDoubles();
    TestBed.configureTestingModule({
      providers: [{ provide: NATIVE_PLUGINS, useValue: doubles.loader }],
    });
    credential = TestBed.inject(NativeGoogleCredential);
  });

  it('passes the request to the plugin and answers its token', async () => {
    await expect(
      credential.getIdToken({
        serverClientId: 'web-client',
        nonce: 'n1',
        silent: true,
      })
    ).resolves.toBe('id-token');

    expect(doubles.googleRequests).toEqual([
      { serverClientId: 'web-client', nonce: 'n1', silent: true },
    ]);
  });

  it.each(['cancelled', 'no_credential'])(
    'answers null when the plugin says %s, which is no failure',
    async (code) => {
      doubles.googleError = refusal(code);

      await expect(
        credential.getIdToken({
          serverClientId: 'c',
          nonce: 'n',
          silent: false,
        })
      ).resolves.toBeNull();
    }
  );

  it.each(['unavailable', 'failed'])(
    'throws the code when the plugin says %s',
    async (code) => {
      doubles.googleError = refusal(code);

      const error = await credential
        .getIdToken({ serverClientId: 'c', nonce: 'n', silent: false })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(NativeGoogleCredentialError);
      expect((error as NativeGoogleCredentialError).code).toBe(code);
    }
  );

  it('throws failed for a rejection with no code', async () => {
    doubles.googleError = new Error('bridge gone');

    await expect(
      credential.getIdToken({ serverClientId: 'c', nonce: 'n', silent: false })
    ).rejects.toEqual(new NativeGoogleCredentialError('failed'));
  });

  it('throws rather than answering an answer with no token in it', async () => {
    doubles.googleAnswer = { idToken: '' };

    await expect(
      credential.getIdToken({ serverClientId: 'c', nonce: 'n', silent: true })
    ).rejects.toBeInstanceOf(NativeGoogleCredentialError);
  });

  it('asks the plugin to forget the account', async () => {
    await credential.forget();

    expect(doubles.forgets).toBe(1);
  });
});
