import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadMcpConfig } from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_CODINGCODE_DIR = join(__dirname, '..', '..', '..', '.codingcode');

describe('loadMcpConfig', () => {
  beforeEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR)) rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
    mkdirSync(TEST_CODINGCODE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR)) rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
  });

  it('should return empty array when no config exists', () => {
    const result = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(result).toEqual([]);
  });

  it('should load stdio server config from mcp.yaml', () => {
    writeFileSync(
      join(TEST_CODINGCODE_DIR, 'mcp.yaml'),
      `servers:
  - name: test-stdio
    command: npx
    args: ["-y", "test-server"]
`,
    );

    const configs = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test-stdio');
    expect(configs[0].command).toBe('npx');
    expect(configs[0].args).toEqual(['-y', 'test-server']);
  });

  it('should load SSE server config from mcp.yaml', () => {
    writeFileSync(
      join(TEST_CODINGCODE_DIR, 'mcp.yaml'),
      `servers:
  - name: test-sse
    url: "https://mcp.example.com/sse"
    headers:
      Authorization: "Bearer token123"
    concurrency: 5
`,
    );

    const configs = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe('test-sse');
    expect(configs[0].url).toBe('https://mcp.example.com/sse');
    expect(configs[0].concurrency).toBe(5);
  });

  it('should resolve ${ENV_VAR} placeholders', () => {
    process.env.TEST_TOKEN = 'resolved-token';
    writeFileSync(
      join(TEST_CODINGCODE_DIR, 'mcp.yaml'),
      `servers:
  - name: test-env
    url: "https://api.example.com"
    headers:
      Authorization: "Bearer \${TEST_TOKEN}"
`,
    );

    const configs = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(configs[0].headers!.Authorization).toBe('Bearer resolved-token');

    delete process.env.TEST_TOKEN;
  });

  it('should handle unresolved env var as empty string', () => {
    writeFileSync(
      join(TEST_CODINGCODE_DIR, 'mcp.yaml'),
      `servers:
  - name: test-missing
    url: "https://api.example.com"
    headers:
      X-Missing: "\${NONEXISTENT_VAR}"
`,
    );

    const configs = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(configs[0].headers!.Authorization).toBeUndefined();
  });
});
