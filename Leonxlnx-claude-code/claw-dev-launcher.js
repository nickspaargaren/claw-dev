const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { spawn } = require("node:child_process");
const readline = require("node:readline/promises");
const { pathToFileURL } = require("node:url");

const repoRoot = __dirname;
const workspaceRoot = path.dirname(repoRoot);

// Load .env from the workspace root so all env vars are available to the launcher
require("dotenv").config({ path: path.join(workspaceRoot, ".env") });
const cliPath = path.join(repoRoot, "package", "cli.js");
const brandingPatchPath = path.join(repoRoot, "patch-branding.js");
const defaultPorts = {
  openai: "8787",
  gemini: "8788",
  groq: "8789",
  openrouter: "8793",
  copilot: "8790",
  zai: "8791",
  ollama: "8792",
};

const DEFAULT_BEDROCK_MODEL = process.env.CLAUDE_DEFAULT_BEDROCK_MODEL?.trim() || "";

const providerMenuOptions = [
  ["1", "anthropic", "Anthropic", "Best overall Claude-style compatibility", "ANTHROPIC_API_KEY"],
  ["2", "openai", "OpenAI", "Strong general cloud option with custom model ids", "OPENAI_API_KEY or reusable Codex login"],
  ["3", "gemini", "Gemini", "Good balance of cost, speed, and long-context cloud models", "GEMINI_API_KEY"],
  ["4", "groq", "Groq", "Very fast hosted inference with open model choices", "GROQ_API_KEY"],
  ["5", "openrouter", "OpenRouter", "Largest model catalog and easy model switching", "OPENROUTER_API_KEY"],
  ["6", "copilot", "Copilot", "GitHub Models path with a smaller request budget", "COPILOT_TOKEN or GitHub Models token"],
  ["7", "zai", "z.ai", "GLM family models through an OpenAI-style API", "ZAI_API_KEY"],
  ["8", "ollama", "Ollama", "Local models with zero cloud dependency", "Running Ollama server"],
  ["9", "bedrock", "Amazon Bedrock", "Native AWS-hosted Claude integration through the bundled client", "AWS credentials"],
];

let exiting = false;
let proxyProcess = null;
let ownsProxyProcess = false;
let restoreModelPickerCache = null;
let restoreAvailableModels = null;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  cleanupAndExit(1);
});

async function main() {
  applyBrandingPatch();

  const { providerArg, modelArg, forwardArgs } = parseLauncherArgs(process.argv.slice(2));
  const infoOnly = isInfoOnlyInvocation(forwardArgs);

  if (infoOnly) {
    return launchBundledClient({ ...process.env }, forwardArgs);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const provider = await resolveProvider(rl, providerArg, forwardArgs);
    const env = { ...process.env };

    if (provider === "anthropic") {
      if (!infoOnly) {
        await configureAnthropic(env, rl);
      }
      return launchBundledClient(env, forwardArgs);
    }

    if (provider === "bedrock") {
      ensureSeparateConfigDir(env);
      await configureNativeBedrock(env, rl, modelArg);
      return launchBundledClient(env, forwardArgs);
    }

    ensureSeparateConfigDir(env);
    await configureCompatProvider(provider, env, rl, modelArg);
    await ensureCompatProxy(provider, env);
    env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${env.ANTHROPIC_COMPAT_PORT}`;
    env.ANTHROPIC_AUTH_TOKEN = `claw-dev-proxy-${randomUUID()}`;
    delete env.ANTHROPIC_API_KEY;
    await primeBundledModelPicker(provider, env);
    await primeAvailableModels(provider, env);
    return launchBundledClient(env, forwardArgs);
  } finally {
    rl.close();
  }
}

function parseLauncherArgs(args) {
  const forwardArgs = [];
  let providerArg = null;
  let modelArg = null;

  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === "--provider") {
      providerArg = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (value === "--model") {
      modelArg = args[i + 1] ?? null;
      i += 1;
      continue;
    }
    forwardArgs.push(value);
  }

  return { providerArg, modelArg, forwardArgs };
}

function applyBrandingPatch() {
  if (!fs.existsSync(brandingPatchPath)) {
    return;
  }

  require(brandingPatchPath);
}

async function resolveProvider(rl, providerArg, forwardArgs) {
  const preset = normalizeProviderName((providerArg ?? process.env.CLAW_PROVIDER ?? "").trim().toLowerCase());
  if (["anthropic", "openai", "gemini", "groq", "openrouter", "copilot", "zai", "ollama", "bedrock"].includes(preset)) {
    return preset;
  }

  if (isInfoOnlyInvocation(forwardArgs)) {
    return "anthropic";
  }

  process.stdout.write("\nClaw Dev provider setup\n");
  process.stdout.write("Choose a backend for this session. You can still paste any model id on the next step.\n\n");
  for (const [id, , label, description, auth] of providerMenuOptions) {
    process.stdout.write(`${id}. ${label}\n`);
    process.stdout.write(`   ${description}\n`);
    process.stdout.write(`   Auth: ${auth}\n`);
  }
  process.stdout.write("\n");

  const answer = (await rl.question("Choose a provider [1]: ")).trim();
  const selected = providerMenuOptions.find(([id]) => id === (answer || "1"));
  if (!selected) {
    throw new Error(`Unknown provider option: ${answer}`);
  }
  return selected[1];
}

function normalizeProviderName(raw) {
  if (raw === "claude") {
    return "anthropic";
  }
  if (raw === "grok") {
    return "groq";
  }
  if (raw === "github" || raw === "github-models") {
    return "copilot";
  }
  if (raw === "router") {
    return "openrouter";
  }
  if (raw === "z.ai") {
    return "zai";
  }
  if (raw === "chatgpt") {
    return "openai";
  }
  if (raw === "aws" || raw === "amazon") {
    return "bedrock";
  }
  return raw;
}

function isInfoOnlyInvocation(forwardArgs) {
  return (
    forwardArgs.includes("--version") ||
    forwardArgs.includes("-v") ||
    forwardArgs.includes("--help") ||
    forwardArgs.includes("-h")
  );
}

function readConfiguredSecret(env, key) {
  const value = env[key]?.trim();
  if (!value) {
    return "";
  }

  const normalized = value.toLowerCase();
  if (
    normalized === "changeme" ||
    normalized === "replace-me" ||
    normalized === "your_api_key_here" ||
    (normalized.startsWith("your_") && normalized.endsWith("_here")) ||
    normalized.includes("example") ||
    normalized.includes("placeholder")
  ) {
    return "";
  }

  return value;
}

function providerDisplayName(provider) {
  const match = providerMenuOptions.find(([, id]) => id === provider);
  return match?.[2] ?? provider;
}

function printProviderStartSummary(provider, lines) {
  process.stdout.write(`\n${providerDisplayName(provider)} setup\n`);
  for (const line of lines) {
    process.stdout.write(`${line}\n`);
  }
}

function ensureProviderModelSlots(provider, env) {
  switch (provider) {
    case "openai":
      env.OPENAI_MODEL_HAIKU = env.OPENAI_MODEL_HAIKU?.trim() || "gpt-5-nano";
      env.OPENAI_MODEL_SONNET = env.OPENAI_MODEL_SONNET?.trim() || env.OPENAI_MODEL?.trim() || "gpt-5-mini";
      env.OPENAI_MODEL_OPUS = env.OPENAI_MODEL_OPUS?.trim() || "gpt-5.2-codex";
      break;
    case "gemini":
      env.GEMINI_MODEL_HAIKU = env.GEMINI_MODEL_HAIKU?.trim() || "gemini-2.5-flash";
      env.GEMINI_MODEL_SONNET = env.GEMINI_MODEL_SONNET?.trim() || env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
      env.GEMINI_MODEL_OPUS = env.GEMINI_MODEL_OPUS?.trim() || "gemini-2.5-pro";
      break;
    case "groq":
      env.GROQ_MODEL_HAIKU = env.GROQ_MODEL_HAIKU?.trim() || "openai/gpt-oss-20b";
      env.GROQ_MODEL_SONNET = env.GROQ_MODEL_SONNET?.trim() || env.GROQ_MODEL?.trim() || "qwen/qwen3-32b";
      env.GROQ_MODEL_OPUS = env.GROQ_MODEL_OPUS?.trim() || "openai/gpt-oss-120b";
      break;
    case "openrouter":
      env.OPENROUTER_MODEL_HAIKU = env.OPENROUTER_MODEL_HAIKU?.trim() || "google/gemini-2.5-flash";
      env.OPENROUTER_MODEL_SONNET =
        env.OPENROUTER_MODEL_SONNET?.trim() || env.OPENROUTER_MODEL?.trim() || "anthropic/claude-sonnet-4";
      env.OPENROUTER_MODEL_OPUS = env.OPENROUTER_MODEL_OPUS?.trim() || "google/gemini-2.5-pro";
      break;
    case "copilot":
      env.COPILOT_MODEL_HAIKU = env.COPILOT_MODEL_HAIKU?.trim() || "openai/gpt-4.1-mini";
      env.COPILOT_MODEL_SONNET =
        env.COPILOT_MODEL_SONNET?.trim() || env.COPILOT_MODEL?.trim() || "openai/gpt-4.1-mini";
      env.COPILOT_MODEL_OPUS = env.COPILOT_MODEL_OPUS?.trim() || "openai/gpt-4.1";
      break;
    case "zai":
      env.ZAI_MODEL_HAIKU = env.ZAI_MODEL_HAIKU?.trim() || "glm-4.5-air";
      env.ZAI_MODEL_SONNET = env.ZAI_MODEL_SONNET?.trim() || env.ZAI_MODEL?.trim() || "glm-5";
      env.ZAI_MODEL_OPUS = env.ZAI_MODEL_OPUS?.trim() || "glm-4.5";
      break;
    case "ollama":
      env.OLLAMA_MODEL_HAIKU = env.OLLAMA_MODEL_HAIKU?.trim() || "qwen2.5-coder:7b";
      env.OLLAMA_MODEL_SONNET = env.OLLAMA_MODEL_SONNET?.trim() || env.OLLAMA_MODEL?.trim() || "qwen3";
      env.OLLAMA_MODEL_OPUS = env.OLLAMA_MODEL_OPUS?.trim() || "qwen2.5-coder:14b";
      break;
    default:
      break;
  }
}

function buildProviderModelOverrides(provider, env) {
  const read = (suffix, fallback = "") => env[`${provider.toUpperCase()}_MODEL_${suffix}`]?.trim() || fallback;
  const haiku = read("HAIKU");
  const sonnet = read("SONNET");
  const opus = read("OPUS");

  return {
    "claude-haiku-4-5": haiku,
    "claude-sonnet-4-6": sonnet,
    "claude-sonnet-4-5": sonnet,
    "claude-sonnet-4-0": sonnet,
    "claude-opus-4-6": opus,
    "claude-opus-4-1": opus,
    "claude-opus-4-0": opus,
  };
}

async function configureAnthropic(env, rl) {
  printProviderStartSummary("anthropic", [
    "Launching direct Anthropic mode.",
    "This path talks to Anthropic without the local compatibility proxy.",
  ]);

  // Separate config dir so Claw Dev never touches real Claude Code data
  ensureSeparateConfigDir(env);

  const configuredKey = readConfiguredSecret(env, "ANTHROPIC_API_KEY");
  if (configuredKey) {
    env.ANTHROPIC_API_KEY = configuredKey;
    process.stdout.write("Using ANTHROPIC_API_KEY from the current environment.\n");
    process.stdout.write("You can still switch models later inside the app.\n");
    return;
  }

  // Check if OAuth credentials exist (from `claude login` or Claude Max subscription)
  const oauthCreds = readOAuthCredentials(env);
  if (oauthCreds) {
    process.stdout.write("\nAnthropic auth method\n");
    process.stdout.write("1. OAuth login (Claude Pro/Max — uses existing claude.ai login)\n");
    process.stdout.write("2. API key (ANTHROPIC_API_KEY)\n");
    const choice = (await rl.question("Choose auth method [1]: ")).trim() || "1";

    if (choice === "1") {
      // OAuth mode: don't set ANTHROPIC_API_KEY, let the bundled client use its own OAuth flow
      process.stdout.write(`Using OAuth login (${oauthCreds.subscriptionType || "claude.ai"}).\n`);
      process.stdout.write("Sessions and credentials are isolated from stock Claude Code.\n");
      return;
    }
  }

  const key = (await rl.question("Enter ANTHROPIC_API_KEY (input is visible): ")).trim();
  if (!key) {
    throw new Error("Anthropic mode in Claw Dev requires ANTHROPIC_API_KEY or OAuth login.");
  }
  env.ANTHROPIC_API_KEY = key;
  process.stdout.write("Using the provided ANTHROPIC_API_KEY for this session.\n");
}

function ensureSeparateConfigDir(env) {
  if (env.CLAUDE_CONFIG_DIR) return;

  const clawConfigDir = path.join(os.homedir(), ".claw-dev");
  fs.mkdirSync(clawConfigDir, { recursive: true });

  // Always sync OAuth credentials from real Claude Code so tokens stay fresh
  const realCredsPath = path.join(os.homedir(), ".claude", ".credentials.json");
  const clawCredsPath = path.join(clawConfigDir, ".credentials.json");
  if (fs.existsSync(realCredsPath)) {
    try {
      fs.copyFileSync(realCredsPath, clawCredsPath);
    } catch {}
  }

  // Copy settings if they don't exist
  const realSettingsPath = path.join(os.homedir(), ".claude", "settings.json");
  const clawSettingsPath = path.join(clawConfigDir, "settings.json");
  if (fs.existsSync(realSettingsPath) && !fs.existsSync(clawSettingsPath)) {
    try {
      fs.copyFileSync(realSettingsPath, clawSettingsPath);
    } catch {}
  }

  env.CLAUDE_CONFIG_DIR = clawConfigDir;
}

function readOAuthCredentials(env) {
  const configDir = env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claw-dev");
  const credsPath = path.join(configDir, ".credentials.json");
  try {
    const data = JSON.parse(fs.readFileSync(credsPath, "utf8"));
    const oauth = data.claudeAiOauth;
    if (oauth && oauth.accessToken && oauth.expiresAt > Date.now()) {
      return oauth;
    }
  } catch {}
  // Fallback: check real Claude Code credentials
  try {
    const realPath = path.join(os.homedir(), ".claude", ".credentials.json");
    const data = JSON.parse(fs.readFileSync(realPath, "utf8"));
    const oauth = data.claudeAiOauth;
    if (oauth && oauth.accessToken && oauth.expiresAt > Date.now()) {
      return oauth;
    }
  } catch {}
  return null;
}

async function configureCompatProvider(provider, env, rl, modelArg) {
  env.ANTHROPIC_COMPAT_PROVIDER = provider;
  const configuredPort = env.ANTHROPIC_COMPAT_PORT?.trim();
  env.CLAW_COMPAT_PORT_EXPLICIT = configuredPort && configuredPort !== defaultPorts[provider] ? "1" : "0";
  env.ANTHROPIC_COMPAT_PORT = configuredPort || defaultPorts[provider];

  switch (provider) {
    case "openai": {
      printProviderStartSummary(provider, [
        "Launching OpenAI through the local Anthropic-compatible proxy.",
        "You can keep the default model or paste any current OpenAI model id.",
        "Recommended starting points: gpt-5-mini, gpt-5.2, or gpt-5.2-codex for heavier coding work.",
      ]);
      const auth = await resolveOpenAIAuthForLauncher(env);
      if (auth.status === "ok" && auth.authType === "oauth") {
        env.OPENAI_AUTH_TOKEN = auth.bearerToken;
        delete env.OPENAI_API_KEY;
        process.stdout.write(`Reusing OpenAI ChatGPT login from ${auth.authPath}.\n`);
      } else if (auth.status !== "ok") {
        process.stdout.write(`${auth.hint}\n`);
      } else {
        env.OPENAI_API_KEY = readConfiguredSecret(env, "OPENAI_API_KEY");
        process.stdout.write("Using OPENAI_API_KEY from the current environment.\n");
      }

      if (auth.status !== "ok") {
        const key = (await rl.question("Enter OPENAI_API_KEY (input is visible, fallback mode): ")).trim();
        if (!key) {
          throw new Error("OpenAI mode requires either a reusable Codex login or OPENAI_API_KEY.");
        }
        env.OPENAI_API_KEY = key;
      }
      env.OPENAI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "OPENAI_MODEL",
        defaultModel: "gpt-5-mini",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching OpenAI mode with model ${env.OPENAI_MODEL}.\n`);
      break;
    }
    case "gemini": {
      printProviderStartSummary(provider, [
        "Launching Gemini through the local Anthropic-compatible proxy.",
        "Gemini usually balances speed, cost, and long context better than Copilot mode.",
      ]);
      env.GEMINI_API_KEY = readConfiguredSecret(env, "GEMINI_API_KEY");
      if (!env.GEMINI_API_KEY) {
        const key = (await rl.question("Enter GEMINI_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("GEMINI_API_KEY is required for Gemini mode.");
        }
        env.GEMINI_API_KEY = key;
      }
      env.GEMINI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "GEMINI_MODEL",
        defaultModel: "gemini-2.5-flash",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching Gemini mode with model ${env.GEMINI_MODEL}.\n`);
      break;
    }
    case "groq": {
      printProviderStartSummary(provider, [
        "Launching Groq through the local Anthropic-compatible proxy.",
        "Groq is best when you want low latency and flexible open-model choices.",
      ]);
      env.GROQ_API_KEY = readConfiguredSecret(env, "GROQ_API_KEY");
      if (!env.GROQ_API_KEY) {
        const key = (await rl.question("Enter GROQ_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("GROQ_API_KEY is required for Groq mode.");
        }
        env.GROQ_API_KEY = key;
      }
      env.GROQ_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "GROQ_MODEL",
        defaultModel: "openai/gpt-oss-20b",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching Groq mode with model ${env.GROQ_MODEL}.\n`);
      break;
    }
    case "openrouter": {
      printProviderStartSummary(provider, [
        "Launching OpenRouter through the local Anthropic-compatible proxy.",
        "This is the most flexible option if you want to paste almost any hosted model slug.",
        "Examples: anthropic/claude-sonnet-4, google/gemini-2.5-pro, openrouter/free",
      ]);
      env.OPENROUTER_API_KEY = readConfiguredSecret(env, "OPENROUTER_API_KEY");
      if (!env.OPENROUTER_API_KEY) {
        const key = (await rl.question("Enter OPENROUTER_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("OPENROUTER_API_KEY is required for OpenRouter mode.");
        }
        env.OPENROUTER_API_KEY = key;
      }
      env.OPENROUTER_BASE_URL = env.OPENROUTER_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
      env.OPENROUTER_SITE_URL = env.OPENROUTER_SITE_URL?.trim() || "https://github.com/Leonxlnx/claw-dev";
      env.OPENROUTER_APP_NAME = env.OPENROUTER_APP_NAME?.trim() || "Claw Dev";
      env.OPENROUTER_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "OPENROUTER_MODEL",
        defaultModel: "anthropic/claude-sonnet-4",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching OpenRouter mode with model ${env.OPENROUTER_MODEL}.\n`);
      process.stdout.write(`OpenRouter base URL: ${env.OPENROUTER_BASE_URL}\n`);
      break;
    }
    case "ollama": {
      printProviderStartSummary(provider, [
        "Launching Ollama through the local Anthropic-compatible proxy.",
        "This path is local-only and usually needs smaller models for a fast agent loop.",
      ]);
      env.OLLAMA_BASE_URL = env.OLLAMA_BASE_URL?.trim() || "http://127.0.0.1:11434";
      env.OLLAMA_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "OLLAMA_MODEL",
        defaultModel: "qwen3",
      });
      env.OLLAMA_KEEP_ALIVE = env.OLLAMA_KEEP_ALIVE?.trim() || "30m";
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching Ollama mode against ${env.OLLAMA_BASE_URL} with model ${env.OLLAMA_MODEL}.\n`);
      process.stdout.write(`Ollama keep-alive is set to ${env.OLLAMA_KEEP_ALIVE} for faster follow-up turns.\n`);
      process.stdout.write("Make sure Ollama is running and the model is already pulled.\n");
      break;
    }
    case "copilot": {
      printProviderStartSummary(provider, [
        "Launching GitHub Models through the local Anthropic-compatible proxy.",
        "This path works best with smaller requests and can feel stricter than Gemini or Anthropic.",
      ]);
      env.COPILOT_TOKEN = readConfiguredSecret(env, "COPILOT_TOKEN") || readConfiguredSecret(env, "GITHUB_MODELS_TOKEN");
      if (!env.COPILOT_TOKEN) {
        const key = (await rl.question("Enter COPILOT_TOKEN or GitHub Models PAT (input is visible): ")).trim();
        if (!key) {
          throw new Error("COPILOT_TOKEN is required for Copilot mode.");
        }
        env.COPILOT_TOKEN = key;
      }
      env.COPILOT_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "COPILOT_MODEL",
        defaultModel: "openai/gpt-4.1-mini",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching Copilot mode with model ${env.COPILOT_MODEL}.\n`);
      break;
    }
    case "zai": {
      printProviderStartSummary(provider, [
        "Launching z.ai through the local Anthropic-compatible proxy.",
        "You can paste any z.ai model id if you want to override the default.",
      ]);
      env.ZAI_API_KEY = readConfiguredSecret(env, "ZAI_API_KEY");
      if (!env.ZAI_API_KEY) {
        const key = (await rl.question("Enter ZAI_API_KEY (input is visible): ")).trim();
        if (!key) {
          throw new Error("ZAI_API_KEY is required for z.ai mode.");
        }
        env.ZAI_API_KEY = key;
      }
      env.ZAI_MODEL = await resolveModelSelection({
        rl,
        env,
        provider,
        modelArg,
        envKey: "ZAI_MODEL",
        defaultModel: "glm-5",
      });
      ensureProviderModelSlots(provider, env);
      await applyCompatModelEnvForLauncher(provider, env);
      process.stdout.write(`\nLaunching z.ai mode with model ${env.ZAI_MODEL}.\n`);
      break;
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`);
  }
}

async function configureNativeBedrock(env, rl, modelArg) {
  printProviderStartSummary("bedrock", [
    "Launching native Amazon Bedrock mode through the bundled client.",
    "This path uses AWS credentials directly instead of the local compatibility proxy.",
  ]);

  env.CLAUDE_CODE_USE_BEDROCK = "1";
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.ANTHROPIC_API_KEY;

  const selectedModel = await resolveModelSelection({
    rl,
    env,
    provider: "bedrock",
    modelArg,
    envKey: "BEDROCK_MODEL",
    defaultModel: env.BEDROCK_MODEL?.trim() || DEFAULT_BEDROCK_MODEL || "us.anthropic.claude-sonnet-4-20250514-v1:0",
    suggestions: [
      "us.anthropic.claude-sonnet-4-20250514-v1:0",
      "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
      "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      "anthropic.claude-3-5-haiku-20241022-v1:0",
    ],
  });

  env.BEDROCK_MODEL = selectedModel;
  env.ANTHROPIC_MODEL = selectedModel;

  const configuredRegion = env.AWS_REGION?.trim() || env.AWS_DEFAULT_REGION?.trim() || env.BEDROCK_REGION?.trim();
  if (configuredRegion) {
    env.AWS_REGION = configuredRegion;
    env.AWS_DEFAULT_REGION = configuredRegion;
  } else {
    env.AWS_REGION = "us-east-1";
    env.AWS_DEFAULT_REGION = "us-east-1";
  }

  process.stdout.write(`\nUsing native Bedrock mode with region ${env.AWS_REGION}.\n`);
  process.stdout.write(`Launching Bedrock mode with model ${env.BEDROCK_MODEL}.\n`);
  process.stdout.write("Make sure your AWS credentials and model access are configured before starting the session.\n");
}

async function resolveOpenAIAuthForLauncher(env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "openaiAuth.js")).href;
  const { formatOpenAIAuthHint, resolveOpenAIAuth } = await import(helperUrl);
  const result = resolveOpenAIAuth({ env });
  return {
    ...result,
    hint: formatOpenAIAuthHint(result),
  };
}

async function applyCompatModelEnvForLauncher(provider, env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "compatEnv.js")).href;
  const { applyCompatModelEnv } = await import(helperUrl);
  applyCompatModelEnv(provider, env);
}

async function resolveModelSelection({ rl, env, provider, modelArg, envKey, defaultModel, suggestions }) {
  const existing = env[envKey]?.trim() || defaultModel;
  const override = modelArg?.trim();
  if (override) {
    env[envKey] = override;
    return override;
  }

  const suggestedModels = suggestions?.length ? suggestions : await getProviderPromptSuggestions(provider, env);
  process.stdout.write(`\n${providerDisplayName(provider)} model selection\n`);
  process.stdout.write(`Default: ${existing}\n`);
  if (suggestedModels.length > 0) {
    process.stdout.write(`Suggested models: ${suggestedModels.join(", ")}\n`);
  }
  process.stdout.write("You can paste any provider-specific model id here.\n");
  const answer = (await rl.question(`Model for ${provider} [${existing}]: `)).trim();

  // Warn if the input looks like a menu number instead of a model name.
  // Only applies to single/double digit numbers — real model IDs like
  // "qwen2.5-coder:7b" contain non-digit characters and won't match.
  if (answer && /^\d{1,2}$/.test(answer) && suggestedModels.length > 0) {
    const fallbackModel = /^\d{1,2}$/.test(existing) ? defaultModel : existing;
    process.stdout.write(
      `\n⚠  "${answer}" looks like a menu number, not a model name.\n` +
      `   Did you mean one of: ${suggestedModels.join(", ")}?\n` +
      `   Using default model: ${fallbackModel}\n\n`
    );
    env[envKey] = fallbackModel;
    return env[envKey];
  }

  env[envKey] = answer || existing;
  return env[envKey];
}

async function primeBundledModelPicker(provider, env) {
  const configPath = process.env.CLAW_GLOBAL_CONFIG_PATH?.trim() || path.join(os.homedir(), ".claude.json");

  let currentConfig = {};
  try {
    if (fs.existsSync(configPath)) {
      currentConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    }
  } catch (error) {
    console.warn(`Could not read ${configPath}; skipping model picker cache priming.`);
    return;
  }

  const nextOptions = await getProviderModelOptions(provider, env);
  const previousOptions = Array.isArray(currentConfig.additionalModelOptionsCache)
    ? currentConfig.additionalModelOptionsCache
    : undefined;

  if (JSON.stringify(previousOptions ?? []) === JSON.stringify(nextOptions)) {
    restoreModelPickerCache = null;
    return;
  }

  const nextConfig = {
    ...currentConfig,
    additionalModelOptionsCache: nextOptions,
  };
  try {
    fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`Could not write model picker cache in ${configPath}; skipping priming.`);
    restoreModelPickerCache = null;
    return;
  }

  restoreModelPickerCache = () => {
    try {
      const latest = fs.existsSync(configPath)
        ? JSON.parse(fs.readFileSync(configPath, "utf8"))
        : {};
      const restored = { ...latest };
      if (previousOptions === undefined) {
        delete restored.additionalModelOptionsCache;
      } else {
        restored.additionalModelOptionsCache = previousOptions;
      }
      fs.writeFileSync(configPath, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
    } catch (error) {
      console.warn(`Could not restore model picker cache in ${configPath}.`);
    }
  };
}

async function primeAvailableModels(provider, env) {
  const settingsPath =
    process.env.CLAW_USER_SETTINGS_PATH?.trim() || path.join(os.homedir(), ".claude", "settings.json");

  let currentSettings = {};
  try {
    if (fs.existsSync(settingsPath)) {
      currentSettings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
  } catch (error) {
    console.warn(`Could not read ${settingsPath}; skipping availableModels priming.`);
    return;
  }

  const nextModels = await getProviderAllowlist(provider, env);
  const nextModelOverrides = buildProviderModelOverrides(provider, env);
  const previousModels = Array.isArray(currentSettings.availableModels)
    ? currentSettings.availableModels
    : undefined;
  const previousModelOverrides =
    currentSettings.modelOverrides && typeof currentSettings.modelOverrides === "object"
      ? currentSettings.modelOverrides
      : undefined;

  if (
    JSON.stringify(previousModels ?? []) === JSON.stringify(nextModels) &&
    JSON.stringify(previousModelOverrides ?? {}) === JSON.stringify(nextModelOverrides)
  ) {
    restoreAvailableModels = null;
    return;
  }

  const nextSettings = {
    ...currentSettings,
    availableModels: nextModels,
    modelOverrides: nextModelOverrides,
  };

  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");
  } catch (error) {
    console.warn(`Could not write availableModels in ${settingsPath}; skipping priming.`);
    restoreAvailableModels = null;
    return;
  }

  restoreAvailableModels = () => {
    try {
      const latest = fs.existsSync(settingsPath)
        ? JSON.parse(fs.readFileSync(settingsPath, "utf8"))
        : {};
      const restored = { ...latest };
      if (previousModels === undefined) {
        delete restored.availableModels;
      } else {
        restored.availableModels = previousModels;
      }
      if (previousModelOverrides === undefined) {
        delete restored.modelOverrides;
      } else {
        restored.modelOverrides = previousModelOverrides;
      }
      fs.writeFileSync(settingsPath, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
    } catch (error) {
      console.warn(`Could not restore availableModels in ${settingsPath}.`);
    }
  };
}

async function getProviderModelOptions(provider, env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "providerModels.js")).href;
  const helper = await import(helperUrl);
  return helper.providerAdditionalModelOptions(provider, env);
}

async function getProviderAllowlist(provider, env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "providerModels.js")).href;
  const helper = await import(helperUrl);
  return helper.providerModelCatalog(provider, env);
}

async function getProviderPromptSuggestions(provider, env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "providerModels.js")).href;
  const helper = await import(helperUrl);
  return helper.providerPromptSuggestions(provider, env);
}

async function ensureCompatProxy(provider, env) {
  const proxyPort = await resolveCompatPort(provider, env);
  env.ANTHROPIC_COMPAT_PORT = proxyPort;
  const proxyUrl = `http://127.0.0.1:${proxyPort}`;

  if (await isHealthyProxy(proxyUrl, provider, modelForProvider(provider, env))) {
    return;
  }

  const proxyScript = provider === "ollama" ? "proxy:ollama" : "proxy:compat";

  proxyProcess =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", `npm run ${proxyScript}`], {
          cwd: workspaceRoot,
          stdio: "ignore",
          windowsHide: true,
          env,
        })
      : spawn("npm", ["run", proxyScript], {
          cwd: workspaceRoot,
          stdio: "ignore",
          env,
        });

  ownsProxyProcess = true;

  proxyProcess.on("exit", (code) => {
    if (!exiting && code && code !== 0) {
      console.error(`Compatibility proxy exited early with code ${code}.`);
      cleanupAndExit(code);
    }
  });

  await waitForProxy(proxyUrl, provider, modelForProvider(provider, env));
}

async function resolveCompatPort(provider, env) {
  const helperUrl = pathToFileURL(path.join(workspaceRoot, "shared", "compatProxyPort.js")).href;
  const { resolveCompatPortAssignment } = await import(helperUrl);
  return resolveCompatPortAssignment({
    preferredPort: String(env.ANTHROPIC_COMPAT_PORT || defaultPorts[provider]),
    explicitPort: env.CLAW_COMPAT_PORT_EXPLICIT === "1",
    provider,
    model: modelForProvider(provider, env),
    isHealthyProxy: (proxyUrl, candidateProvider, candidateModel) =>
      isHealthyProxy(proxyUrl, candidateProvider, candidateModel),
    canListenOnPort,
  });
}

function modelForProvider(provider, env) {
  switch (provider) {
    case "openai":
      return env.OPENAI_MODEL;
    case "gemini":
      return env.GEMINI_MODEL;
    case "groq":
      return env.GROQ_MODEL;
    case "openrouter":
      return env.OPENROUTER_MODEL;
    case "ollama":
      return env.OLLAMA_MODEL;
    case "copilot":
      return env.COPILOT_MODEL;
    case "zai":
      return env.ZAI_MODEL;
    case "bedrock":
      return env.BEDROCK_MODEL;
    default:
      return "";
  }
}

function waitForProxy(proxyUrl, provider, model) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50;

    const tryOnce = async () => {
      attempts += 1;
      if (await isHealthyProxy(proxyUrl, provider, model)) {
        resolve();
        return;
      }

      if (attempts >= maxAttempts) {
        reject(new Error(`Compatibility proxy did not start on ${proxyUrl} for ${provider}:${model}.`));
        return;
      }

      setTimeout(tryOnce, 250);
    };

    void tryOnce();
  });
}

function isHealthyProxy(proxyUrl, provider, model) {
  return new Promise((resolve) => {
    const req = http.get(`${proxyUrl}/health`, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
      });
      res.on("end", () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          resolve(false);
          return;
        }

        resolve(body.includes(`"provider":"${provider}"`) && body.includes(`"model":"${model}"`));
      });
    });

    req.on("error", () => resolve(false));
    req.setTimeout(1200, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function canListenOnPort(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();

    tester.once("error", () => {
      resolve(false);
    });

    tester.once("listening", () => {
      tester.close(() => resolve(true));
    });

    tester.listen(Number(port), "127.0.0.1");
  });
}

function launchBundledClient(env, forwardArgs) {
  process.on("SIGINT", () => cleanupAndExit(130));
  process.on("SIGTERM", () => cleanupAndExit(143));
  process.on("exit", () => {
    if (ownsProxyProcess && proxyProcess && !proxyProcess.killed) {
      proxyProcess.kill();
    }
  });

  const child = spawn(process.execPath, [cliPath, ...forwardArgs], {
    cwd: repoRoot,
    stdio: "inherit",
    env,
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      cleanupAndExit(1);
      return;
    }
    cleanupAndExit(code ?? 0);
  });
}

function cleanupAndExit(code) {
  if (exiting) {
    return;
  }
  exiting = true;
  if (restoreModelPickerCache) {
    restoreModelPickerCache();
    restoreModelPickerCache = null;
  }
  if (restoreAvailableModels) {
    restoreAvailableModels();
    restoreAvailableModels = null;
  }
  if (ownsProxyProcess && proxyProcess && !proxyProcess.killed) {
    proxyProcess.kill();
  }
  process.exit(code);
}
