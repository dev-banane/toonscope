# Changelog

## 0.0.1

- **Parsing**: standalone `web-tree-sitter` WASM build (no native bindings),
  grammars for TypeScript, TSX, JavaScript, and Python bundled in `wasm/`.
- **Structured extraction**: exports, imports (with resolved paths and
  tsconfig/jsconfig `paths`-alias support via nearest-tsconfig resolution),
  full function/method signatures with typed params and return types, and
  local/shared type definitions — no longer just prose summaries.
- **Python support**: `analyzer/python.ts` covers functions, classes,
  imports, and docstrings alongside the TS/JS analyzer.
- **AI summarization**: optional, cached, concurrent summarization via
  Google Gemini, Anthropic Claude, OpenAI, or a local Ollama model. Runs
  never abort on a single provider failure — the deterministic template
  summary is always the fallback.
- **`init` rewrite**: detects your framework, languages, and source
  directories; detects existing AGENTS.md/CLAUDE.md/.cursor/.github/GEMINI.md/
  .windsurf configs; walks through optional AI summary setup (checks env
  vars first, offers to store a key via `toonscope key set`); writes
  `.toonscope.yaml`; generates integration files; and offers to run the
  first `generate` — all with sane non-interactive defaults.
- **Integration files rewritten**: the managed blocks in AGENTS.md,
  CLAUDE.md, `.cursor/rules/*.mdc`, `.github/copilot-instructions.md`,
  GEMINI.md, and (new) `.windsurf/rules/*.md` now accurately describe the
  current `.toon/` output shape (`index.yaml`, `graph.yaml`, `types.yaml`,
  `files/<path>.yaml`) instead of the old flat format.
- **`.gitignore` handling**: now only touched by `init`, gated by the new
  `gitignoreToon` config key (default `true`), and anchors the entry as
  `/.toon/`. Other commands no longer write to `.gitignore` at all.
- **`generate --force`**: bypasses the cache for a full rebuild; incremental
  reuse (via `.toon/cache.json`) remains the default.
- **Resilience**: a single file that fails to parse or read is now warned
  about and skipped rather than aborting the whole `generate`/`scope` run;
  the failure count is reported in the summary and in `ctx.meta.errors`.
- **`toonscope clean`**: removes `.toon/`; `--integrations` also strips the
  managed blocks from AGENTS.md/etc. and deletes the cursor/windsurf rule
  files.
- **Cross-platform fix**: `detectTools()` no longer shells out to `sh -lc
  "command -v ..."` (which crashed or false-negatived on Windows without
  Git Bash on PATH) — PATH lookup is now a pure, try/catch-wrapped
  filesystem check that respects `PATHEXT` on Windows.
