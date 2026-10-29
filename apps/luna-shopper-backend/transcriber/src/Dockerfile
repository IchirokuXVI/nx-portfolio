# Luna Shopper transcriber image (plan 0235): faster-whisper behind a small HTTP
# service, one clip at a time.
#
# Unlike the six Node services there is no `dist` to copy: the build context is
# this directory, which holds the whole service, and the image installs it.
#
# No model is baked in. The models (about 2 GB for both) live on a volume under
# HF_HOME, downloaded on the first start at the pinned revisions and kept, so a
# build of a 300 line service never pushes a 2 GB layer (section 5.1).
#
# The base is pinned by digest, like the Node images, so the runtime is identical
# until somebody changes this line on purpose. Bump it with
# `docker buildx imagetools inspect python:3.12-slim --format '{{println .Manifest.Digest}}'`.
FROM python:3.12-slim@sha256:dddfd7e07f9d15aeeca61529320492139d21cac7f0070c00609243e51e4e0016 AS base

# ffmpeg decodes whatever container the browser recorded (webm, ogg, mp4, wav).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
  PIP_ROOT_USER_ACTION=ignore

# --no-deps, then `pip check`: every package comes from the pinned list or the
# build fails, so nothing arrives at a version nobody chose.
COPY requirements.txt ./
RUN pip install --no-cache-dir --no-deps -r requirements.txt && pip check

COPY app.py clip_queue.py ./

ENV HF_HOME=/models \
  HF_HUB_DISABLE_TELEMETRY=1 \
  PYTHONUNBUFFERED=1 \
  PYTHONDONTWRITEBYTECODE=1

# The tests run inside the build, so CI needs Docker and no Python on the runner
# (section 2.4): `docker build --target test`. A default build skips this stage,
# because the runtime stage below does not depend on it.
FROM base AS test
COPY requirements-test.txt test_app.py ./
RUN pip install --no-cache-dir --no-deps -r requirements-test.txt && pip check \
  && python -m pytest -q -p no:cacheprovider test_app.py

FROM base AS runtime
# Uid 1000, the uid the chart runs every backend pod as. /models belongs to it, so
# an empty volume mounted there is writable for the first download.
RUN useradd --uid 1000 --no-create-home --shell /usr/sbin/nologin transcriber \
  && mkdir -p /models \
  && chown 1000:1000 /models
USER 1000

# Documentation only; the port comes from PORT at runtime.
EXPOSE 3007

# Exec form so Python is PID 1 and receives SIGTERM directly.
CMD ["python", "app.py"]
