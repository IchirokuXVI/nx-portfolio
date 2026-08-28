import { TestBed } from '@angular/core/testing';
import { ConnectionState } from './connection-state';

describe('ConnectionState', () => {
  let state: ConnectionState;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    state = TestBed.inject(ConnectionState);
  });

  it('starts online', () => {
    expect(state.offline()).toBe(false);
  });

  it('goes offline when the browser fires the offline event', () => {
    window.dispatchEvent(new Event('offline'));

    expect(state.offline()).toBe(true);

    window.dispatchEvent(new Event('online'));
    expect(state.offline()).toBe(false);
  });

  it('goes offline on a request failure even while the browser claims to be online', () => {
    // The captive portal case: `navigator.onLine` reports the interface, not
    // reachability, and this is the ordinary situation in a supermarket.
    state.reportNetworkFailure();

    expect(state.offline()).toBe(true);
  });

  it('comes back when a request reaches the server again', () => {
    state.reportNetworkFailure();

    state.reportReachable();

    expect(state.offline()).toBe(false);
  });

  it('stays offline while the browser is offline, even after a reachable report', () => {
    window.dispatchEvent(new Event('offline'));
    state.reportReachable();

    expect(state.offline()).toBe(true);

    window.dispatchEvent(new Event('online'));
  });
});
