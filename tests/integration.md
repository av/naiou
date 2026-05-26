# Naiou Integration Tests

## Prerequisites

- Run from `/home/everlier/code/naiou`.
- Dependencies are installed with `bun install`.
- The compiled binary is built with `bun run build`.
- Tests that call the oracle use a mocked `fetch`; no real API key is required.

## Test 1: Facts And Build Health

Steps:
- Run `facts list --tags "spec"`.
- Run `facts check`.
- Run `bunx tsc --noEmit`.
- Run `bun run build`.

Expectations:
- `facts list --tags "spec"` prints no remaining `@spec` facts.
- `facts check` has zero failed command-backed facts.
- TypeScript checking exits 0.
- Build exits 0 and writes `./naiou`.

## Test 2: CLI Help And Version

Steps:
- Run `bun run src/main.ts --help`.
- Run `bun run src/main.ts --version`.
- Run `./naiou --help`.

Expectations:
- Help output includes `naiou - OpenTUI yes/no oracle`.
- Version output is `0.3.3`.
- Compiled binary help exits 0.

## Test 3: Agent Contract

Steps:
- Run `bun test tests/agent.test.ts`.

Expectations:
- Shell environment values override values from `${NAIOU_HOME}/config.json`.
- A mocked accepted yes/no response resolves to `{ type: "decision", decision: "Yes" }`.
- Bundled file tools reject `..` traversal outside the workspace.

## Test 4: TUI Smoke

Steps:
- Run `timeout 2s ./naiou`.

Expectations:
- The command starts the full-screen OpenTUI app.
- The process is still alive until `timeout` stops it, so exit code `124` is acceptable.

## Execution Summary

- `facts list --tags "spec"`: pass, no remaining `@spec` facts.
- `facts check`: pass for command-backed facts, 0 failed.
- `bunx tsc --noEmit`: pass.
- `bun run build`: pass.
- `bun run src/main.ts --help`: pass.
- `bun run src/main.ts --version`: pass.
- `./naiou --help`: pass.
- `bun test tests/agent.test.ts`: pass.
- `timeout 2s ./naiou`: pass, timeout stopped the interactive TUI as expected.
