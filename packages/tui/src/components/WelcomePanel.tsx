interface WelcomeContent {
  model: string;
  role: string;
  sessionId: string;
}

export function buildWelcomeContent({ model, role, sessionId }: WelcomeContent): string {
  return [
    '',
    '  C O D I N G    A G E N T',
    '',
    `  Model:    ${model}`,
    `  Role:     ${role}`,
    `  Session:  ${sessionId.slice(0, 8)}`,
    '',
    '  Type /help for available commands.',
    '',
  ].join('\n');
}
