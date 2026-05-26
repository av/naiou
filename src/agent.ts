import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";

export type OracleDecision = "Yes" | "No";
export type OracleResult = { type: "decision"; decision: OracleDecision; raw?: string; reasoning?: string };

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
};

type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => unknown | Promise<unknown>;
};

type ToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type AgentOptions = {
  signal?: AbortSignal;
  status?: (message: string) => void;
  debug?: boolean;
};

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultSystemPrompt =
  "You are naiou, a wise and deeply researched yes/no oracle. " +
  "Your job is to help the user by giving the best possible Yes or No answer. " +
  "For simple questions you can answer from general knowledge (e.g. 'Is the sky blue?', 'Is 2+2=5?'), respond immediately without using tools. " +
  "Only use tools when the question requires inspecting the workspace, checking files, or looking up project-specific facts. " +
  "Think step by step in your responses. Explain your analysis, trade-offs, and why this is the most helpful answer. " +
  "Be bold: commit to one answer rather than hedging. " +
  "Everything the user sends gets a Yes or No answer — no exceptions. " +
  "If the input is not a real yes/no question, pick based on vibes: positive/friendly sentiment → Yes, negative/hostile sentiment → No, neutral/random → coin flip.";


let toolLoadId = 0;

export async function askOracle(question: string, options: AgentOptions = {}): Promise<OracleResult> {
  const trimmed = question.trim();

  if (!trimmed) {
    throw new Error("question is required");
  }

  loadConfig();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OpenAI-compatible backend is not configured (OPENAI_API_KEY missing)");
  }

  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `${process.env.SYSTEM_PROMPT || defaultSystemPrompt}\nCWD: ${process.cwd()}\nTime: ${new Date().toISOString()}`,
    },
    { role: "user", content: trimmed },
  ];

  // Turn 1: free-form reasoning and tool exploration (no output constraints, tools enabled)
  for (let turn = 0; turn < maxTurns(); turn += 1) {
    const { tools, schemas } = await loadTools();
    options.status?.(turn === 0 ? "thinking" : `researching (${turn + 1})`);
    const assistant = await streamChatCompletion(messages, schemas, options.signal);
    messages.push(assistant);

    if (!assistant.tool_calls?.length) {
      break;
    }

    for (const toolCall of assistant.tool_calls) {
      const tool = tools[toolCall.function.name];
      const args = parseToolArgs(toolCall.function.arguments);

      options.status?.(describeToolCall(toolCall.function.name, args));

      if (!tool) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: unknown tool "${toolCall.function.name}".`,
        });
        continue;
      }

      try {
        const result = await tool(args);
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: typeof result === "string" ? result : JSON.stringify(result),
        });
      } catch (error) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
  }

  // Turn 2: constrained final answer (no tools, JSON schema forces structured output)
  options.status?.("deciding");
  const assistant = await streamChatCompletion(messages, [], options.signal, true);
  messages.push(assistant);
  const result = parseResult(assistant.content);
  if (options.debug) {
    return { ...result, raw: assistant.content };
  }
  return result;
}

export const runAgent = askOracle;

const MISSING_BACKEND_MESSAGE = `OpenAI-compatible backend is not configured.

naiou requires an OPENAI_API_KEY.

Provide it using one of:

  • Environment variable:
      export OPENAI_API_KEY=sk-...

  • Config file at ~/.naiou/config.json (or $NAIOU_HOME/config.json):
      {
        "OPENAI_API_KEY": "sk-...",
        "OPENAI_BASE_URL": "https://api.openai.com",  // optional
        "MODEL": "gpt-5.4"                            // optional
      }

After setting one of the above, run 'naiou' again.
`;

export function ensureOpenAIConfigured(): void {
  loadConfig();
  if (!process.env.OPENAI_API_KEY) {
    console.error(MISSING_BACKEND_MESSAGE);
    process.exit(1);
  }
}

function loadConfig(): void {
  const configHome = process.env.NAIOU_HOME || `${homedir()}/.naiou`;
  const configPath = join(configHome, "config.json");

  if (!existsSync(configPath)) {
    return;
  }

  const config = JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown>;

  for (const [key, value] of Object.entries(config)) {
    process.env[key] ||= typeof value === "string" ? value : JSON.stringify(value);
  }
}

async function loadTools(): Promise<{
  tools: Record<string, ToolDefinition["handler"]>;
  schemas: Array<Record<string, unknown>>;
}> {
  const toolsDir = join(repoRoot, "tools");

  if (!existsSync(toolsDir)) {
    return { tools: {}, schemas: [] };
  }

  const modules = await Promise.all(
    readdirSync(toolsDir)
      .filter((file) => file.endsWith(".mjs"))
      .sort()
      .map(async (file) => import(`${pathToFileURL(join(toolsDir, file)).href}?v=${++toolLoadId}`)),
  );
  const definitions = modules.map((module) => module.default as ToolDefinition);
  const tools = Object.fromEntries(definitions.map((definition) => [definition.name, definition.handler]));
  const schemas = definitions.map((definition) => ({
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters,
    },
  }));

  return { tools, schemas };
}

async function streamChatCompletion(
  messages: ChatMessage[],
  tools: Array<Record<string, unknown>>,
  signal?: AbortSignal,
  constrained = false,
): Promise<ChatMessage> {
  const response = await fetch(chatCompletionsUrl(), {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.MODEL || "gpt-5.4",
      messages,
      tools: tools.length > 0 ? tools : undefined,
      stream: true,
      ...(process.env.NAIOU_API_PARAMS ? JSON.parse(process.env.NAIOU_API_PARAMS) : {}),
      ...(constrained ? {
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "naiou_decision",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                reasoning: { type: "string" },
                decision: { type: "string", enum: ["Yes", "No"] },
              },
              required: ["reasoning", "decision"],
            },
          },
        },
      } : {}),
      ...(process.env.REASONING_EFFORT ? { reasoning_effort: process.env.REASONING_EFFORT } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`chat completion failed: HTTP ${response.status} ${body}`);
  }

  if (!response.body) {
    throw new Error("chat completion response has no stream body");
  }

  return parseSse(response.body);
}

async function parseSse(body: ReadableStream<Uint8Array>): Promise<ChatMessage> {
  const decoder = new TextDecoder();
  const message: ChatMessage = { role: "assistant", content: "" };
  let buffer = "";

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let boundary = buffer.indexOf("\n\n");

    while (boundary >= 0) {
      const event = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      readSseEvent(event, message);
      boundary = buffer.indexOf("\n\n");
    }
  }

  if (buffer.trim()) {
    readSseEvent(buffer, message);
  }

  return message;
}

function readSseEvent(event: string, message: ChatMessage): void {
  for (const line of event.split("\n")) {
    if (!line.startsWith("data: ")) {
      continue;
    }

    const data = line.slice("data: ".length);

    if (data === "[DONE]") {
      continue;
    }

    const json = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string;
          tool_calls?: Array<{
            index: number;
            id?: string;
            type?: "function";
            function?: { name?: string; arguments?: string };
          }>;
        };
      }>;
    };
    const delta = json.choices?.[0]?.delta;

    if (!delta) {
      continue;
    }

    if (delta.content) {
      message.content += delta.content;
    }

    if (delta.tool_calls) {
      message.tool_calls ||= [];

      for (const toolCall of delta.tool_calls) {
        const slot =
          message.tool_calls[toolCall.index] ||
          (message.tool_calls[toolCall.index] = {
            id: "",
            type: "function",
            function: { name: "", arguments: "" },
          });

        if (toolCall.id) {
          slot.id = toolCall.id;
        }

        if (toolCall.type) {
          slot.type = toolCall.type;
        }

        if (toolCall.function?.name) {
          slot.function.name += toolCall.function.name;
        }

        if (toolCall.function?.arguments) {
          slot.function.arguments += toolCall.function.arguments;
        }
      }
    }
  }
}

function parseResult(content: string): OracleResult {
  const text = content.trim();

  if (text === "Yes" || text === "No") {
    return { type: "decision", decision: text };
  }

  try {
    const parsed = JSON.parse(text) as { kind?: unknown; decision?: unknown; reasoning?: unknown };

    if (parsed.decision === "Yes" || parsed.decision === "No") {
      return { type: "decision", decision: parsed.decision, reasoning: String(parsed.reasoning || "") };
    }
  } catch {
    const match = text.match(/\b(Yes|No)\b/);
    if (match) {
      return { type: "decision", decision: match[1] as OracleDecision };
    }
  }

  throw new Error(`invalid final oracle result: ${text}`);
}

function describeToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_files":
      return `listing ${args.path || "."}`;
    case "read_file":
      return `reading ${args.path || "?"}`;
    case "search_files":
      return `searching "${args.query || ""}"`;
    case "run_command": {
      const cmd = String(args.command || "");
      const cmdArgs = Array.isArray(args.args) ? args.args.map(String) : [];
      return `running ${[cmd, ...cmdArgs].join(" ")}`;
    }
    default:
      return name;
  }
}

function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function chatCompletionsUrl(): string {
  const root = (process.env.OPENAI_BASE_URL || "https://api.openai.com").replace(/\/+$/, "").replace(/\/v1$/, "");

  return `${root}/v1/chat/completions`;
}

function maxTurns(): number {
  const configured = Number(process.env.NAIOU_MAX_TURNS || 8);

  return Number.isFinite(configured) && configured > 0 ? configured : 8;
}
