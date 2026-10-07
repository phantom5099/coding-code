import { isPlanProfile, type ProfileName } from '../session/types.js';

export const PLAN_TOOL_NAMES: readonly string[] = [
  'read_file',
  'search_files',
  'search_code',
  'fetch_url',
  'submit_plan',
];

export const BUILD_TOOL_NAMES: readonly string[] = [
  'read_file',
  'write_file',
  'edit_file',
  'execute_command',
  'search_code',
  'search_files',
  'fetch_url',
  'web_search',
  'todo_write',
  'spawn_agent',
  'wait_agent',
];

export const PLAN_ALLOWED_TOOLS: ReadonlySet<string> = new Set(PLAN_TOOL_NAMES);

export function getToolNames(name: ProfileName | undefined): readonly string[] {
  return isPlanProfile(name) ? PLAN_TOOL_NAMES : BUILD_TOOL_NAMES;
}
