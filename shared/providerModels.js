const MODEL_ENV_KEY_BY_PROVIDER = {
  bedrock: "BEDROCK_MODEL",
  openai: "OPENAI_MODEL",
  gemini: "GEMINI_MODEL",
  groq: "GROQ_MODEL",
  openrouter: "OPENROUTER_MODEL",
  ollama: "OLLAMA_MODEL",
  copilot: "COPILOT_MODEL",
  zai: "ZAI_MODEL",
};

const PROVIDER_LABELS = {
  bedrock: "Amazon Bedrock",
  openai: "OpenAI",
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  ollama: "Ollama",
  copilot: "GitHub Copilot",
  zai: "z.ai",
};

const DEFAULT_MODEL_CATALOG = {
  bedrock: [
    "us.anthropic.claude-sonnet-4-20250514-v1:0",
    "us.anthropic.claude-3-7-sonnet-20250219-v1:0",
    "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    "anthropic.claude-3-5-haiku-20241022-v1:0",
  ],
  openai: ["gpt-5-mini", "gpt-5.2", "gpt-5-nano", "gpt-5.2-codex", "gpt-4.1", "o3-mini", "o4-mini"],
  gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemma-3-27b-it"],
  groq: ["openai/gpt-oss-20b", "openai/gpt-oss-120b", "qwen/qwen3-32b", "llama-3.3-70b-versatile"],
  openrouter: [
    "openrouter/free",
    "openai/gpt-oss-20b:free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "anthropic/claude-sonnet-4",
    "google/gemini-2.5-flash",
    "google/gemini-2.5-pro",
    "openai/gpt-oss-120b",
    "meta-llama/llama-3.3-70b-instruct",
  ],
  ollama: ["qwen3", "qwen2.5-coder:7b", "qwen2.5-coder:14b", "deepseek-r1:8b"],
  copilot: ["openai/gpt-4.1-mini", "openai/gpt-4.1", "openai/gpt-4o", "openai/o4-mini"],
  zai: ["glm-5", "glm-4.5", "glm-4.5-air"],
};

export function providerLabel(provider) {
  return PROVIDER_LABELS[provider] ?? provider;
}

export function providerModelCatalog(provider, env = process.env) {
  const modelEnvKey = MODEL_ENV_KEY_BY_PROVIDER[provider];
  const activeModel = modelEnvKey ? (env[modelEnvKey] ?? "").trim() : "";
  const customModels = parseProviderCustomCatalog(provider, env);
  return uniqueStrings([activeModel, ...customModels, ...(DEFAULT_MODEL_CATALOG[provider] ?? [])]);
}

export function providerPromptSuggestions(provider, env = process.env) {
  return providerModelCatalog(provider, env);
}

export function providerAdditionalModelOptions(provider, env = process.env) {
  const label = providerLabel(provider);
  return providerModelCatalog(provider, env).map((model) => ({
    value: model,
    label: model,
    description: `${label} model`,
  }));
}

function parseProviderCustomCatalog(provider, env) {
  const envKey = `${provider.toUpperCase()}_MODELS`;
  return String(env[envKey] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => String(value ?? "").trim().length > 0))];
}
