"""The transcriber's contract, against a fake model (plan 0235, section 11).

No test here loads a real model or reaches the network (rule A4). The recordings
are WAV files written by the test itself and decoded by the real ffmpeg, so the
decode path is the one the service runs.
"""

from __future__ import annotations

import io
import logging
import re
import threading
import time
import wave
from dataclasses import dataclass

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import Settings, cpu_threads, create_app

TRANSCRIPT = 'el secreto de la lista de la compra'


def wav(seconds: float) -> bytes:
    """A tone of the given length, as a 16 kHz mono WAV."""
    t = np.arange(int(16000 * seconds)) / 16000
    samples = (np.sin(2 * np.pi * 440 * t) * 8000).astype('<i2')
    out = io.BytesIO()
    with wave.open(out, 'wb') as file:
        file.setnchannels(1)
        file.setsampwidth(2)
        file.setframerate(16000)
        file.writeframes(samples.tobytes())
    return out.getvalue()


@dataclass
class Info:
    language: str


@dataclass
class Segment:
    text: str


class FakeModel:
    """Records each call. With a gate, every call waits on it before answering."""

    def __init__(self, name: str, calls: list, gate: threading.Event | None) -> None:
        self.name = name
        self.calls = calls
        self.gate = gate

    def transcribe(self, audio, **options):
        self.calls.append((self.name, round(len(audio) / 16000, 1), options))
        if self.gate is not None:
            self.gate.wait(10)
        return iter([Segment(f' {TRANSCRIPT} ')]), Info(options.get('language') or 'es')


class Harness:
    def __init__(self, gate: threading.Event | None = None, load_gate: threading.Event | None = None,
                 **settings) -> None:
        self.calls: list = []
        self.loaded: list = []
        self.gate = gate

        def load(name: str, _settings: Settings) -> FakeModel:
            if load_gate is not None:
                load_gate.wait(10)
            self.loaded.append(name)
            return FakeModel(name, self.calls, gate)

        options = {'preload': False, **settings}
        self.app = create_app(Settings(**options), load_model=load, preload_retry_seconds=0.01)
        self.client = TestClient(self.app)

    def post(self, seconds: float = 1.0, purpose: str = 'turn', language: str = 'es',
             headers: dict | None = None, body: bytes | None = None):
        return self.client.post(
            '/v1/transcribe',
            files={'audio': ('clip.wav', wav(seconds) if body is None else body, 'audio/wav')},
            data={'purpose': purpose, 'language': language},
            headers=headers or {},
        )

    def queued(self) -> int:
        snapshot = self.app.state.clips.snapshot()
        return snapshot['turn'] + snapshot['comment'] + snapshot['running']

    def wait_until(self, condition, timeout: float = 5.0) -> None:
        deadline = time.monotonic() + timeout
        while not condition():
            if time.monotonic() > deadline:
                raise AssertionError('timed out waiting for the queue')
            time.sleep(0.01)


def in_background(call) -> tuple[threading.Thread, list]:
    result: list = []
    thread = threading.Thread(target=lambda: result.append(call()), daemon=True)
    thread.start()
    return thread, result


def test_a_clip_is_transcribed_with_every_field():
    h = Harness()
    response = h.post(seconds=1.5)

    assert response.status_code == 200
    body = response.json()
    assert body['text'] == TRANSCRIPT
    assert body['language'] == 'es'
    assert body['audioSeconds'] == pytest.approx(1.5, abs=0.05)
    assert body['model'] == 'small'
    assert isinstance(body['waitMs'], int) and body['waitMs'] >= 0
    assert isinstance(body['transcribeMs'], int) and body['transcribeMs'] >= 0
    assert set(body) == {'text', 'language', 'audioSeconds', 'model', 'waitMs', 'transcribeMs'}


def test_the_settings_reach_the_model():
    h = Harness()
    h.post(language='auto')

    _, _, options = h.calls[0]
    assert options == {'beam_size': 1, 'language': None, 'vad_filter': True}


def test_purpose_picks_the_model():
    h = Harness()

    assert h.post(purpose='turn').json()['model'] == 'small'
    assert h.post(purpose='comment').json()['model'] == 'large-v3-turbo'
    assert h.loaded == ['small', 'large-v3-turbo']


def test_an_unknown_purpose_or_language_is_refused():
    h = Harness()

    unknown_purpose = h.post(purpose='dictation')
    assert unknown_purpose.status_code == 400
    assert unknown_purpose.json() == {'code': 'invalid_request'}
    assert h.post(language='xx').status_code == 400
    missing = h.client.post('/v1/transcribe', data={'purpose': 'turn'})
    assert missing.status_code == 400
    assert missing.json() == {'code': 'invalid_request'}
    assert h.calls == []


def test_a_too_long_clip_is_refused_before_it_is_queued():
    h = Harness(max_seconds_turn=2, max_seconds_comment=1)

    turn = h.post(seconds=2.5, purpose='turn')
    comment = h.post(seconds=1.5, purpose='comment')

    assert turn.status_code == 413
    assert turn.json() == {'code': 'too_long', 'maxSeconds': 2}
    assert comment.status_code == 413
    assert h.calls == []
    assert h.queued() == 0


def test_an_empty_or_unreadable_clip_is_refused():
    h = Harness()

    assert h.post(seconds=0.1).json() == {'code': 'unreadable'}
    assert h.post(body=b'').status_code == 400
    garbage = h.post(body=b'this is not a recording at all')
    assert garbage.status_code == 400
    assert garbage.json() == {'code': 'unreadable'}
    assert h.calls == []


def test_a_turn_queued_after_a_comment_runs_before_it():
    gate = threading.Event()
    h = Harness(gate=gate)

    # The worker is busy with a first comment, so the next two wait in their lanes.
    first, _ = in_background(lambda: h.post(seconds=1.0, purpose='comment'))
    h.wait_until(lambda: len(h.calls) == 1)
    comment, _ = in_background(lambda: h.post(seconds=2.0, purpose='comment'))
    h.wait_until(lambda: h.app.state.clips.snapshot()['comment'] == 1)
    turn, _ = in_background(lambda: h.post(seconds=3.0, purpose='turn'))
    h.wait_until(lambda: h.app.state.clips.snapshot()['turn'] == 1)

    gate.set()
    for thread in (first, comment, turn):
        thread.join(10)

    assert [(name, seconds) for name, seconds, _ in h.calls] == [
        ('large-v3-turbo', 1.0),
        ('small', 3.0),
        ('large-v3-turbo', 2.0),
    ]


def test_a_ninth_clip_is_busy():
    gate = threading.Event()
    h = Harness(gate=gate)

    threads = [in_background(lambda: h.post(purpose='comment'))[0] for _ in range(8)]
    h.wait_until(lambda: h.queued() == 8)

    ninth = h.post(purpose='turn')

    gate.set()
    for thread in threads:
        thread.join(10)
    assert ninth.status_code == 503
    assert ninth.json() == {'code': 'busy', 'retryAfterSeconds': 10}
    assert len(h.calls) == 8


def test_a_clip_whose_deadline_passes_while_it_waits_is_never_run():
    gate = threading.Event()
    h = Harness(gate=gate)

    running, _ = in_background(lambda: h.post(seconds=1.0, purpose='comment'))
    h.wait_until(lambda: len(h.calls) == 1)

    started = time.monotonic()
    late = h.post(seconds=2.0, purpose='turn', headers={'X-Deadline-Ms': '200'})
    waited = time.monotonic() - started

    gate.set()
    running.join(10)
    time.sleep(0.1)

    assert late.status_code == 504
    assert late.json() == {'code': 'expired'}
    assert waited < 5
    assert [seconds for _, seconds, _ in h.calls] == [1.0]
    assert h.queued() == 0


def test_ready_waits_for_the_preload():
    load_gate = threading.Event()
    h = Harness(load_gate=load_gate, preload=True)

    with h.client:
        assert h.client.get('/health/live').status_code == 200
        assert h.client.get('/health/ready').status_code == 503

        load_gate.set()
        h.wait_until(lambda: h.client.get('/health/ready').status_code == 200)

    assert h.loaded == ['small', 'large-v3-turbo']


def test_one_model_for_both_purposes_is_loaded_once():
    h = Harness(comment_model='small', preload=True)

    with h.client:
        h.wait_until(lambda: h.client.get('/health/ready').status_code == 200)

    assert h.loaded == ['small']


def test_nothing_logged_carries_the_words(caplog):
    caplog.set_level(logging.DEBUG)
    h = Harness()

    assert h.post().json()['text'] == TRANSCRIPT
    h.post(seconds=0.05)

    assert caplog.records, 'the service logged nothing at all'
    assert 'transcriber.clip' in caplog.text
    assert TRANSCRIPT not in caplog.text
    assert 'secreto' not in caplog.text


def test_settings_read_the_environment():
    settings = Settings.from_env({
        'TRANSCRIBER_TURN_MODEL': 'base',
        'TRANSCRIBER_COMMENT_MODEL': '',
        'TRANSCRIBER_PRELOAD': 'false',
        'TRANSCRIBER_MODEL_REVISIONS': 'base=abc, small=def',
    })

    assert settings.turn_model == 'base'
    assert settings.comment_model == 'large-v3-turbo'
    assert settings.preload is False
    assert settings.vad_filter is True
    assert settings.revisions['base'] == 'abc'
    assert settings.revisions['small'] == 'def'
    assert settings.revisions['large-v3-turbo'] == '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf'


@pytest.mark.parametrize(('quantity', 'threads'), [
    ('2', 2),
    ('1500m', 2),
    ('1000m', 1),
    ('250m', 1),
    ('1.5', 2),
    (' 4 ', 4),
])
def test_threads_read_a_kubernetes_cpu_quantity(quantity, threads):
    # The chart passes the pod's CPU limit as written, and a self hoster may
    # write millicores.
    assert Settings.from_env({'TRANSCRIBER_THREADS': quantity}).threads == threads


@pytest.mark.parametrize('quantity', ['two', '2 cpu', '0', '0m', '-1', '1.5m.'])
def test_threads_refuse_anything_else_by_name(quantity):
    with pytest.raises(ValueError, match=re.escape(repr(quantity))):
        cpu_threads(quantity)
