// SPDX-License-Identifier: GPL-3.0-or-later
export interface SseMessage {
  event: string;
  data: string;
}

export async function* parseSse(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<SseMessage> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "message";
  let data: string[] = [];

  const dispatch = (): SseMessage | undefined => {
    if (data.length === 0) {
      event = "message";
      return undefined;
    }
    const message = { event, data: data.join("\n") };
    event = "message";
    data = [];
    return message;
  };

  const processLine = (rawLine: string): SseMessage | undefined => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") return dispatch();
    if (line.startsWith(":")) return undefined;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    if (field === "data") data.push(value);
    return undefined;
  };

  try {
    while (!signal?.aborted) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const message = processLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        if (message) yield message;
        newline = buffer.indexOf("\n");
      }
      if (done) break;
    }
    if (buffer.length > 0) {
      const message = processLine(buffer);
      if (message) yield message;
    }
    const finalMessage = dispatch();
    if (finalMessage) yield finalMessage;
  } finally {
    if (signal?.aborted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
