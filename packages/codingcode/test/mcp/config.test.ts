import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadMcpConfig, writeMcpConfig } from '../../src/mcp/config.js';
import { parse as parseYaml } from 'yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_CODINGCODE_DIR = join(__dirname, '..', '..', '..', '.codingcode');

describe('loadMcpConfig', () => {
  beforeEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
    mkdirSync(TEST_CODINGCODE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
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
`
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
`
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
`
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
`
    );

    const configs = loadMcpConfig(join(__dirname, '..', '..', '..'));
    expect(configs[0].headers!.Authorization).toBeUndefined();
  });
});

describe('writeMcpConfig', () => {
  beforeEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
    mkdirSync(TEST_CODINGCODE_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_CODINGCODE_DIR))
      rmSync(TEST_CODINGCODE_DIR, { recursive: true, force: true });
  });

  it('should write and read back servers correctly', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    const servers = [{ name: 'test-server', command: 'npx', args: ['-y', 'test'], concurrency: 5 }];
    writeMcpConfig(projectRoot, servers);
    const result = loadMcpConfig(projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('test-server');
    expect(result[0].concurrency).toBe(5);
  });

  it('should overwrite existing servers list', () => {
    const projectRoot = join(__dirname, '..', '..', '..');
    writeMcpConfig(projectRoot, [{ name: 'old', command: 'echo' }]);
    writeMcpConfig(projectRoot, [{ name: 'new', command: 'ls' }]);
    const result = loadMcpConfig(projectRoot);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('new');
  });

  it('should preserve other top-level keys in the yaml', () => {
    const p = join(TEST_CODINGCODE_DIR, 'mcp.yaml');
    writeFileSync(p, 'otherKey: value\nservers: []\n');
    writeMcpConfig(join(__dirname, '..', '..', '..'), [{ name: 'srv', command: 'echo' }]);
    const raw = JSON.parse(JSON.stringify(parseYaml(readFileSync(p, 'utf8'))));
    expect(raw.otherKey).toBe('value');
    expect(raw.servers).toHaveLength(1);
  });
});
