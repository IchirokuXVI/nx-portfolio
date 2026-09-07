import { TestBed } from '@angular/core/testing';
import {
  BackendReadiness,
  provideFakeBrowserFacade,
} from '@portfolio/velista/platform';
import { ProfileStore } from '../account/profile-store';
import { SessionValidation } from './session-validation';
import { TokenStore } from './token-store';

/**
 * What these specs prove is deliberately narrow: that one profile read goes out,
 * and when. What the read *does* to a dead session is the interceptor's and
 * `TokenStore`'s business, proven where those live: the gateway answers a token
 * naming nobody with a 401 (`deleted-account.spec.ts`, over in the gateway), the
 * interceptor answers a 401 with one refresh, and a refused refresh clears the
 * pair (`token-store.spec.ts`). This class only has to ask the question.
 */
describe('SessionValidation', () => {
  let load: jest.Mock;

  function setUp(
    options: { hasSession?: boolean; isBrowser?: boolean } = {}
  ): BackendReadiness {
    load = jest.fn().mockResolvedValue(undefined);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideFakeBrowserFacade(undefined, {
          isBrowser: options.isBrowser ?? true,
        }),
        {
          provide: TokenStore,
          useValue: { hasSession: () => options.hasSession ?? true },
        },
        { provide: ProfileStore, useValue: { load } },
        SessionValidation,
      ],
    });

    const readiness = TestBed.inject(BackendReadiness);
    TestBed.inject(SessionValidation);
    TestBed.tick();
    return readiness;
  }

  it('asks for the profile once the backend has answered ready', () => {
    const readiness = setUp();

    // Nothing before: a request sent while the startup probe is still asking
    // whether a backend exists would fail with the network error this class
    // must ignore, and be spent for nothing.
    expect(load).not.toHaveBeenCalled();

    readiness.reportReady();
    TestBed.tick();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks once per page load, not once per recovery', () => {
    const readiness = setUp();

    readiness.reportReady();
    TestBed.tick();

    // A connection lost mid session moves readiness off `ready`, and a probe
    // brings it back. The session was already proven in this document, and
    // re-proving it would spend a request at the moment the backend is busiest.
    readiness.reportUnreachable();
    TestBed.tick();
    readiness.reportReady();
    TestBed.tick();

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('asks nothing when no session is held', () => {
    const readiness = setUp({ hasSession: false });

    readiness.reportReady();
    TestBed.tick();

    // An anonymous visitor has nothing to prove, and the request would carry no
    // bearer at all.
    expect(load).not.toHaveBeenCalled();
  });

  it('asks nothing under a server render', () => {
    const readiness = setUp({ isBrowser: false });

    readiness.reportReady();
    TestBed.tick();

    expect(load).not.toHaveBeenCalled();
  });
});
