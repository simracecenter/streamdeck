// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from "vitest";
import { parseSse } from "./sse";

async function collect(chunks: string[]): Promise<unknown[]> {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
      controller.close();
    },
  });
  const result: unknown[] = [];
  for await (const message of parseSse(stream)) result.push(message);
  return result;
}

describe("parseSse", () => {
  it("handles split event lines and chunk boundaries", async () => {
    await expect(collect(["event: sta", "te\ndata: {\"value\":", "1}\n\n"]))
      .resolves.toEqual([{ event: "state", data: "{\"value\":1}" }]);
  });

  it("ignores ping comments", async () => {
    await expect(collect([": ping\n\n", "event: state\ndata: {}\n\n"]))
      .resolves.toEqual([{ event: "state", data: "{}" }]);
  });

  it("joins multiple data lines", async () => {
    await expect(collect(["event: state\ndata: one\ndata: two\n\n"]))
      .resolves.toEqual([{ event: "state", data: "one\ntwo" }]);
  });
});
