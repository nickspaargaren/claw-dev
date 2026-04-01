import test from "node:test";
import assert from "node:assert/strict";

import {
  providerAdditionalModelOptions,
  providerLabel,
  providerModelCatalog,
  providerPromptSuggestions,
} from "../shared/providerModels.js";

test("providerLabel returns human readable provider names", () => {
  assert.equal(providerLabel("bedrock"), "Amazon Bedrock");
  assert.equal(providerLabel("openai"), "OpenAI");
  assert.equal(providerLabel("gemini"), "Google Gemini");
  assert.equal(providerLabel("openrouter"), "OpenRouter");
});

test("providerModelCatalog includes active model and defaults", () => {
  const catalog = providerModelCatalog("openai", { OPENAI_MODEL: "gpt-5.2" });
  assert.equal(catalog[0], "gpt-5.2");
  assert.ok(catalog.includes("gpt-4.1"));
  assert.ok(catalog.includes("o4-mini"));
});

test("providerModelCatalog merges custom environment models", () => {
  const catalog = providerModelCatalog("gemini", {
    GEMINI_MODEL: "gemini-2.5-pro",
    GEMINI_MODELS: "gemini-2.5-pro-exp,gemini-2.5-flash-lite-preview",
  });
  assert.ok(catalog.includes("gemini-2.5-pro-exp"));
  assert.ok(catalog.includes("gemini-2.5-flash-lite-preview"));
});

test("providerPromptSuggestions mirrors the provider catalog", () => {
  const suggestions = providerPromptSuggestions("zai", { ZAI_MODEL: "glm-5" });
  assert.deepEqual(suggestions, providerModelCatalog("zai", { ZAI_MODEL: "glm-5" }));
});

test("providerAdditionalModelOptions are picker-friendly", () => {
  const options = providerAdditionalModelOptions("openai", { OPENAI_MODEL: "gpt-5.2" });
  assert.ok(options.some((option) => option.value === "gpt-5.2" && option.description === "OpenAI model"));
});

test("openrouter catalog includes provider-qualified model ids", () => {
  const catalog = providerModelCatalog("openrouter", { OPENROUTER_MODEL: "anthropic/claude-sonnet-4" });
  assert.equal(catalog[0], "anthropic/claude-sonnet-4");
  assert.ok(catalog.includes("google/gemini-2.5-flash"));
  assert.ok(catalog.includes("openai/gpt-oss-120b"));
});

test("bedrock catalog includes current Anthropic Bedrock ids", () => {
  const catalog = providerModelCatalog("bedrock", {
    BEDROCK_MODEL: "us.anthropic.claude-sonnet-4-20250514-v1:0",
  });
  assert.equal(catalog[0], "us.anthropic.claude-sonnet-4-20250514-v1:0");
  assert.ok(catalog.includes("us.anthropic.claude-3-7-sonnet-20250219-v1:0"));
});
