import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { config as loadEnv } from "dotenv";
import { providerModelCatalog } from "../shared/providerModels.js";

loadEnv({ quiet: true });

type AnthropicMessageRequest = {
  model?: string;
  max_tokens?: number;
  stream?: boolean;
  system?: string | Array<{ type?: string; text?: string }>;
  messages?: Array<{
    role: "user" | "assistant";
    content: string | Array<Record<string, unknown>>;
  }>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: {
    type?: "auto" | "any" | "none" | "tool";
    name?: string;
  };
};

type AnthropicTextBlock = {
  type: "text";
  text: string;
  citations: null;
};

type AnthropicToolUseBlock = {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
};

type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

type AnthropicMessageResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: "end_turn" | "tool_use";
  stop_sequence: null;
  usage: {
    input_tokens: number;
    cache_creation_input_tokens: number | null;
    cache_read_input_tokens: number | null;
    output_tokens: number;
    server_tool_use: null;
  };
};

type OllamaTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

class CompatProxyError extends Error {
  statusCode: number;
  errorType: string;

  constructor(message: string, statusCode = 500, errorType = "api_error") {
    super(message);
    this.name = "CompatProxyError";
    this.statusCode = statusCode;
    this.errorType = errorType;
  }
}

const PORT = Number(process.env.ANTHROPIC_COMPAT_PORT ?? "8792");
const ACTIVE_MODEL = process.env.OLLAMA_MODEL?.trim() || "qwen3";
const OLLAMA_BASE_URL = normalizeBaseUrl(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
const OLLAMA_API_KEY = readConfiguredSecret(process.env.OLLAMA_API_KEY);
const OLLAMA_KEEP_ALIVE = process.env.OLLAMA_KEEP_ALIVE?.trim();
const OLLAMA_NUM_CTX = parseOptionalInt(process.env.OLLAMA_NUM_CTX);
const OLLAMA_NUM_PREDICT = parseOptionalInt(process.env.OLLAMA_NUM_PREDICT);
const LOCAL_PROXY_AUTH_TOKEN = readConfiguredSecret(process.env.ANTHROPIC_AUTH_TOKEN);

const PRIORITY_TOOLS = new Set([
  "Read",
  "Write",
  "Edit",
  "Bash",
  "Grep",
  "Glob",
  "LS",
  "NotebookRead",
  "NotebookEdit",
  "TodoRead",
  "TodoWrite",
  "WebSearch",
  "WebFetch",
]);

const OLLAMA_AGENT_PREFIX = [
  "You are Claw Dev running with a local Ollama model.",
  "Use tools decisively for coding tasks instead of over-explaining.",
  "Prefer concrete file and shell actions over long narration.",
  "Keep plain-text replies concise unless the user explicitly asks for depth.",
].join("\n");

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return sendJson(res, 200, {
        ok: true,
        provider: "ollama",
        model: ACTIVE_MODEL,
      });
    }

    assertLocalProxyAuth(req);

    if (req.method === "GET" && url.pathname === "/v1/models") {
      return sendJson(res, 200, buildModelsPage());
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/models/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/models/".length));
      return sendJson(res, 200, buildModelInfo(id));
    }

    if (req.method === "POST" && url.pathname === "/v1/messages/count_tokens") {
      const body = (await readJson(req)) as AnthropicMessageRequest;
      return sendJson(res, 200, { input_tokens: estimateInputTokens(body) });
    }

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      const body = (await readJson(req)) as AnthropicMessageRequest;
      const result = await handleMessages(body);
      if (body.stream) {
        return sendMessageStream(res, result);
      }
      return sendJson(res, 200, result.message);
    }

    return sendJson(res, 404, {
      type: "error",
      error: {
        type: "not_found_error",
        message: `Unsupported endpoint: ${req.method ?? "GET"} ${url.pathname}`,
      },
    });
  } catch (error) {
    const statusCode = error instanceof CompatProxyError ? error.statusCode : 500;
    const errorType = error instanceof CompatProxyError ? error.errorType : "api_error";
    return sendJson(res, statusCode, {
      type: "error",
      error: {
        type: errorType,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`Claw Dev Ollama proxy listening on http://127.0.0.1:${PORT} (ollama:${ACTIVE_MODEL})\n`);
});

async function handleMessages(body: AnthropicMessageRequest) {
  const requestId = `req_${randomUUID()}`;
  const providerModel = body.model?.trim() || ACTIVE_MODEL;
  const systemInstruction = buildSystemPrompt(normalizeSystemPrompt(body.system));
  const rawMessages = anthropicMessagesToOllamaCompatible(body.messages ?? [], systemInstruction);
  const rawTools = anthropicToolsToOllamaTools(body.tools ?? []);
  const budget = resolveBudgetTokens();
  const { messages, tools } = compactOllamaPayload(systemInstruction, rawMessages, rawTools, budget);

  const responseJson = await requestOllamaChat({
    model: providerModel,
    messages,
    tools: body.tool_choice?.type === "none" ? [] : tools,
    ...(body.max_tokens !== undefined ? { maxTokens: body.max_tokens } : {}),
  });

  const content = ollamaMessageToAnthropicContent(isRecord(responseJson.message) ? responseJson.message : null);
  const responseModel = body.model?.trim() || providerModel;
  const message: AnthropicMessageResponse = {
    id: `msg_${randomUUID()}`,
    type: "message",
    role: "assistant",
    model: responseModel,
    content,
    stop_reason: content.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: estimateInputTokens(body),
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens: estimateOutputTokens(content),
      server_tool_use: null,
    },
  };

  return { requestId, message };
}

async function requestOllamaChat({
  model,
  messages,
  tools,
  maxTokens,
}: {
  model: string;
  messages: Array<Record<string, unknown>>;
  tools: OllamaTool[];
  maxTokens?: number;
}) {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(OLLAMA_API_KEY ? { Authorization: `Bearer ${OLLAMA_API_KEY}` } : {}),
      },
      body: JSON.stringify({
        model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
        ...buildOllamaRuntimeConfig(maxTokens),
        stream: false,
      }),
    });
  } catch (error) {
    throw new CompatProxyError(
      `Could not reach Ollama at ${OLLAMA_BASE_URL}. Make sure the server is running and reachable.\nProvider message: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
      "api_error",
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new CompatProxyError(
      `Ollama request failed for model "${model}". Check that the model is pulled locally and the server is healthy.\nProvider message: ${text}`,
      response.status,
      "invalid_request_error",
    );
  }

  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function resolveBudgetTokens(): number {
  if (OLLAMA_NUM_CTX && OLLAMA_NUM_CTX > 1024) {
    return Math.max(2048, Math.min(OLLAMA_NUM_CTX - 512, 6000));
  }
  return 6000;
}

function buildSystemPrompt(originalSystemPrompt: string): string {
  if (!originalSystemPrompt) {
    return OLLAMA_AGENT_PREFIX;
  }

  const tail = originalSystemPrompt.length > 1200 ? originalSystemPrompt.slice(-1200) : originalSystemPrompt;
  return `${OLLAMA_AGENT_PREFIX}\n\nAdditional session instructions:\n${tail}`;
}

function buildOllamaRuntimeConfig(maxTokens?: number): Record<string, unknown> {
  const options: Record<string, unknown> = {};

  if (OLLAMA_NUM_CTX !== undefined) {
    options.num_ctx = OLLAMA_NUM_CTX;
  }

  const requestedPredict =
    typeof maxTokens === "number" && Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : undefined;
  const effectivePredict =
    requestedPredict !== undefined && OLLAMA_NUM_PREDICT !== undefined
      ? Math.min(requestedPredict, OLLAMA_NUM_PREDICT)
      : requestedPredict ?? OLLAMA_NUM_PREDICT;

  if (effectivePredict !== undefined) {
    options.num_predict = effectivePredict;
  }

  return {
    ...(Object.keys(options).length > 0 ? { options } : {}),
    ...(OLLAMA_KEEP_ALIVE ? { keep_alive: OLLAMA_KEEP_ALIVE } : {}),
  };
}

function anthropicMessagesToOllamaCompatible(
  messages: AnthropicMessageRequest["messages"],
  systemInstruction: string,
): Array<Record<string, unknown>> {
  const toolNameById = new Map<string, string>();
  const result: Array<Record<string, unknown>> = [];

  if (systemInstruction) {
    result.push({
      role: "system",
      content: systemInstruction,
    });
  }

  for (const message of messages ?? []) {
    const parts = normalizeAnthropicContent(message.content);
    const textParts: string[] = [];
    const toolMessages: Array<Record<string, unknown>> = [];
    const toolCalls: Array<Record<string, unknown>> = [];

    for (const part of parts) {
      const type = typeof part.type === "string" ? part.type : "";

      if (type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }

      if (type === "tool_use") {
        const id = typeof part.id === "string" ? part.id : `toolu_${randomUUID()}`;
        const name = typeof part.name === "string" ? part.name : "tool";
        const input = isRecord(part.input) ? part.input : {};
        toolNameById.set(id, name);
        toolCalls.push({
          id,
          type: "function",
          function: {
            name,
            arguments: input,
          },
        });
        continue;
      }

      if (type === "tool_result") {
        const toolUseId = typeof part.tool_use_id === "string" ? part.tool_use_id : `toolu_${randomUUID()}`;
        const toolName = toolNameById.get(toolUseId) ?? "tool";
        toolMessages.push({
          role: "tool",
          tool_call_id: toolUseId,
          tool_name: toolName,
          content: extractToolResultText(part.content),
        });
      }
    }

    if (message.role === "assistant") {
      if (textParts.length > 0 || toolCalls.length > 0) {
        result.push({
          role: "assistant",
          content: textParts.join("\n") || "",
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        });
      }
      continue;
    }

    if (textParts.length > 0) {
      result.push({
        role: "user",
        content: textParts.join("\n"),
      });
    }

    result.push(...toolMessages);
  }

  return result;
}

function anthropicToolsToOllamaTools(tools: Array<Record<string, unknown>>): OllamaTool[] {
  const prioritized = [...tools].sort((left, right) => {
    const leftName = typeof left.name === "string" ? left.name : "";
    const rightName = typeof right.name === "string" ? right.name : "";
    return Number(PRIORITY_TOOLS.has(rightName)) - Number(PRIORITY_TOOLS.has(leftName));
  });

  return prioritized
    .slice(0, 12)
    .map((tool) => {
      const name = typeof tool.name === "string" ? tool.name : null;
      if (!name) {
        return null;
      }

      return {
        type: "function",
        function: {
          name,
          description: typeof tool.description === "string" ? tool.description.slice(0, 120) : "",
          parameters: simplifyJsonSchema(isRecord(tool.input_schema) ? tool.input_schema : { type: "object", properties: {} }),
        },
      };
    })
    .filter((tool): tool is OllamaTool => tool !== null);
}

function simplifyJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(schema);
  return simplifyJsonSchemaNode(copy);
}

function simplifyJsonSchemaNode(node: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const type = typeof node.type === "string" ? node.type : "object";
  result.type = type;

  if (typeof node.description === "string") {
    result.description = node.description.slice(0, 120);
  }

  if (type === "object") {
    const properties = isRecord(node.properties) ? node.properties : {};
    const nextProperties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      nextProperties[key] = isRecord(value) ? simplifyJsonSchemaNode(value) : { type: "string" };
    }
    result.properties = nextProperties;
    result.required = Array.isArray(node.required) ? node.required : [];
    result.additionalProperties = node.additionalProperties ?? true;
  } else if (type === "array") {
    result.items = isRecord(node.items) ? simplifyJsonSchemaNode(node.items) : { type: "string" };
  } else if (Array.isArray(node.enum)) {
    result.enum = node.enum;
  }

  return result;
}

function compactOllamaPayload(
  systemInstruction: string,
  messages: Array<Record<string, unknown>>,
  tools: OllamaTool[],
  budget: number,
) {
  let compactMessages = trimLargeToolOutputs(messages);
  let compactTools = [...tools];

  while (estimateOllamaPayload(systemInstruction, compactMessages, compactTools) > budget && compactMessages.length > 2) {
    const withoutOldestTurn = dropOldestTurn(compactMessages);
    if (withoutOldestTurn.length === compactMessages.length) {
      break;
    }
    compactMessages = withoutOldestTurn;
  }

  while (estimateOllamaPayload(systemInstruction, compactMessages, compactTools) > budget && compactTools.length > 8) {
    compactTools = compactTools.slice(0, compactTools.length - 2);
  }

  if (estimateOllamaPayload(systemInstruction, compactMessages, compactTools) > budget) {
    compactMessages = compactMessages.map((message) => {
      const content = typeof message.content === "string" ? message.content : "";
      if (content.length <= 1600) {
        return message;
      }

      return {
        ...message,
        content: content.slice(0, 1200) + "\n...(truncated)...",
      };
    });
  }

  return {
    messages: compactMessages,
    tools: compactTools,
  };
}

function trimLargeToolOutputs(messages: Array<Record<string, unknown>>) {
  return messages.map((message) => {
    const role = typeof message.role === "string" ? message.role : "";
    const content = typeof message.content === "string" ? message.content : "";
    if (role !== "tool" || content.length <= 4000) {
      return message;
    }

    return {
      ...message,
      content: content.slice(0, 2000) + "\n...(truncated)...\n" + content.slice(-1200),
    };
  });
}

function dropOldestTurn(messages: Array<Record<string, unknown>>) {
  if (messages.length <= 2) {
    return messages;
  }

  const systemOffset = messages[0]?.role === "system" ? 1 : 0;
  const turns: Array<Array<Record<string, unknown>>> = [];
  let currentTurn: Array<Record<string, unknown>> = [];

  for (const message of messages.slice(systemOffset)) {
    const role = typeof message.role === "string" ? message.role : "";
    if (role === "user" && currentTurn.length > 0) {
      turns.push(currentTurn);
      currentTurn = [];
    }
    currentTurn.push(message);
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn);
  }

  if (turns.length <= 1) {
    return messages;
  }

  const keptTurns = turns.slice(1);
  return [...messages.slice(0, systemOffset), ...keptTurns.flat()];
}

function estimateOllamaPayload(systemInstruction: string, messages: Array<Record<string, unknown>>, tools: OllamaTool[]) {
  return Math.ceil(
    JSON.stringify({
      systemInstruction,
      messages,
      tools,
    }).length / 4,
  );
}

function ollamaMessageToAnthropicContent(message: Record<string, unknown> | null): AnthropicContentBlock[] {
  if (!message) {
    return [{ type: "text", text: "", citations: null }];
  }

  const blocks: AnthropicContentBlock[] = [];
  if (typeof message.content === "string" && message.content.length > 0) {
    blocks.push({
      type: "text",
      text: message.content,
      citations: null,
    });
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  for (const rawToolCall of rawToolCalls) {
    if (!isRecord(rawToolCall) || !isRecord(rawToolCall.function)) {
      continue;
    }

    const name = typeof rawToolCall.function.name === "string" ? rawToolCall.function.name : "tool";
    const input = isRecord(rawToolCall.function.arguments) ? rawToolCall.function.arguments : {};
    blocks.push({
      type: "tool_use",
      id: typeof rawToolCall.id === "string" ? rawToolCall.id : `toolu_${randomUUID()}`,
      name,
      input,
    });
  }

  return blocks.length > 0 ? blocks : [{ type: "text", text: "", citations: null }];
}

function buildModelsPage() {
  const ids = providerModelCatalog("ollama", process.env);
  return {
    data: ids.map((id) => buildModelInfo(id)),
    first_id: ids[0],
    has_more: false,
    last_id: ids.at(-1),
  };
}

function buildModelInfo(id: string) {
  return {
    type: "model",
    id,
    display_name: `${id} (Ollama via Claw Dev proxy)`,
    created_at: "2026-04-01T00:00:00Z",
  };
}

function assertLocalProxyAuth(req: IncomingMessage): void {
  if (!LOCAL_PROXY_AUTH_TOKEN) {
    return;
  }

  const bearerHeader = req.headers.authorization?.trim() ?? "";
  const apiKeyHeader = req.headers["x-api-key"];
  const bearerToken = bearerHeader.toLowerCase().startsWith("bearer ")
    ? bearerHeader.slice("bearer ".length).trim()
    : "";
  const apiKey =
    typeof apiKeyHeader === "string"
      ? apiKeyHeader.trim()
      : Array.isArray(apiKeyHeader)
        ? apiKeyHeader[0]?.trim() ?? ""
        : "";

  if (secureTokenMatch(bearerToken, LOCAL_PROXY_AUTH_TOKEN) || secureTokenMatch(apiKey, LOCAL_PROXY_AUTH_TOKEN)) {
    return;
  }

  throw new CompatProxyError(
    "Local Ollama proxy rejected the request because the session auth token was missing or invalid. Restart Claw Dev and try again.",
    401,
    "authentication_error",
  );
}

function secureTokenMatch(actual: string, expected: string): boolean {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parseOptionalInt(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readConfiguredSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = trimmed.toLowerCase();
  if (
    normalized === "changeme" ||
    normalized === "replace-me" ||
    normalized === "your_api_key_here" ||
    (normalized.startsWith("your_") && normalized.endsWith("_here")) ||
    normalized.includes("placeholder") ||
    normalized.includes("example")
  ) {
    return undefined;
  }

  return trimmed;
}

function normalizeSystemPrompt(system: AnthropicMessageRequest["system"]): string {
  if (typeof system === "string") {
    return system;
  }

  if (!Array.isArray(system)) {
    return "";
  }

  return system
    .map((block) => (typeof block.text === "string" ? block.text : ""))
    .filter((text) => text.length > 0)
    .join("\n\n");
}

function normalizeAnthropicContent(content: string | Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return Array.isArray(content) ? content : [];
}

function extractToolResultText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
      .filter((text) => text.length > 0)
      .join("\n");
  }

  if (isRecord(content)) {
    return JSON.stringify(content);
  }

  return "";
}

function estimateInputTokens(body: AnthropicMessageRequest): number {
  const raw = JSON.stringify(body.messages ?? []).length + normalizeSystemPrompt(body.system).length;
  return Math.max(1, Math.ceil(raw / 4));
}

function estimateOutputTokens(content: AnthropicContentBlock[]): number {
  const raw = content
    .map((block) => (block.type === "text" ? block.text : JSON.stringify(block.input)))
    .join("\n").length;
  return Math.max(1, Math.ceil(raw / 4));
}

function sendMessageStream(
  res: ServerResponse,
  payload: { requestId: string; message: AnthropicMessageResponse },
) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("request-id", payload.requestId);

  const startMessage: AnthropicMessageResponse = {
    ...payload.message,
    content: [],
    stop_reason: null as never,
    stop_sequence: null,
    usage: {
      ...payload.message.usage,
      output_tokens: 0,
    },
  };

  writeSse(res, "message_start", {
    type: "message_start",
    message: startMessage,
  });

  payload.message.content.forEach((block, index) => {
    if (block.type === "text") {
      writeSse(res, "content_block_start", {
        type: "content_block_start",
        index,
        content_block: {
          type: "text",
          text: "",
          citations: null,
        },
      });
      writeSse(res, "content_block_delta", {
        type: "content_block_delta",
        index,
        delta: {
          type: "text_delta",
          text: block.text,
        },
      });
      writeSse(res, "content_block_stop", {
        type: "content_block_stop",
        index,
      });
      return;
    }

    writeSse(res, "content_block_start", {
      type: "content_block_start",
      index,
      content_block: {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: {},
      },
    });
    writeSse(res, "content_block_delta", {
      type: "content_block_delta",
      index,
      delta: {
        type: "input_json_delta",
        partial_json: JSON.stringify(block.input),
      },
    });
    writeSse(res, "content_block_stop", {
      type: "content_block_stop",
      index,
    });
  });

  writeSse(res, "message_delta", {
    type: "message_delta",
    delta: {
      stop_reason: payload.message.stop_reason,
      stop_sequence: null,
    },
    usage: {
      input_tokens: payload.message.usage.input_tokens,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      output_tokens: payload.message.usage.output_tokens,
      server_tool_use: null,
    },
  });

  writeSse(res, "message_stop", {
    type: "message_stop",
  });
  res.end();
}

function writeSse(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const text = Buffer.concat(chunks).toString("utf8");
  return text.length > 0 ? JSON.parse(text) : null;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
