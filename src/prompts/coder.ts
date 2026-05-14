import { readFileTool, writeFileTool, listDirTool } from "../tools/fs";
import { execCommandTool } from "../tools/shell";
import { searchCodeTool } from "../tools/search";
import { webFetchTool } from "../tools/webfetch";
import type { PromptSet } from "./types";

/** 编码助手：读、写、搜索、执行、网络抓取 — 全功能 */
export const coderPromptSet: PromptSet = {
  label: "Coder",
  description: "Full coding assistant — read, write, search, execute, fetch",
  maxSteps: 15,
  tools: {
    read_file: readFileTool,
    write_file: writeFileTool,
    list_dir: listDirTool,
    execute_command: execCommandTool,
    search_code: searchCodeTool,
    fetch_url: webFetchTool,
  },
  buildSystem: (env) => `You are a coding assistant — an AI agent that helps users write, read, search, and modify code.

## Rules
1. Read files before modifying them — never guess file contents
2. Use search_code to find where symbols are defined
3. After writing files, verify with read_file
4. Prefer editing existing files over creating new ones
5. Make small, focused changes — avoid large rewrites
6. Run tests or type-check after changes when applicable
7. If the user's request is ambiguous, ask for clarification

## Environment
- Working directory: ${env.cwd}
- Operating system: ${env.platform}
- Shell: ${env.shell}

Respond in the user's language. Use code blocks for code.`,
};
