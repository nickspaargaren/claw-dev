# Claw Dev

**Security Assessment (April 2, 2026):** This repository fork has been security audited by Claude Sonnet 4.5 and [Nick Spaargaren](https://github.com/nickspaargaren) and verified safe to use. The bundled code is the official Anthropic Claude Code v2.1.87 package, with a custom multi-provider launcher wrapper.

- ✅ Bundled tarball verified as official `@anthropic-ai/claude-code` package from Anthropic
- ✅ No malicious code detected in source files, dependencies, or bundled binaries
- ✅ Local proxy binds to `127.0.0.1` only (localhost)
- ⚠️ Standard AI coding tool considerations apply: code/prompts are sent to AI provider APIs for processing

Claw Dev is a local multi-provider coding assistant launcher for the bundled terminal client in this repository. It gives you one entry point and lets you choose how model requests are resolved at startup:

- Anthropic direct mode with `ANTHROPIC_API_KEY`
- OpenAI through a local Anthropic-compatible proxy
- Google Gemini through a local Anthropic-compatible proxy
- Groq through a local Anthropic-compatible proxy
- OpenRouter through a local Anthropic-compatible proxy
- Copilot through the GitHub Models API
- z.ai through a local Anthropic-compatible proxy
- Ollama through a local Anthropic-compatible proxy

Claw Dev is designed to feel like one tool rather than a provider-specific wrapper. The launcher, provider prompts, environment variables, and documentation are all centered around the `Claw Dev` name.

## Repository Layout

- `Leonxlnx-claude-code/`
  - bundled terminal client and platform launchers
- `src/anthropicCompatProxy.ts`
  - local Anthropic-compatible proxy used for OpenAI, Gemini, Groq, OpenRouter, Ollama, Copilot, and z.ai
- `.env.example`
  - optional environment template for local setup
- `package.json`
  - root scripts for launching, building, and validating the workspace

## Supported Providers

### Anthropic

Use direct Anthropic API mode with `ANTHROPIC_API_KEY`.

Claw Dev intentionally avoids mixing the bundled claude.ai login state with direct Anthropic API mode because that combination can produce confusing auth conflicts and misleading startup prompts.

### OpenAI

Route requests through the local compatibility proxy. By default Claw Dev uses `OPENAI_API_KEY`. As an experimental fallback, it can also reuse an existing ChatGPT/Codex login from `~/.codex/auth.json` when available.

For new OpenAI-backed sessions, Claw Dev now prefers current GPT-5 models instead of older GPT-4-era defaults.

### Gemini

Use a Google Gemini API key and route requests through the local compatibility proxy.

### Groq

Use a Groq API key and route requests through the local compatibility proxy.

### OpenRouter

Use an OpenRouter API key and route requests through the local compatibility proxy.

This is the most flexible cloud option if you want to choose from a large hosted catalog and paste raw provider-qualified model ids such as `anthropic/claude-sonnet-4` or `google/gemini-2.5-pro`.

### Ollama

Use a local or remote Ollama server and route requests through the local compatibility proxy.

This is the best option if you want local inference and do not want to depend on a cloud API provider.

### Copilot

Use a GitHub Models-compatible bearer token and route requests through the local compatibility proxy.

### z.ai

Use a z.ai API key and route requests through the local compatibility proxy.

## Requirements

Install the following before you begin:

- Node.js 22 or newer
- npm
- Windows users should install Git for Windows for the best terminal workflow

Provider-specific requirements:

- Anthropic
  - `ANTHROPIC_API_KEY`
- OpenAI
  - `OPENAI_API_KEY`
  - or `codex login` if you want to reuse your ChatGPT/Codex OAuth session from `~/.codex/auth.json` as an experimental fallback
- Gemini
  - `GEMINI_API_KEY`
- Groq
  - `GROQ_API_KEY`
- OpenRouter
  - `OPENROUTER_API_KEY`
- Ollama
  - a running Ollama installation
  - at least one pulled model, such as `qwen3`
- Copilot
  - `COPILOT_TOKEN` or another GitHub Models-compatible bearer token
- z.ai
  - `ZAI_API_KEY`

## System Requirements

### Minimum project requirements

These requirements apply to Claw Dev itself:

- Node.js 22+
- enough free disk space for Node dependencies and any local model assets you choose to install
- one of the following shells:
  - Windows PowerShell or Command Prompt
  - macOS Terminal, iTerm2, `bash`, or `zsh`
  - Linux terminal with `bash` or `zsh`

### Ollama platform notes

According to the official Ollama documentation:

- Ollama is available for Windows, macOS, and Linux
- the local Ollama API is served by default at `http://localhost:11434/api`
- no authentication is required for local API access on `http://localhost:11434`
- on Windows, Ollama reads standard user and system environment variables

### Ollama hardware guidance

Official Ollama documentation explains that loaded models may run fully on GPU, fully in system memory, or split across CPU and GPU, and that actual memory use depends on the model you choose. The exact hardware requirement therefore depends primarily on model size.

Practical guidance for Claw Dev users:

- For small local coding models, 16 GB system RAM is a reasonable starting point
- For smoother local work, 32 GB RAM is strongly preferred
- A dedicated GPU helps significantly, especially for larger models and faster response times
- If you do not have a capable GPU, Ollama can still run on CPU, but generation will be slower
- Larger models require substantially more RAM or VRAM and may be impractical on entry-level hardware

Conservative model guidance:

- `qwen3` or similar 8B-class models are the easiest place to start on consumer hardware
- mid-size models usually benefit from 16 GB to 24 GB of available VRAM, or enough combined GPU and system memory for mixed CPU/GPU loading
- very large models are generally not a practical default for local coding workflows unless you already have a high-memory workstation

This guidance is an implementation recommendation based on Ollama's documented runtime behavior and common model sizes. It is not an official Ollama sizing table.

## Installation

From the repository root on Windows:

```powershell
cd E:\myclaudecode
pnpm install
copy .env.example .env
```

From the repository root on macOS or Linux:

```bash
cd /path/to/myclaudecode
pnpm install
cp .env.example .env
```

Editing `.env` is optional. Claw Dev can prompt for missing values interactively when it starts.

## Quick Start

Start Claw Dev from the repository root on any platform:

```bash
pnpm run claw-dev
```

`pnpm start` is an alias for the same launcher:

```bash
pnpm start
```

Or launch it directly from the bundled client directory on Windows:

```powershell
cd E:\myclaudecode\Leonxlnx-claude-code
.\claw-dev.cmd
```

Or launch it directly from the bundled client directory on macOS or Linux:

```bash
cd /path/to/myclaudecode/Leonxlnx-claude-code
chmod +x ./claw-dev.sh
./claw-dev.sh
```

When Claw Dev starts, it shows a provider selector:

1. Anthropic
2. OpenAI
3. Gemini
4. Groq
5. OpenRouter
6. Copilot
7. z.ai
8. Ollama

If a required API key is missing, Claw Dev prompts for it.

After you choose a provider, Claw Dev also lets you enter any model id you want for that session. You can press Enter to keep the suggested default, or type a custom model id such as:

- `gpt-4.1`
- `gpt-5-mini`
- `gpt-5.2`
- `gpt-5.2-codex`
- `gemini-2.5-pro`
- `openai/gpt-oss-120b`
- `anthropic/claude-sonnet-4`
- `google/gemini-2.5-pro`
- `openrouter/free`
- `qwen2.5-coder:14b`

Claw Dev also narrows the bundled in-app `/model` picker to the provider-relevant model set for the current session where possible. The startup model prompt is the safest place to choose the exact backend model for the session. Some in-app labels may still reflect the bundled client naming, but the startup selection remains the real model override.

## Additional Cloud Provider Setup

### OpenRouter

Recommended `.env` values:

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=https://github.com/Leonxlnx/claw-dev
OPENROUTER_APP_NAME=Claw Dev
OPENROUTER_MODEL=anthropic/claude-sonnet-4
OPENROUTER_MODEL_HAIKU=openrouter/free
OPENROUTER_MODEL_SONNET=anthropic/claude-sonnet-4
OPENROUTER_MODEL_OPUS=google/gemini-2.5-pro
```

Use OpenRouter when you want the largest hosted model catalog and the easiest way to paste arbitrary provider-qualified model ids. This is the best option in Claw Dev if model control matters more than strict provider branding.

Those optional `*_MODEL_HAIKU`, `*_MODEL_SONNET`, and `*_MODEL_OPUS` values are used to make the bundled `/model` command more useful during a running session.

### Copilot

Recommended `.env` values:

```env
COPILOT_TOKEN=your_github_models_token_here
COPILOT_MODEL=openai/gpt-4.1-mini
COPILOT_MODEL_SONNET=openai/gpt-4.1-mini
COPILOT_MODEL_OPUS=openai/gpt-4.1
COPILOT_MODEL_HAIKU=openai/gpt-4.1-mini
```

### z.ai

Recommended `.env` values:

```env
ZAI_API_KEY=your_zai_api_key_here
ZAI_MODEL=glm-5
```

### OpenAI

Recommended `.env` values:

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5-mini
OPENAI_MODEL_HAIKU=gpt-5-nano
OPENAI_MODEL_SONNET=gpt-5-mini
OPENAI_MODEL_OPUS=gpt-5.2-codex
```

If `~/.codex/auth.json` exists, Claw Dev can reuse that ChatGPT/Codex login as an experimental fallback. Example placeholder values such as `your_openai_api_key_here` are ignored. The in-app `/model` picker is filtered toward the active provider where possible, but provider-specific labels may still appear. Keyring-backed Codex auth is not supported yet.

## How To Use Ollama With Claw Dev

### 1. Install Ollama

Install Ollama from the official download page:

- [Ollama Downloads](https://ollama.com/download)

After installation, make sure the Ollama application or service is running.

### 2. Pull a local model

For a lightweight starting point:

```powershell
ollama pull qwen3
```

You can verify that the model is available with:

```powershell
ollama list
```

### 3. Start the Ollama server

If Ollama is not already running in the background, start it with:

```powershell
ollama serve
```

The default local API base URL is:

```text
http://127.0.0.1:11434
```

### 4. Start Claw Dev and choose Ollama

```powershell
cd E:\myclaudecode
pnpm run claw-dev
```

Then choose:

```text
8. Ollama
```

Claw Dev will point the bundled client at the local compatibility proxy, and the proxy will forward requests to your Ollama server.

### 5. Optional environment configuration

You can preconfigure Ollama mode in `.env`:

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
OLLAMA_API_KEY=
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

Notes:

- `OLLAMA_BASE_URL` should point to your Ollama server
- `OLLAMA_MODEL` is the model name Claw Dev will request
- `OLLAMA_API_KEY` is not required for local Ollama on `localhost`
- `OLLAMA_API_KEY` is only relevant if you are targeting an authenticated remote Ollama endpoint or the hosted Ollama API
- `OLLAMA_KEEP_ALIVE` keeps the model loaded between turns, which reduces repeated warm-up time
- `OLLAMA_NUM_CTX` controls prompt context size
- `OLLAMA_NUM_PREDICT` limits output length and can reduce latency

### 6. Check that Ollama is really being used

Useful checks:

```powershell
ollama ps
```

This shows which models are currently loaded and whether they are using CPU, GPU, or both.

You can also confirm that the Claw Dev proxy is healthy:

```powershell
pnpm run proxy:compat
```

Then open:

```text
http://127.0.0.1:8789/health
```

When Ollama mode is configured, you should see a JSON response with the active provider and model.

### 7. Ollama performance tuning

If Ollama feels slow, start with the following assumptions:

- larger context windows are slower
- longer outputs are slower
- first-token latency is usually worst on the first request after model load
- CPU-only inference is much slower than GPU-backed inference

Recommended starting values for a responsive local setup:

```env
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

If you need more quality and longer context, increase `OLLAMA_NUM_CTX` gradually to `4096` or higher. If you want faster responses, keep it smaller.

If you need shorter answers and lower latency, reduce `OLLAMA_NUM_PREDICT` further.

## Provider Recommendations

Claw Dev works best when the selected backend can tolerate a large system prompt, tool schemas, and enough conversation history for agent-style turns.

Practical guidance:

- Anthropic
  - best overall compatibility with the bundled client
  - best choice if you want the closest thing to the default slash-command and tool flow
- Gemini
  - usually the strongest non-Anthropic option for agent-style sessions
  - a good default when you want better long-context behavior than GitHub Models
- OpenRouter
  - best option when you want maximum hosted model choice
  - especially useful if you want to swap between Anthropic, Google, OpenAI, and open models without changing providers
- OpenAI
  - solid general-purpose cloud option
  - best when you specifically want the current GPT-family coding models
  - `gpt-5-mini` is the best default balance
  - `gpt-5.2` is the stronger general upgrade
  - `gpt-5.2-codex` is the best OpenAI-first option when coding quality matters more than cost
- Groq
  - best when low latency matters more than raw context budget
  - open model selection is strong, but tool-heavy sessions can still vary by model
- Copilot
  - works, but it has a smaller practical request budget in this setup
  - more likely to hit request-size issues or feel less agentic than Anthropic or Gemini
- Ollama
  - best for local-only use
  - model quality and speed depend heavily on your hardware and chosen model

If you want the smoothest experience, start with Anthropic, Gemini, or OpenRouter before trying Copilot or large local Ollama models.

## Recommended Workflows

If you want the least friction:

- Best overall
  - Anthropic with a current Claude model
- Best non-Anthropic cloud flow
  - Gemini with `gemini-2.5-flash` or `gemini-2.5-pro`
- Best OpenAI-first flow
  - OpenAI with `gpt-5-mini` for everyday coding
  - switch to `gpt-5.2` or `gpt-5.2-codex` for harder coding and planning work
- Best maximum model control
  - OpenRouter with explicit provider-qualified model ids
- Best free or almost-free experimentation
  - Ollama locally
  - Gemini free tier
  - OpenRouter free-tagged models when available
  - Groq for fast hosted open-model experiments

Practical note:

- free hosted tiers change often
- OpenRouter free availability can vary by model and provider
- local Ollama is the most stable zero-cost option if your hardware can keep up

## Better Onboarding and Model Control

The startup flow is the most important place to configure a session correctly.

- Claw Dev now treats obvious placeholder secrets from `.env.example` as unset
- the provider menu explains what each backend is good at
- the model prompt accepts any model id, not just the suggested defaults
- the proxy tries to return actionable errors for auth failures, missing models, quota errors, context overflow, and local connectivity issues

For the most control, prefer providers that let you paste arbitrary model ids cleanly:

- OpenRouter
- OpenAI
- Groq
- Ollama
- z.ai

### Suggested Starting Models

If you want Claw Dev to feel strong on day one, start with these:

- Anthropic
  - `claude-sonnet-4-20250514` for the smoothest overall slash-command and tool flow
- Gemini
  - `gemini-2.5-flash` for fast general use
  - `gemini-2.5-pro` for heavier reasoning and larger tasks
- OpenAI
  - `gpt-5-mini` as the default balance
  - `gpt-5.2` for stronger all-around work
  - `gpt-5.2-codex` when you specifically want stronger coding behavior
- OpenRouter
  - `anthropic/claude-sonnet-4` for a Claude-like hosted flow
  - `google/gemini-2.5-pro` for long-context reasoning
  - `openrouter/free` when you mainly want cheap or free experimentation
- Groq
  - `openai/gpt-oss-20b` for fast lightweight testing
  - `openai/gpt-oss-120b` when quality matters more than price and latency
- Ollama
  - `qwen3` or `qwen2.5-coder:7b` to start
  - `qwen2.5-coder:14b` only if your hardware can handle slower local inference
- Copilot
  - `openai/gpt-4.1-mini` or `openai/o4-mini`
  - avoid this path for the heaviest tool-rich sessions because the request budget is smaller

### Models That Commonly Feel Worse In This Setup

These are not broken, but they are usually the first place users hit frustration:

- very small hosted models when the session already has a lot of tools and history
- Copilot models for large tool-rich sessions
- very large local Ollama models on CPU-only hardware
- Gemma-style local models if you mainly care about coding-agent throughput instead of experimentation

## Recommended Environment Variables

### Anthropic

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-sonnet-4-20250514
```

### OpenAI

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-5-mini
```

If you already ran `codex login`, you can leave `OPENAI_API_KEY` unset and Claw Dev will reuse `~/.codex/auth.json` as an experimental fallback. Example placeholder values are treated as unset.

### Gemini

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
```

### Groq

```env
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-20b
```

### OpenRouter

```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_SITE_URL=https://github.com/Leonxlnx/claw-dev
OPENROUTER_APP_NAME=Claw Dev
OPENROUTER_MODEL=anthropic/claude-sonnet-4
```

Suggested starting models:

- `openrouter/free`
- `openai/gpt-oss-20b:free`
- `meta-llama/llama-3.3-70b-instruct:free`
- `anthropic/claude-sonnet-4`
- `google/gemini-2.5-flash`
- `google/gemini-2.5-pro`
- `openai/gpt-oss-20b:free`
- `openai/gpt-oss-120b`

### Ollama

```env
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3
OLLAMA_API_KEY=
OLLAMA_KEEP_ALIVE=30m
OLLAMA_NUM_CTX=2048
OLLAMA_NUM_PREDICT=128
```

### Copilot

```env
COPILOT_TOKEN=your_github_models_token_here
COPILOT_MODEL=openai/gpt-4.1-mini
COPILOT_MODEL_SONNET=openai/gpt-4.1-mini
COPILOT_MODEL_OPUS=openai/gpt-4.1
COPILOT_MODEL_HAIKU=openai/gpt-4.1-mini
```

### z.ai

```env
ZAI_API_KEY=your_zai_api_key_here
ZAI_MODEL=glm-5
```

## Useful Commands

Check the installed launcher version:

```powershell
cd E:\myclaudecode\Leonxlnx-claude-code
.\claw-dev.cmd --version
```

Check the installed launcher version on macOS or Linux:

```bash
cd /path/to/myclaudecode/Leonxlnx-claude-code
chmod +x ./claw-dev.sh
./claw-dev.sh --version
```

Skip the provider menu and force a specific provider:

```powershell
.\claw-dev.cmd --provider anthropic
.\\claw-dev.cmd --provider openai
.\claw-dev.cmd --provider gemini
.\claw-dev.cmd --provider groq
.\\claw-dev.cmd --provider openrouter
.\claw-dev.cmd --provider copilot
.\claw-dev.cmd --provider zai
.\claw-dev.cmd --provider ollama
```

You can also skip the default model prompt and force any model id directly:

```powershell
.\claw-dev.cmd --provider openai --model gpt-5-mini
.\claw-dev.cmd --provider gemini --model gemini-2.5-pro
.\claw-dev.cmd --provider groq --model openai/gpt-oss-120b
.\\claw-dev.cmd --provider openrouter --model anthropic/claude-sonnet-4
.\claw-dev.cmd --provider copilot --model openai/o4-mini
.\claw-dev.cmd --provider zai --model glm-4.5
.\claw-dev.cmd --provider ollama --model qwen2.5-coder:14b
```

Equivalent macOS or Linux examples:

```bash
./claw-dev.sh --provider openai --model gpt-5-mini
./claw-dev.sh --provider ollama --model qwen2.5-coder:14b
```

If you want extra suggestions to appear in the proxy model catalog, you can define optional comma-separated model lists:

```env
OPENAI_MODELS=gpt-5-mini,gpt-5.2,gpt-5-nano,gpt-5.2-codex,gpt-4.1,o3-mini,o4-mini
GEMINI_MODELS=gemini-2.5-flash,gemini-2.5-pro,gemma-3-27b-it
GROQ_MODELS=openai/gpt-oss-20b,openai/gpt-oss-120b,qwen/qwen3-32b
OPENROUTER_MODELS=openrouter/free,openai/gpt-oss-20b:free,meta-llama/llama-3.3-70b-instruct:free,anthropic/claude-sonnet-4,google/gemini-2.5-flash,google/gemini-2.5-pro,openai/gpt-oss-120b,meta-llama/llama-3.3-70b-instruct
COPILOT_MODELS=openai/gpt-4.1-mini,openai/gpt-4.1,openai/gpt-4o,openai/o4-mini
ZAI_MODELS=glm-5,glm-4.5,glm-4.5-air
OLLAMA_MODELS=qwen3,qwen2.5-coder:7b,qwen2.5-coder:14b,deepseek-r1:8b
```

Important note:

- the startup model override accepts any model id
- the bundled `/model` command inside the client still originates from the bundled UI, so some visible labels may look Claude-like
- Claw Dev now also primes provider-specific model overrides for the common Haiku, Sonnet, and Opus slots so `/model` is more useful during a running session
- the startup model choice is still the safest and most explicit backend override for the session

Legacy aliases are still accepted:

```powershell
.\claw-dev.cmd --provider claude
.\claw-dev.cmd --provider grok
```

Run a one-shot prompt:

```powershell
echo "Summarize this repository" | .\claw-dev.cmd --bare -p
```

## Git Privacy Before Publishing

Before creating public commits, verify that your local Git identity is safe to publish.

Recommended settings for this repository:

```powershell
git config user.name "Leonxlnx"
git config user.email "219127460+Leonxlnx@users.noreply.github.com"
```

You can verify the active values with:

```powershell
git config user.name
git config user.email
```

Important notes:

- `.env` is ignored by `.gitignore`
- `node_modules` is ignored
- `dist` is ignored
- `*.log` files are ignored
- always review `git status` before staging
- always review `git diff --cached` before pushing

Useful checks:

```powershell
git status --short
git diff --cached
```

## Architecture Overview

Claw Dev works in two modes:

- Anthropic mode
  - the bundled client talks to Anthropic directly
- Compatibility mode
  - the bundled client talks to the local proxy
  - the local proxy translates Anthropic-style `/v1/messages` requests into OpenAI, Gemini, Groq, OpenRouter, Ollama, Copilot, or z.ai API calls

This keeps the terminal experience consistent while allowing different model backends.

## Troubleshooting

### The startup flow says a key is missing even though `.env` has a value

Claw Dev treats obvious placeholder values from `.env.example` as unset. Replace values such as `your_openrouter_api_key_here` with a real secret before testing.

### The proxy says authentication was rejected

That usually means one of the following:

- the API key is invalid
- the account does not have access to the selected model
- the provider expects a different token type

Recommended checks:

- re-copy the API key carefully
- confirm the selected model is available to that account
- restart Claw Dev after changing `.env`

### The proxy says the model was not found

This usually means the model id is wrong for the selected provider.

Examples:

- OpenRouter expects provider-qualified ids such as `anthropic/claude-sonnet-4`
- Groq expects Groq-supported ids such as `openai/gpt-oss-20b`
- Ollama expects the local model tag, such as `qwen3` or `qwen2.5-coder:14b`

### The proxy says the request was too large or hit a token limit

This usually means the backend could not fit the current agent prompt, tool schemas, and conversation history into the model's practical request budget.

Recommended fixes:

- switch to Anthropic, Gemini, or OpenRouter for larger agent-style sessions
- choose a higher-context model
- start a fresh session when the conversation becomes too large
- avoid Copilot for the heaviest tool-rich flows

### Ollama does not answer

Check the following:

- Ollama is installed
- the Ollama service or background app is running
- `ollama serve` is active if needed
- the selected model was pulled successfully
- `OLLAMA_BASE_URL` points to the correct server

### Ollama answers slowly

Common causes:

- the model is running on CPU instead of GPU
- the selected model is too large for your hardware
- the model is partly swapping between GPU and system memory
- the context window is too large for your use case
- the requested answer is longer than necessary

Use:

```powershell
ollama ps
```

to inspect how the model is loaded.

If `PROCESSOR` shows `100% CPU`, slow generation is expected.

Recommended fixes:

- keep `OLLAMA_NUM_CTX` at `2048` first
- keep `OLLAMA_NUM_PREDICT` low for short answers
- leave `OLLAMA_KEEP_ALIVE=30m` or longer so the model stays warm
- try a smaller model if local responsiveness matters more than maximum quality

### Cloud providers work, but Ollama does not

That usually means Claw Dev is working correctly, but the local Ollama server is not reachable or does not have the requested model.

## Sharing With Another User

If you hand this repository to someone else, the shortest setup path is:

1. Install Node.js 22 or newer
2. Run `pnpm install`
3. Start `pnpm start` or `pnpm run claw-dev`
4. Choose a provider
5. Supply credentials or run Ollama locally

They do not need a separate global installation of the bundled client in order to use this repository.

## Verification

Useful checks:

```powershell
pnpm run check
pnpm run build
pnpm run claw-dev -- --version
```

## References

Official documentation used for this setup:

- [Ollama Documentation](https://docs.ollama.com/)
- [Ollama API Introduction](https://docs.ollama.com/api/introduction)
- [Ollama API Authentication](https://docs.ollama.com/api/authentication)
- [Ollama FAQ](https://docs.ollama.com/faq)
- [Anthropic Claude Code Quickstart](https://code.claude.com/docs/en/quickstart)
- [OpenAI Chat Completions](https://platform.openai.com/docs/api-reference/chat/create)
- [Groq Docs](https://console.groq.com/docs)
- [OpenRouter API Overview](https://openrouter.ai/docs/api-reference/overview)
- [OpenRouter Quickstart](https://openrouter.ai/docs/quickstart)
- [GitHub Models API announcement](https://github.blog/changelog/2025-05-15-github-models-api-now-available)
