import { execFile } from "node:child_process";

const root = process.cwd();
const MAX_OUTPUT = 16000;

const ALLOWED = new Set(["date", "wc", "find", "head", "tail", "diff", "file", "git"]);

const GIT_READONLY = new Set([
  "log", "diff", "blame", "show", "status", "branch", "tag", "rev-parse", "ls-files",
]);

export default {
  name: "run_command",
  description:
    "Run a read-only command with arguments (no shell, no pipes). " +
    "Allowed: date, wc, find, head, tail, diff, file, git (read-only subcommands only).",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      command: { type: "string", description: "Command name." },
      args: {
        type: "array",
        items: { type: "string" },
        description: "Arguments as separate strings.",
        default: [],
      },
    },
    required: ["command"],
  },
  handler({ command, args = [] } = {}) {
    const cmd = String(command || "");
    const cmdArgs = (Array.isArray(args) ? args : []).map(String);

    if (!ALLOWED.has(cmd)) {
      throw new Error(`not allowed: ${cmd}. allowed: ${[...ALLOWED].join(", ")}`);
    }

    if (cmd === "git") {
      const sub = cmdArgs[0];
      if (!sub || !GIT_READONLY.has(sub)) {
        throw new Error(
          `git subcommand not allowed: ${sub}. allowed: ${[...GIT_READONLY].join(", ")}`,
        );
      }
    }

    return new Promise((resolve, reject) => {
      execFile(
        cmd,
        cmdArgs,
        { cwd: root, timeout: 10_000, maxBuffer: MAX_OUTPUT },
        (error, stdout, stderr) => {
          if (error && !stdout && !stderr) {
            reject(new Error(error.message));
            return;
          }

          let output = stdout || "";
          if (stderr) output += (output ? "\n" : "") + stderr;
          if (output.length > MAX_OUTPUT) output = output.slice(0, MAX_OUTPUT) + "\n[truncated]";
          resolve(output || "(no output)");
        },
      );
    });
  },
};
