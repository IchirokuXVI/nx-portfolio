# Luna Shopper transcriber

Speech to text on the deployment's own machine (backend plan 0235). A small Python
service around faster-whisper: a recording goes in over HTTP, the words in it come
out. The assistant is its only caller, inside the cluster. Nothing outside the cluster
can reach it, and no recording leaves the machine.

It holds two models. `small` writes down a spoken assistant turn, where somebody is
waiting. `large-v3-turbo` writes down a voice comment, where nobody is waiting and
accuracy matters more. One clip runs at a time, and a waiting turn always runs before
a waiting comment.

Nothing a person said is logged, at any level. A log line names the purpose, the
model, the outcome and the durations.

## What to set

Every variable is optional. The defaults are the production settings.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3007` | The HTTP port. |
| `TRANSCRIBER_TURN_MODEL` | `small` | The model for `purpose=turn`. |
| `TRANSCRIBER_COMMENT_MODEL` | `large-v3-turbo` | The model for `purpose=comment`. Set it to `small` on a small machine, and only one model loads. |
| `TRANSCRIBER_THREADS` | `2` | CPU threads per transcription. Match the cores the container gets. |
| `TRANSCRIBER_PRELOAD` | `true` | Load the models at start. `/health/ready` answers 200 only after they are in memory. With `false`, a model loads on its first clip and readiness does not wait. |
| `TRANSCRIBER_MODEL_REVISIONS` | the two pinned below | `name=commit` pairs, comma separated, that add to or replace the pinned Hugging Face revisions. |
| `TRANSCRIBER_MAX_SECONDS_TURN` | `300` | A longer turn is refused with `413 too_long`. |
| `TRANSCRIBER_MAX_SECONDS_COMMENT` | `90` | A longer comment is refused with `413 too_long`. |
| `TRANSCRIBER_QUEUE_DEPTH` | `8` | Clips waiting and running together. One more is `503 busy`. |
| `TRANSCRIBER_BUSY_RETRY_SECONDS` | `10` | The `retryAfterSeconds` of a `503 busy`. |
| `TRANSCRIBER_VAD_FILTER` | `true` | Remove silence before the model sees it. Without it, whisper writes sentences over silence. |
| `TRANSCRIBER_BEAM_SIZE` | `1` | The beam size the timings were measured with. |
| `HF_HOME` | `/models` | Where the models are kept. Set in the image. |

The assistant finds it through its own `TRANSCRIBER_URL`. Empty there means no voice:
the voice route answers 501 and a voice comment settles `UNAVAILABLE`.

The pinned revisions:

| Model | Hugging Face repository | Revision |
| --- | --- | --- |
| `small` | `Systran/faster-whisper-small` | `536b0662742c02347bc0e980a01041f333bce120` |
| `large-v3-turbo` | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | `0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf` |

## The HTTP contract

`POST /v1/transcribe`, `multipart/form-data`, with the fields `audio` (any container
ffmpeg reads), `purpose` (`turn` or `comment`) and `language` (`es`, `en`, any other
code whisper knows, or `auto`). The optional header `X-Deadline-Ms` is how long the
caller will wait. A clip still waiting when that time passes is dropped before it
runs.

A 200 is `{ text, language, audioSeconds, model, waitMs, transcribeMs }`. An empty
`text` is a real answer: nothing recognisable was said. The errors are
`400 invalid_request`, `400 unreadable`, `413 too_long`, `503 busy` with
`retryAfterSeconds`, and `504 expired`.

`GET /health/live` answers while the process runs. `GET /health/ready` answers 200
once the models are loaded. `GET /status` shows the threads, the loaded models with
their load times, the queue and the memory in use.

## Run it

In a cluster, set `lunaShopperBackend.transcriber.enabled: true` in the values file
of the environment. That is the whole switch. It needs a node with two spare cores
and 2.5 Gi, and the first start downloads about 2 GB of models into the volume the
chart creates.

On a dev slot, start it with the slot:

```sh
bash k8s/e2e/luna-shopper-backend/luna-slot.sh --up --voice
```

On its own, from the workspace root:

```sh
docker volume create luna-transcriber-models
npx nx run luna-shopper-backend-transcriber:build:docker
docker run --rm --cpus 2 -m 2560m -p 127.0.0.1:3007:3007 \
  -v luna-transcriber-models:/models \
  nx-portfolio/luna-shopper-backend-transcriber:dev
```

## A host with no internet access

The models are a Hugging Face cache under `HF_HOME`. Copy a `models` folder that
already holds them (a `hub/models--...` tree, for example from another machine's
volume) into the volume, owned by uid 1000:

```sh
docker run --rm -v luna-transcriber-models:/dst -v /path/to/models:/src:ro alpine \
  sh -c 'cp -a /src/. /dst/ && chown -R 1000:1000 /dst'
```

In a cluster, copy it into the claim `luna-shopper-backend-transcriber-models` the
same way, from a pod that mounts it, before the transcriber starts. With the pinned
revisions present, the service loads them and fetches nothing.

## Tests

```sh
npx nx run luna-shopper-backend-transcriber:test
```

The tests run inside the image build (`docker build --target test`), so a machine
needs Docker and no Python. They use a fake model and the real ffmpeg, and no test
loads a real model or reaches the network.
