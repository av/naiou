import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { askOracle } from "../src/agent.js";

const originalFetch = globalThis.fetch;
const savedEnv = { ...process.env };

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe("oracle agent", () => {
  test("shell environment overrides NAIOU_HOME config", async () => {
    const home = join(tmpdir(), `naiou-test-${Date.now()}`);
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "config.json"), JSON.stringify({
      OPENAI_API_KEY: "config-key",
      MODEL: "config-model",
    }));

    process.env.NAIOU_HOME = home;
    process.env.OPENAI_API_KEY = "env-key";
    process.env.OPENAI_BASE_URL = "https://example.test/v1";
    process.env.MODEL = "env-model";

    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const headers = new Headers(init?.headers);
      const body = JSON.parse(String(init?.body));
      expect(headers.get("authorization")).toBe("Bearer env-key");
      expect(body.model).toBe("env-model");

      return streamResponse({ kind: "decision", decision: "Yes", refusal: "" });
    }) as unknown as typeof fetch;

    const result = await askOracle("Is this a yes/no question?");

    expect(result).toEqual({ type: "decision", decision: "Yes" });
    rmSync(home, { recursive: true, force: true });
  });

  test("refuses non-yes-no questions through the same structured response path", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    process.env.OPENAI_BASE_URL = "https://example.test";

    globalThis.fetch = (async () => streamResponse({
      kind: "refusal",
      decision: "No",
      refusal: "Ask a yes/no question.",
    })) as unknown as typeof fetch;

    const result = await askOracle("Tell me a story.");

    expect(result).toEqual({ type: "refusal", message: "Ask a yes/no question." });
  });

  test("bundled file tools reject traversal outside the workspace", async () => {
    const readFile = (await import("../tools/read-file.mjs")).default as { handler: (args: Record<string, unknown>) => unknown };
    const listFiles = (await import("../tools/list-files.mjs")).default as { handler: (args: Record<string, unknown>) => unknown };
    const searchFiles = (await import("../tools/search-files.mjs")).default as { handler: (args: Record<string, unknown>) => unknown };

    expect(() => readFile.handler({ path: "../package.json" })).toThrow("path must stay inside");
    expect(() => listFiles.handler({ path: ".." })).toThrow("path must stay inside");
    expect(() => searchFiles.handler({ query: "x", path: ".." })).toThrow("path must stay inside");
  });
});

function streamResponse(payload: unknown): Response {
  const encoder = new TextEncoder();
  const content = JSON.stringify(payload);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, { status: 200 });
}
