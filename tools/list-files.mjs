import { existsSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";

const root = process.cwd();

export default {
  name: "list_files",
  description: "List files and directories under a relative path in the current workspace.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Relative directory path to list.", default: "." },
      limit: { type: "number", description: "Maximum entries to return.", default: 80 },
    },
  },
  handler({ path = ".", limit = 80 } = {}) {
    const target = safePath(path);

    if (!existsSync(target)) {
      return `Path not found: ${path}`;
    }

    const stat = statSync(target);

    if (!stat.isDirectory()) {
      return `Not a directory: ${path}`;
    }

    return readdirSync(target)
      .slice(0, clampLimit(limit))
      .map((entry) => {
        const entryPath = resolve(target, entry);
        const suffix = statSync(entryPath).isDirectory() ? "/" : "";

        return `${relative(root, entryPath)}${suffix}`;
      })
      .join("\n");
  },
};

function safePath(input) {
  const target = resolve(root, String(input));

  if (target !== root && !target.startsWith(`${root}/`)) {
    throw new Error("path must stay inside the current workspace");
  }

  return target;
}

function clampLimit(value) {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : 80;
}
