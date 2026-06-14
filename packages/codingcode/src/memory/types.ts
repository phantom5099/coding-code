export interface MemoryTypeEntry {
  name: string;
  description: string;
  isBuiltIn: boolean;
  disabled: boolean;
}

export interface StructuredTranscript {
  userOnly: string;
  userAndAssistant: string;
  userAndTools: string;
}
