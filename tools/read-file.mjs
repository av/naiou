import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();

export default {
  name: "read_file",
  description: "Read a UTF-8 text file from the current workspace, capped to a byte range.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      path: { type: "string", description: "Relative file path to read." },
      offset: { type: "number", description: "Byte offset to start from.", default: 0 },
      limit: { type: "number", description: "Maximum bytes to read.", default: 12000 },
    },
    required: ["path"],
  },
  handler({ path, offset = 0, limit = 12000 } = {}) {
    const target = safePath(path);

    if (!existsSync(target)) {
      return `File not found: ${path}`;
    }

    const stat = statSync(target);

    if (!stat.isFile()) {
      return `Not a file: ${path}`;
    }

    const start = Math.max(0, Number(offset) || 0);
    const end = start + clampLimit(limit);

    return readFileSync(target).subarray(start, end).toString("utf8");
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

  return Number.isFinite(parsed) ? Math.max(1, Math.min(50000, parsed)) : 12000;
}
