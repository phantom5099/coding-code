import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { parse as parseYaml } from 'yaml';
import {
  loadConfig,
  updateMaxSteps,
  updateMaxStopContinuations,
  updateContextCompactionModel,
  updateMemoryModel,
} from '../src/config.js';

const TMP_DIR = resolve(__dirname, '..', '..', '.tmp-test-config');

function tmpPath(): string {
  return resolve(TMP_DIR, 'config.yaml');
}

function cleanConfig(dir: string) {
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

function readConfigContent(path: string): Record<string, unknown> {
  return parseYaml(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('Config writer functions', () => {
  beforeEach(() => {
    cleanConfig(TMP_DIR);
  });

  afterEach(() => {
    rmSync(TMP_DIR, { recursive: true, force: true });
  });

  describe('updateMaxSteps', () => {
    it('writes maxSteps to config', () => {
      updateMaxSteps(500, tmpPath());
      const content = readConfigContent(tmpPath());
      expect(content.maxSteps).toBe(500);
    });

    it('preserves existing config fields', () => {
      writeFileSync(tmpPath(), 'maxStopContinuations: 5\n', 'utf8');
      updateMaxSteps(300, tmpPath());
      const content = readConfigContent(tmpPath());
      expect(content.maxSteps).toBe(300);
      expect(content.maxStopContinuations).toBe(5);
    });
  });

  describe('updateMaxStopContinuations', () => {
    it('writes maxStopContinuations to config', () => {
      updateMaxStopContinuations(10, tmpPath());
      const content = readConfigContent(tmpPath());
      expect(content.maxStopContinuations).toBe(10);
    });

    it('preserves existing config fields', () => {
      writeFileSync(tmpPath(), 'maxSteps: 100\n', 'utf8');
      updateMaxStopContinuations(7, tmpPath());
      const content = readConfigContent(tmpPath());
      expect(content.maxStopContinuations).toBe(7);
      expect(content.maxSteps).toBe(100);
    });
  });

  describe('updateContextCompactionModel', () => {
    it('writes context.compactionModel to config', () => {
      updateContextCompactionModel('gpt-4o-mini', tmpPath());
      const content = readConfigContent(tmpPath());
      expect((content.context as Record<string, unknown>).compactionModel).toBe('gpt-4o-mini');
    });

    it('preserves other context fields', () => {
      writeFileSync(tmpPath(), 'context:\n  compactionModel: old-model\n', 'utf8');
      updateContextCompactionModel('new-model', tmpPath());
      const content = readConfigContent(tmpPath());
      expect((content.context as Record<string, unknown>).compactionModel).toBe('new-model');
    });
  });

  describe('updateMemoryModel', () => {
    it('writes memory.model to config', () => {
      updateMemoryModel('deepseek-v4-flash', tmpPath());
      const content = readConfigContent(tmpPath());
      expect((content.memory as Record<string, unknown>).model).toBe('deepseek-v4-flash');
    });

    it('preserves other memory fields', () => {
      writeFileSync(tmpPath(), 'memory:\n  enabled: true\n  model: old\n', 'utf8');
      updateMemoryModel('new', tmpPath());
      const content = readConfigContent(tmpPath());
      expect((content.memory as Record<string, unknown>).enabled).toBe(true);
      expect((content.memory as Record<string, unknown>).model).toBe('new');
    });
  });

  describe('round-trip: write then load', () => {
    it('loadConfig returns written maxSteps', () => {
      updateMaxSteps(777, tmpPath());
      const cfg = loadConfig(tmpPath());
      expect(cfg.maxSteps).toBe(777);
    });

    it('loadConfig returns written memory.model', () => {
      updateMemoryModel('test-model', tmpPath());
      const cfg = loadConfig(tmpPath());
      expect(cfg.memory.model).toBe('test-model');
    });

    it('loadConfig returns written compactionModel', () => {
      updateContextCompactionModel('compactor', tmpPath());
      const cfg = loadConfig(tmpPath());
      expect(cfg.context.compactionModel).toBe('compactor');
    });
  });
});
