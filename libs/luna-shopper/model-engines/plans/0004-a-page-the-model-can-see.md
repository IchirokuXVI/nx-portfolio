# 0004 A page the model can see

`ask` takes an image. That is the whole of this plan, and it exists because the
leaflet reader (`luna-shopper/leaflet-cli` plan 0001) asks a model to read a
picture of a supermarket page, and today there is no way to hand one over.

Built after `luna-shopper/tools` plan 0001, which moves this library to
`libs/shared/model-engines`. The plan is numbered here because its three
siblings are here, and the whole `plans/` directory moves with the project.

## 1. The contract

```js
engine.ask(prompt, { system, schema, images }) -> { text }
engine.askMany(prompts, { system, schema, images }) -> Array<{ text } | { error }>
```

`images` is an array, empty or absent by default, of

```js
{ mediaType: 'image/png' | 'image/jpeg' | 'image/webp', data: '<base64>' }
```

Every existing caller passes nothing and is unaffected. Nothing else in the
contract moves: `prompt` is still the user half, `system` still the standing
half, `schema` is still a JSON schema or null, and parsing the answer is still
the caller's business.

**The bytes travel as base64 and never as a file path.** A path is a reference
to something outside the call, so two adapters would read the disk, a third
would not, and a test would need a real file to prove any of it. Base64 is also
the only form all three providers accept without translation, because it is what
the Messages API image block and the Ollama `images` array both hold. The caller
reads the file, which is right: the caller is the one that knows a leaflet is a
PDF rendered at 160 dpi.

**`images` belongs to the whole call and not to one prompt.** In `askMany` the
same images reach every prompt, exactly as `system` does. A caller with a
different picture per question calls `ask` per question. This is not a
limitation worth engineering around: the leaflet reader asks one question per
page, and one page is one image.

## 2. Ollama takes an image in one line, and three options it must be given

`POST /api/chat` takes `images` on the message itself, as an array of base64
strings with no media type, which the server sniffs:

```js
messages: [{ role: 'user', content: prompt, images: images.map((i) => i.data) }];
```

That is the whole adapter change. The three options below are not the adapter
change, and each one was measured on a real leaflet page rather than reasoned
about. Section 5 has the numbers.

- **`think: false`.** Thinking is **on by default** for a model that reports the
  `thinking` capability, and `gemma4:12b` does. With it on, the two dense pages
  of a three page sample **never answered at all**: one was streamed for five
  minutes and produced 16,172 tokens of thinking and zero rows, looping verbatim
  from about 100 seconds. The leaflet plan's section 7 has the loop and its
  trigger.
- **`num_predict`.** Ollama **shifts the context window rather than stopping**,
  so a model that falls into a repetition loop generates until something else
  kills it. One page ran eighteen minutes before it was killed by hand, against
  twenty two seconds with a cap. There is no default that saves you: the cap is
  the only thing that ends a bad generation.
- **A wall clock timeout, which the cap does not replace.** A cap ends a
  generation by token count, and a caller still needs to stop waiting. Both are
  needed, and neither collects an answer: three minutes and five minutes on the
  same looping page produced the same nothing.
- **`temperature: 0`.** A reading is a transcription, and the same page must
  answer the same way twice or no baseline means anything.

**What none of these is: a bigger context.** Measured at 16,384 and again at
32,768 on the same page, the answer came back identical field for field. One
image ask here is about 1,577 input tokens, so nothing was ever truncated and a
wider window has nothing to fix. Do not read a stuck local model as a context
problem.

The first two are new to this library and belong in the adapter rather than in
the leaflet caller, because neither is about leaflets. A curation decider that
one day meets a looping local model wants the same cap.

## 3. The Messages API takes content blocks

```js
content: [
  ...images.map((i) => ({
    type: 'image',
    source: { type: 'base64', media_type: i.mediaType, data: i.data },
  })),
  { type: 'text', text: prompt },
];
```

The image goes **before** the text, which is what Anthropic's own guidance says
reads better, and it is free to comply. When `images` is empty the adapter keeps
sending the plain string it sends today, so no existing call changes shape on
the wire.

## 4. `claude -p` has no image flag, and this is the one awkward adapter

There is no `--image`. The installed CLI's help lists `--file`, which downloads
a file resource by id at startup and is not this. The only way a picture reaches
a `claude -p` call is the **Read tool**, pointed at a path.

That collides with the work of plans 0001 and PR #327 head on. `MINIMAL_ARGS`
carries `--tools ''` precisely to remove every tool definition, and it is half of
why a call whose whole reply is `ok` fell from 45,805 input tokens to 2,546. An
image ask has to put one tool back.

So the claude adapter does this, and only when `images` is not empty:

1. Writes each image into the scratch directory `makeScratchDir()` already
   creates, as `image_1.png` and so on.
2. Adds `--tools Read` and `--add-dir <scratch>` to the arguments.
3. Prepends one line to the prompt naming the absolute paths, in order.

Three rules that keep this honest:

- **A text ask is unchanged, byte for byte.** `--tools ''` stays for every call
  with no image, so nothing this library already does gets more expensive. A test
  asserts the argument list for both cases.
- **The scratch directory is removed after the call, image files included.** It
  already is; this only adds files to it.
- **The cost is measured and written down in the leaflet plan, not estimated
  here.** Re-enabling one tool has a token price, an extra agentic turn is
  possible, and both are properties of the running CLI rather than of this
  contract. `luna-shopper/leaflet-cli` plan 0001 section 7 is where that
  measurement is recorded, because it is the plan with a real page to measure.

**The alternative refused**: base64 inside the prompt text. The CLI has no image
content type on stdin, so a base64 blob is read as text, billed as text and
understood as nothing.

**And the alternative that is not refused, and may make this adapter wait.**
`leaflet-cli` plan 0001 section 6 adds a `manual` mode, which renders the pages
and writes one prompt for a person to paste into a real Claude Code session. That
session reads a PNG with its Read tool, at no extra cost, with none of the
argument juggling above. It reaches the same model more cheaply than this adapter
does.

So the claude half of this plan is the **last** thing built, and it is fair to
stop before it. The Ollama half is what the default engine needs, the Messages
API half is four lines, and the claude half exists for a caller that wants a
picture read inside a script without a person. A leaflet is not that caller. If
nothing else asks for it by the time the other two are done, leave it, and let
this section stand as the record of why it costs what it costs.

## 5. What was measured

One page of a Spanish supermarket leaflet (El Jamon, page 1, rendered at 200 dpi,
1654 by 2339 pixels), `gemma4:12b` on Ollama, the committed
`chains/el-jamon/prompt.txt`, on an RTX 4080 SUPER.

| Setting                       | Wall clock | Output tokens | Offers found |
| ----------------------------- | ---------- | ------------- | ------------ |
| default (thinking on, no cap) | 31.8 s     | 1,577         | 2            |
| `think: false`, cap 4,096     | 6.3 s      | 374           | 2            |

The same two offers, the same two prices, five times faster. **Read that as the
mildest form of the problem rather than its size.** Page 1 carries two offers and
is the one page that finishes with thinking on at all. On the two pages of the
sample that carry eight and nine offers, thinking on never produced an answer.

**The context shift is the dangerous one**, because it has no error. Page 5 of
the same leaflet, with the same settings but no `num_predict`, ran for eighteen
minutes at 96% GPU before it was killed by hand. With the cap it answered in
21.6 seconds. Nothing in the envelope says a call is looping, and the request
never returns, so a run started overnight reports nothing at all in the morning.

**An image costs about 256 tokens whatever its size.** `prompt_eval_count` was
1,574 for a prompt of about 1,300 tokens plus a whole page, so the picture is one
tile however many pixels it started with. That reads like the explanation for the
model's wrong digits, and it is worth saying that it is not: the leaflet plan cut
the same pages into four crops, paid four tiles, and measured **no improvement at
all** in the prices. The contract still takes an array, because the Messages API
and Ollama both do, and because a caller may have two pictures of one thing. It
is not a resolution workaround, and no adapter here does any cropping.

## 6. What is tested

Everything runs under `node --test` with no network and no `claude` installed,
as the rest of the library does.

- `ask` with no `images` sends exactly what it sends today, for all three
  adapters. This is the regression that matters and it is asserted on the
  request body and the argument list, not on a mock's call count.
- The Ollama adapter puts `data` into `images` and sends `think`, `num_predict`
  and `temperature` in the body.
- The Messages API adapter builds the block array, image first, with the media
  type it was handed.
- The claude adapter writes the files, names them in the prompt, and adds
  `--tools Read` and `--add-dir` **only** when images are present.
- `askMany` hands the same images to every prompt, and the order of the answers
  is still the order of the prompts.
- An unsupported media type is refused by the library with a named error, before
  any request is made. A provider's own error for a bad image is unreadable.

## 7. What this plan does not do

- **No PDF.** This library never learns what a page is. Rendering a PDF into
  images belongs to the caller, and `leaflet-cli` plan 0001 owns it.
- **No image resizing, cropping or re-encoding.** The caller decides how many
  pixels it wants to pay for. Section 5 says why the caller should care.
- **No new engine.** The registry is untouched. Whether a given model can see at
  all is a property of the model, not of an entry, and asking a text only model
  for a picture reading is a provider error the operator should read as written.
