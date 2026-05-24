#!/bin/sh
set -e

echo "Building naiou (TypeScript/Bun)..."
bun build --compile src/main.ts --outfile naiou
