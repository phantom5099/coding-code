import { generateText, streamText, stepCountIs, type ToolSet } from "ai";
import type { ModelMessage } from "@ai-sdk/provider-utils";
import { getModel } from "../providers";
import { readFileTool, writeFileTool, listDirTool } from "../tools/fs";
import { execCommandTool } from "../tools/shell";
import { searchCodeTool } from "../tools/search";

const tools = {
  read_file: readFileTool,
  write_file: writeFileTool,
  list_dir: listDirTool,
  execute_command: execCommandTool,
  search_code: searchCodeTool,
} satisfies ToolSet;

const SYSTEM_PROMPT = `You are a coding assistant — an AI agent that helps users write, read, search, and modify code.

## Rules
1. Read files before modifying them — never guess file contents
2. Use search_code to find where symbols are defined
3. After writing files, verify with read_file
4. Prefer editing existing files over creating new ones
5. Make small, focused changes — avoid large rewrites
6. Run tests or type-check after changes when applicable
7. If the user's request is ambiguous, ask for clarification

## Environment
- Working directory: ${process.cwd()}
- Operating system: ${process.platform}
- Shell: ${process.env.SHELL || process.env.ComSpec || "bash"}

Respond in the user's language. Use code blocks for code.`;

export class Agent {
  private messages: ModelMessage[] = [];

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: "user", content: userInput } as ModelMessage);

    const result = await generateText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      messages: this.messages,
      tools,
      stopWhen: stepCountIs(15),
    });

    this.messages = [...result.response.messages];
    return result.text;
  }

  async *runStream(userInput: string): AsyncGenerator<string, string, unknown> {
    this.messages.push({ role: "user", content: userInput } as ModelMessage);

    const result = streamText({
      model: getModel(),
      system: SYSTEM_PROMPT,
      messages: this.messages,
      tools,
      stopWhen: stepCountIs(15),
    });

    for await (const part of result.fullStream) {
      switch (part.type) {
        case "text-delta":
          yield part.text;
          break;
        case "tool-call":
          yield `\n[Using: ${part.toolName}]\n`;
          break;
        case "tool-result":
          break;
        case "error":
          yield `\n[Error: ${String(part.error)}]\n`;
          break;
      }
    }

    const response = await result.response;
    this.messages = [...response.messages] as ModelMessage[];
    return "";
  }

  clearContext(): void {
    this.messages = [];
  }
}
