# Contributing to ToonScope

Thanks for taking the time to contribute. This doc covers how to get a dev
environment running, how the project is laid out, and what to check before
opening a pull request.

## Getting set up

You'll need Node 22 or newer (the repo is pinned to 22.13.0 in `.nvmrc`,
so `nvm use` will get you there if you use nvm).

```bash
git clone https://github.com/dev-banane/toonscope.git
cd toonscope
npm install
```

From there:

```bash
npm run build      # compile with tsup, writes to dist/
npm run dev         # tsup in watch mode
npm test             # vitest in watch mode
npm run test:run     # vitest, single run (this is what CI/prepublish uses)
npm run format        # prettier --write, formats the whole repo
npm run format:check   # prettier --check, what CI runs
```

To try your changes against a real project without publishing anything,
link the CLI locally:

```bash
npm run build
node dist/cli.js init      # or generate, check, scope, etc.
```

## Project layout

- `src/analyzer/`: tree-sitter based parsing per language, extracts
  exports, imports, signatures, and types from a single file.
- `src/compiler/`: turns analyzed files into the `.toon/` output, including
  the cache, the graph, the YAML emitter, and `check.ts` for staleness
  detection.
- `src/ai/`: the optional LLM summarization step. Each provider
  (Anthropic, OpenAI, Google, Mistral, Ollama) implements the same
  `AIProvider` interface in `src/ai/index.ts`, built around the shared
  prompt/response handling in `src/ai/prompts.ts`.
- `src/graph/`: dependency graph traversal used by `toonscope scope`.
- `src/integrations/`: writes the managed sections in AGENTS.md,
  CLAUDE.md, and other tool-specific rule files.
- `src/cli.ts`: the commander.js entry point wiring all of the above
  together into commands.
- `test/`: vitest suite, with `test/fixtures/` holding small sample
  projects the analyzer and compiler tests run against.
- `benchmark/`: scripts for measuring token reduction and performance on
  larger projects; not part of the published package.

If you're not sure where a change belongs, `.toon/` in this repo (yes,
ToonScope indexes itself) is a fast way to see what imports what.

## Adding a new AI provider

Providers follow a consistent shape, so an existing one is the best
reference. Look at `src/ai/mistral.ts` alongside `test/ai/mistral.test.ts`
for the most recently added example, then update:

- `src/ai/index.ts` (registration and default model)
- `src/ai/keys.ts` (`AIProviderId` union and env var candidates)
- `src/types.ts` (the `provider` union on `ToonConfig['ai']`)
- `src/cli.ts` (`SUPPORTED_KEY_PROVIDERS` / `SUPPORTED_AI_PROVIDERS` and
  the relevant help text)
- `README.md` (the provider table)

## Before opening a PR

- `npm run test:run` should pass.
- `npx tsc --noEmit` should be clean (test fixtures are excluded from the
  TypeScript project on purpose, some are intentionally invalid).
- `npm run format:check` should pass; run `npm run format` if it doesn't.
- Add or update tests for behavior you changed. The existing suite under
  `test/` is the best template for style and structure.
- Keep changes scoped. A bug fix doesn't need an accompanying refactor,
  and a new command doesn't need to touch unrelated ones.
- If your change affects what agents are told to do (the AGENTS.md/
  CLAUDE.md managed sections in `src/integrations/index.ts`), regenerate
  this repo's own integration files with `node dist/cli.js generate` so
  the diff shows the real output.

## Commit messages

This repo loosely follows [Conventional Commits](https://www.conventionalcommits.org/)
(`feat:`, `fix:`, `docs:`, etc.) for anything that isn't a version bump.
It's a convention, not a hard gate: a clear, specific message beats a
perfectly formatted vague one.

## Reporting bugs

Open an issue at [github.com/dev-banane/toonscope/issues](https://github.com/dev-banane/toonscope/issues)
with:

- what you ran (the exact `toonscope` command and flags)
- what you expected vs. what happened
- your OS and Node version
- if it's a parsing issue, the smallest source snippet that reproduces it

## License

By contributing, you agree that your contributions will be licensed under
the project's [AGPL-3.0-only license](LICENSE).
