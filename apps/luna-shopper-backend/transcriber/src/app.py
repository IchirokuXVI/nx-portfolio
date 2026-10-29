"""The transcriber (plan 0235): a recording in, the words in it out.

A small HTTP service around faster-whisper. The assistant is its only caller,
inside the cluster, and nothing routes to it from outside. It holds two models:
`small` for an assistant turn, where somebody is waiting, and `large-v3-turbo`
for a voice comment, where nobody is and accuracy matters more. One clip runs at
a time (see clip_queue.py).

Nothing a person said is ever logged here, at any level: not the audio, not a
hash of it, and not the words (plan 0041, section 6). A log line carries the
purpose, the model, the outcome and durations, and nothing else.

The reference for this file is the owner's test bench (`app.py` in
`D:\\Projects\\whisper-test`), where the timings in the plan were measured.
"""

from __future__ import annotations

import json
import logging
import math
import os
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

import numpy as np
import psutil
from fastapi import FastAPI, File, Form, Header, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from clip_queue import ClipQueue, Expired, QueueFull

SAMPLE_RATE = 16000
MIN_SECONDS = 0.2
PURPOSES = ('turn', 'comment')

# The Hugging Face commit of each model, so a new upload of a model cannot change
# what a running deployment writes down (section 5.1). These are the revisions on
# the owner's bench, where the timings in the plan were taken.
DEFAULT_REVISIONS = {
    'small': '536b0662742c02347bc0e980a01041f333bce120',
    'large-v3-turbo': '0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf',
}

log = logging.getLogger('transcriber')


class Segment(Protocol):
    text: str


class WhisperLike(Protocol):
    """What this service needs of a model. The tests hand in a fake."""

    def transcribe(self, audio: np.ndarray, **options: Any) -> tuple[Any, Any]: ...


@dataclass(frozen=True)
class Settings:
    turn_model: str = 'small'
    comment_model: str = 'large-v3-turbo'
    threads: int = 2
    preload: bool = True
    max_seconds_turn: float = 300
    max_seconds_comment: float = 90
    queue_depth: int = 8
    busy_retry_seconds: int = 10
    vad_filter: bool = True
    beam_size: int = 1
    revisions: dict[str, str] = field(default_factory=lambda: dict(DEFAULT_REVISIONS))

    @property
    def models(self) -> list[str]:
        """The distinct models this deployment loads, turn first."""
        return list(dict.fromkeys([self.turn_model, self.comment_model]))

    def model_for(self, purpose: str) -> str:
        return self.turn_model if purpose == 'turn' else self.comment_model

    def max_seconds(self, purpose: str) -> float:
        return self.max_seconds_turn if purpose == 'turn' else self.max_seconds_comment

    @staticmethod
    def from_env(env: dict[str, str] | None = None) -> 'Settings':
        env = dict(os.environ if env is None else env)

        def text(key: str, default: str) -> str:
            value = env.get(key, '').strip()
            return value or default

        def flag(key: str, default: bool) -> bool:
            value = env.get(key, '').strip().lower()
            if not value:
                return default
            return value in ('1', 'true', 'yes', 'on')

        revisions = dict(DEFAULT_REVISIONS)
        for pair in env.get('TRANSCRIBER_MODEL_REVISIONS', '').split(','):
            name, _, revision = pair.strip().partition('=')
            if name and revision:
                revisions[name.strip()] = revision.strip()

        return Settings(
            turn_model=text('TRANSCRIBER_TURN_MODEL', 'small'),
            comment_model=text('TRANSCRIBER_COMMENT_MODEL', 'large-v3-turbo'),
            threads=int(text('TRANSCRIBER_THREADS', '2')),
            preload=flag('TRANSCRIBER_PRELOAD', True),
            max_seconds_turn=float(text('TRANSCRIBER_MAX_SECONDS_TURN', '300')),
            max_seconds_comment=float(text('TRANSCRIBER_MAX_SECONDS_COMMENT', '90')),
            queue_depth=int(text('TRANSCRIBER_QUEUE_DEPTH', '8')),
            busy_retry_seconds=int(text('TRANSCRIBER_BUSY_RETRY_SECONDS', '10')),
            vad_filter=flag('TRANSCRIBER_VAD_FILTER', True),
            beam_size=int(text('TRANSCRIBER_BEAM_SIZE', '1')),
            revisions=revisions,
        )


def load_whisper(name: str, settings: Settings) -> WhisperLike:
    """The real model, from the cache under HF_HOME, downloaded there once."""
    from faster_whisper import WhisperModel

    return WhisperModel(
        name,
        device='cpu',
        compute_type='int8',
        cpu_threads=settings.threads,
        revision=settings.revisions.get(name),
    )


def decode(data: bytes) -> np.ndarray | None:
    """Any container ffmpeg reads, as 16 kHz mono float32. None when it cannot."""
    result = subprocess.run(
        ['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', 'pipe:0',
         '-ac', '1', '-ar', str(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
        input=data, capture_output=True, check=False,
    )
    # stderr is dropped unread: it can quote the container's own metadata, and
    # nothing about a recording belongs in a log or a reply.
    if result.returncode != 0:
        return None
    return np.frombuffer(result.stdout, dtype=np.float32)


def known_languages() -> frozenset[str]:
    try:
        from faster_whisper.tokenizer import _LANGUAGE_CODES  # type: ignore[attr-defined]

        return frozenset(_LANGUAGE_CODES)
    except Exception:  # noqa: BLE001 (the two the app speaks are always accepted)
        return frozenset({'es', 'en'})


def problem(status: int, code: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={'code': code, **extra})


class Models:
    """The loaded models, and whether every configured one is in memory yet."""

    def __init__(self, settings: Settings, load_model: Callable[[str, Settings], WhisperLike]) -> None:
        self._settings = settings
        self._load_model = load_model
        self._models: dict[str, WhisperLike] = {}
        self._load_seconds: dict[str, float] = {}
        self._lock = threading.Lock()

    def get_model(self, name: str) -> WhisperLike:
        with self._lock:
            if name not in self._models:
                started = time.perf_counter()
                self._models[name] = self._load_model(name, self._settings)
                self._load_seconds[name] = time.perf_counter() - started
                log_event('transcriber.model.loaded', model=name,
                          loadMs=round(self._load_seconds[name] * 1000))
            return self._models[name]

    @property
    def ready(self) -> bool:
        if not self._settings.preload:
            return True
        return all(name in self._models for name in self._settings.models)

    def loaded(self) -> dict[str, float]:
        return {name: round(seconds, 1) for name, seconds in self._load_seconds.items()}

    def preload(self, retry_seconds: float = 30) -> None:
        """Load every configured model, trying again until each one is in."""
        for name in self._settings.models:
            while True:
                try:
                    self.get_model(name)
                    break
                except Exception as error:  # noqa: BLE001 (logged by type, retried)
                    log_event('transcriber.model.loadFailed', level=logging.ERROR,
                              model=name, error=type(error).__name__)
                    time.sleep(retry_seconds)


def log_event(event: str, level: int = logging.INFO, **fields: Any) -> None:
    log.log(level, json.dumps({'event': event, **fields}))


def create_app(
    settings: Settings | None = None,
    load_model: Callable[[str, Settings], WhisperLike] = load_whisper,
    preload_retry_seconds: float = 30,
) -> FastAPI:
    settings = settings or Settings.from_env()
    models = Models(settings, load_model)
    clips = ClipQueue(settings.queue_depth, settings.busy_retry_seconds)
    languages = known_languages()

    for name in settings.models:
        if name not in settings.revisions:
            log_event('transcriber.model.unpinned', level=logging.WARNING, model=name)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        if settings.preload:
            threading.Thread(
                target=models.preload, args=(preload_retry_seconds,),
                name='transcriber-preload', daemon=True,
            ).start()
        yield

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.models = models
    app.state.clips = clips

    @app.exception_handler(RequestValidationError)
    async def invalid(_request, _error) -> JSONResponse:
        # FastAPI's own 422 body echoes the input, and the input is a recording.
        return problem(400, 'invalid_request')

    @app.get('/health/live')
    def live() -> dict:
        return {'status': 'ok'}

    @app.get('/health/ready')
    def ready() -> JSONResponse:
        if models.ready:
            return JSONResponse({'status': 'ok', 'models': list(models.loaded())})
        return JSONResponse(status_code=503, content={'status': 'loading'})

    @app.get('/status')
    def status() -> dict:
        return {
            'threads': settings.threads,
            'models': {'turn': settings.turn_model, 'comment': settings.comment_model},
            'loaded': models.loaded(),
            'queue': clips.snapshot(),
            'rssMb': round(psutil.Process().memory_info().rss / 2**20),
        }

    @app.post('/v1/transcribe')
    def transcribe(
        audio: UploadFile = File(...),
        purpose: str = Form(...),
        language: str = Form('auto'),
        x_deadline_ms: str | None = Header(default=None),
    ) -> JSONResponse:
        arrived = time.monotonic()
        if purpose not in PURPOSES:
            return problem(400, 'invalid_request')
        language = language.strip().lower()
        if language != 'auto' and language not in languages:
            return problem(400, 'invalid_request')
        deadline = None
        if x_deadline_ms is not None:
            try:
                deadline = arrived + max(0, int(x_deadline_ms)) / 1000
            except ValueError:
                return problem(400, 'invalid_request')

        model_name = settings.model_for(purpose)
        samples = decode(audio.file.read())
        if samples is None or len(samples) / SAMPLE_RATE < MIN_SECONDS:
            log_event('transcriber.clip', purpose=purpose, model=model_name, outcome='unreadable')
            return problem(400, 'unreadable')
        audio_seconds = round(len(samples) / SAMPLE_RATE, 2)
        if audio_seconds > settings.max_seconds(purpose):
            log_event('transcriber.clip', purpose=purpose, model=model_name,
                      outcome='too_long', audioSeconds=audio_seconds)
            return problem(413, 'too_long', maxSeconds=settings.max_seconds(purpose))

        def work() -> tuple[str, str, int]:
            model = models.get_model(model_name)
            started = time.perf_counter()
            segments, info = model.transcribe(
                samples,
                beam_size=settings.beam_size,
                language=None if language == 'auto' else language,
                vad_filter=settings.vad_filter,
            )
            # The segments are a generator: the model runs while they are read.
            text = ' '.join(segment.text.strip() for segment in segments).strip()
            return text, info.language, round((time.perf_counter() - started) * 1000)

        try:
            clip = clips.submit(purpose, work, deadline)
        except QueueFull as full:
            log_event('transcriber.clip', purpose=purpose, model=model_name,
                      outcome='busy', audioSeconds=audio_seconds)
            return problem(503, 'busy', retryAfterSeconds=full.retry_after_seconds)

        try:
            result = wait_for(clip, clips, deadline)
        except Expired:
            log_event('transcriber.clip', purpose=purpose, model=model_name,
                      outcome='expired', audioSeconds=audio_seconds, waitMs=clip.wait_ms())
            return problem(504, 'expired')
        except Exception as error:  # noqa: BLE001 (named by type, never by content)
            log_event('transcriber.clip', level=logging.ERROR, purpose=purpose, model=model_name,
                      outcome='failed', error=type(error).__name__, audioSeconds=audio_seconds)
            return problem(500, 'failed')

        text, detected, transcribe_ms = result
        wait_ms = clip.wait_ms()
        log_event('transcriber.clip', purpose=purpose, model=model_name, outcome='ok',
                  audioSeconds=audio_seconds, waitMs=wait_ms, transcribeMs=transcribe_ms)
        return JSONResponse({
            'text': text,
            'language': detected,
            'audioSeconds': audio_seconds,
            'model': model_name,
            'waitMs': wait_ms,
            'transcribeMs': transcribe_ms,
        })

    return app


def wait_for(clip, clips: ClipQueue, deadline: float | None):
    """The clip's result, or Expired when the deadline passed before it started.

    A clip that started before the deadline runs to its end and is answered, even
    late: it is never interrupted, and its words are worth more than a 504.
    """
    while True:
        timeout = None if deadline is None else max(0.0, deadline - time.monotonic())
        try:
            return clip.future.result(timeout=timeout)
        except TimeoutError:
            if clips.withdraw(clip):
                raise Expired() from None
            deadline = None


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(name)s %(message)s'))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(os.environ.get('LOG_LEVEL', 'INFO').upper())


if __name__ == '__main__':
    import uvicorn

    configure_logging()
    uvicorn.run(
        create_app(),
        host='0.0.0.0',
        port=int(os.environ.get('PORT', '3007')),
        # The access log names paths and statuses only, and the event lines above
        # already say what happened to each clip, with durations.
        access_log=False,
        log_config=None,
    )
