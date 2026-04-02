import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function defaultCodexAuthPath() {
  return join(homedir(), ".codex", "auth.json");
}

export function resolveOpenAIAuth(options = {}) {
  const env = options.env ?? process.env;
  const authJsonPath = options.authJsonPath ?? defaultCodexAuthPath();
  const readAuthJson = options.readAuthJson ?? (() => readFileSync(authJsonPath, "utf8"));

  const injectedToken = normalizeCredential(env.OPENAI_AUTH_TOKEN);
  if (injectedToken) {
    return {
      status: "ok",
      authType: "oauth",
      bearerToken: injectedToken,
      source: "env-openai-auth-token",
      authPath: authJsonPath,
    };
  }

  const apiKey = normalizeCredential(env.OPENAI_API_KEY);
  if (apiKey) {
    return {
      status: "ok",
      authType: "api-key",
      bearerToken: apiKey,
      source: "env-openai-api-key",
      authPath: authJsonPath,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(readAuthJson());
  } catch (error) {
    if (isMissingFileError(error)) {
      return {
        status: "missing",
        authType: "none",
        authPath: authJsonPath,
        reason: "auth-file-missing",
      };
    }

    return {
      status: "missing",
      authType: "none",
      authPath: authJsonPath,
      reason: "auth-file-unreadable",
    };
  }

  const accessToken = parsed?.tokens?.access_token?.trim();
  if (!accessToken) {
    return {
      status: "missing",
      authType: "none",
      authPath: authJsonPath,
      reason: "auth-token-missing",
    };
  }

  if (isJwtExpired(accessToken)) {
    return {
      status: "expired",
      authType: "oauth",
      authPath: authJsonPath,
      reason: "auth-token-expired",
    };
  }

  return {
    status: "ok",
    authType: "oauth",
    bearerToken: accessToken,
    source: "codex-auth-json",
    authPath: authJsonPath,
    accountId: parsed?.tokens?.account_id ?? null,
  };
}

export function formatOpenAIAuthHint(result) {
  if (result.status === "expired") {
    return `Found an expired Codex auth session at ${result.authPath}. Run \`codex login\` to refresh it, or provide OPENAI_API_KEY as a fallback.`;
  }

  return `No reusable Codex auth session was found at ${result.authPath}. Run \`codex login\` first, or provide OPENAI_API_KEY as a fallback.`;
}

function isMissingFileError(error) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function normalizeCredential(value) {
  const trimmed = value?.trim();
  if (!trimmed || looksLikePlaceholder(trimmed)) {
    return "";
  }

  return trimmed;
}

function looksLikePlaceholder(value) {
  const normalized = value.toLowerCase();
  return (
    normalized === "changeme" ||
    normalized === "your_api_key_here" ||
    normalized.startsWith("your_") ||
    normalized.startsWith("example_") ||
    normalized.includes("api_key_here") ||
    normalized.includes("token_here")
  );
}

function isJwtExpired(token) {
  const exp = getJwtExpiry(token);
  if (exp === null) {
    return false;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  return exp <= nowSeconds + 60;
}

function getJwtExpiry(token) {
  const parts = token.split(".");
  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}
