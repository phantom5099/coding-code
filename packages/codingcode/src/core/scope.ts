export interface ProjectScope {
  projectPath: string;
}

export interface SessionScope {
  projectPath: string;
  sessionId: string;
}

export type Scope = ProjectScope | SessionScope;
