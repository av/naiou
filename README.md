# naiou

OpenTUI yes/no oracle with 3D hyperspace visualization.

Every question receives a definitive **Yes** or **No** — no refusals, no hedging.

## Quick start

```bash
bun install
bun run build
./naiou
```

Type a question, press Enter. The agent researches (using safe workspace tools when needed) while the starfield animates, then renders the answer on a shaded response planet.

## Requirements

- Bun
- OpenAI-compatible key:
  - `OPENAI_API_KEY` (env)
  - or `~/.naiou/config.json` (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL` + `MODEL`)

## CLI

```
naiou [options]
  -h, --help     Show help
  -v, --version  Show version
```

Dev: `bun run start`

## Development

See AGENTS.md for the fact-driven workflow.

The built binary is ~140 MB (includes Three + OpenTUI + WebGPU stack).
