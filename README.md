<p align="center"><img src="./assets/question.webp" width="32%" alt="splash" /> <img src="./assets/deciding.webp" width="32%" alt="deciding" /> <img src="./assets/decision.webp" width="32%" alt="decision" /></p>


OpenTUI yes/no oracle with 3D hyperspace visualization.

Every question receives a definitive **Yes** or **No** — no refusals, no hedging.

## Installation

The recommended way to install naiou is with the install script:

```bash
curl -fsSL https://raw.githubusercontent.com/av/naiou/refs/heads/master/install.sh | sh
```

This downloads the latest prebuilt binary for your platform from GitHub Releases and installs it to a location in your PATH (`/usr/local/bin` or `~/.local/bin`).

**Supported platforms:**
- Linux (amd64, arm64)
- macOS (arm64 / Apple Silicon)

**Other platforms** (Windows, Intel Macs): Prebuilt binaries are provided in GitHub Releases.
- Windows: `naiou-windows-amd64.zip`
- Intel Mac: build from source (see Development section)

After installation, run `naiou` and enter your OpenAI-compatible API key when prompted (or set `OPENAI_API_KEY`).

## Requirements

- OpenAI-compatible key:
  - `OPENAI_API_KEY` (env)
  - or `~/.naiou/config.json` (`OPENAI_API_KEY`, optional `OPENAI_BASE_URL` + `MODEL`)

## CLI

```
naiou [options]
  -h, --help     Show help
  -v, --version  Show version
```

## Development

For development or unsupported platforms, clone the repository and build from source:

```bash
git clone https://github.com/av/naiou
cd naiou
bun install
bun run build
./naiou
```

See [AGENTS.md](AGENTS.md) for the fact-driven development workflow.

The built binary is ~140 MB (includes Three + OpenTUI + WebGPU stack).
