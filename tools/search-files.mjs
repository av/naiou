import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();
const skipped = new Set([".git", "node_modules", "dist", "build", ".next"]);

export default {
  name: "search_files",
  description: "Search UTF-8 workspace files for a literal text pattern.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Literal text to search for." },
      path: { type: "string", description: "Relative directory or file path to search.", default: "." },
      limit: { type: "number", description: "Maximum matching lines to return.", default: 50 },
    },
    required: ["query"],
  },
  handler({ query, path = ".", limit = 50 } = {}) {
    const needle = String(query || "");

    if (!needle) {
      throw new Error("query is required");
    }

    const target = safePath(path);

    if (!existsSync(target)) {
      return `Path not found: ${path}`;
    }

    const matches = [];

    walk(target, (file) => {
      if (matches.length >= clampLimit(limit)) {
        return;
      }

      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);

      for (let index = 0; index < lines.length && matches.length < clampLimit(limit); index += 1) {
        if (lines[index].includes(needle)) {
          matches.push(`${relative(root, file)}:${index + 1}: ${lines[index]}`);
        }
      }
    });

    return matches.join("\n") || "No matches.";
  },
};

function walk(target, visit) {
  const stat = statSync(target);

  if (stat.isFile()) {
    visit(target);
    return;
  }

  if (!stat.isDirectory()) {
    return;
  }

  for (const entry of readdirSync(target)) {
    if (skipped.has(entry)) {
      continue;
    }

    walk(resolve(target, entry), visit);
  }
}

function safePath(input) {
  const target = resolve(root, String(input));

  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error("path must stay inside the current workspace");
  }

  return target;
}

function clampLimit(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 50;
}
