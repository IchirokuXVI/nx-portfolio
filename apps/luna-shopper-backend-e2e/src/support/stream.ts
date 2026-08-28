/**
 * Reading the realtime SSE channel from an e2e spec (plan 0010, section 1).
 *
 * An SSE frame names its event on its own `event:` line and carries only the
 * payload on `data:` — the same split the socket transport makes, where the
 * event name is the channel and the payload is the body (plan 0009, section 3:
 * both transports publish identical payloads). The DomainEvent envelope stays
 * internal to the JetStream hop, so the event name is read off the frame rather
 * than looked for inside the JSON.
 *
 * This reader used to live inside `core-flow.spec.ts` and know one event name.
 * Plan 0029 needs a spec that watches for three, so the parsing lives here and
 * each spec says which frames it is waiting for.
 */

/** One parsed SSE frame: the channel it arrived on and the body it carried. */
export interface StreamFrame {
  event: string;
  payload: unknown;
}

/** Parses the frames a chunk completed, and returns the unfinished remainder. */
function parseFrames(buffer: string): {
  frames: StreamFrame[];
  rest: string;
} {
  // SSE frames are separated by a blank line; each `data:` line holds JSON.
  const chunks = buffer.split('\n\n');
  const rest = chunks.pop() ?? '';
  const frames: StreamFrame[] = [];
  for (const chunk of chunks) {
    let event: string | undefined;
    let json = '';
    for (const line of chunk.split('\n')) {
      if (line.startsWith('event:')) {
        event = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        json += line.slice('data:'.length).trim();
      }
    }
    if (event && json) {
      frames.push({ event, payload: JSON.parse(json) });
    }
  }
  return { frames, rest };
}

/**
 * Read a zone's SSE stream until `done` accepts the frames collected so far, or
 * the timeout fires. Only the named events are collected, so a heartbeat or an
 * unrelated event in the same zone does not shift the positions a spec asserts
 * on; order within the result is arrival order.
 */
export async function readEvents(
  streamUrl: string,
  token: string,
  wanted: readonly string[],
  done: (frames: StreamFrame[]) => boolean,
  timeoutMs: number
): Promise<StreamFrame[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const collected: StreamFrame[] = [];
  try {
    const res = await fetch(streamUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      signal: controller.signal,
    });
    if (!res.body) {
      throw new Error('stream had no body');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done: ended, value } = await reader.read();
      if (ended) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseFrames(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.frames) {
        if (wanted.includes(frame.event)) {
          collected.push(frame);
        }
      }
      if (done(collected)) {
        return collected;
      }
    }
    throw new Error(
      `stream ended after ${collected
        .map((f) => f.event)
        .join(', ')} without satisfying the spec`
    );
  } finally {
    clearTimeout(timer);
  }
}

/** Read the stream until one frame of the named event arrives. */
export async function waitForEvent(
  streamUrl: string,
  token: string,
  event: string,
  timeoutMs: number
): Promise<unknown> {
  const frames = await readEvents(
    streamUrl,
    token,
    [event],
    (collected) => collected.length > 0,
    timeoutMs
  );
  return frames[0].payload;
}
