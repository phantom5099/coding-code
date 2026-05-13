import { tool } from "ai";
import { z } from "zod";
import { readFile, writeFile, readdir, stat, mkdir } from "fs/promises";
import { resolve, relative, dirname } from "path";

export const readFileTool = tool({
  description: "Read the contents of a file with line numbers. Use this before modifying any file.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file (absolute or relative)"),
    offset: z.number().int().min(1).default(1).describe("Line to start from (1-indexed)"),
    limit: z.number().int().min(1).max(500).default(200).describe("Max lines to read"),
  }),
  execute: async ({ path, offset, limit }) => {
    const filePath = resolve(path);
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n");
    const start = Math.max(0, offset - 1);
    const slice = lines.slice(start, start + limit);
    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(4, " ")}| ${line}`)
      .join("\n");
    return numbered || "(empty file)";
  },
});

export const writeFileTool = tool({
  description: "Write content to a file. Creates parent directories if needed. Overwrites by default.",
  inputSchema: z.object({
    path: z.string().describe("Path to the file"),
    content: z.string().describe("Content to write"),
  }),
  execute: async ({ path, content }) => {
    const filePath = resolve(path);
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
    const relPath = relative(process.cwd(), filePath) || ".";
    return `File written: ${relPath} (${content.split("\n").length} lines, ${content.length} bytes)`;
  },
});

export const listDirTool = tool({
  description: "List files and directories in a given path.",
  inputSchema: z.object({
    path: z.string().default(".").describe("Directory path (defaults to current directory)"),
  }),
  execute: async ({ path }) => {
    const dirPath = resolve(path);
    const entries = await readdir(dirPath, { withFileTypes: true });
    const items = await Promise.all(
      entries.map(async (e) => {
        try {
          const s = await stat(resolve(dirPath, e.name));
          const size = s.isFile() ? ` (${s.size} B)` : "";
          return `${e.isDirectory() ? "DIR" : "FILE"}  ${e.name}${size}`;
        } catch {
          return `${e.isDirectory() ? "DIR" : "FILE"}  ${e.name}`;
        }
      }),
    );
    return `Contents of ${relative(process.cwd(), dirPath) || "."}:\n${items.join("\n")}`;
  },
});
