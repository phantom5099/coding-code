import { Layer } from 'effect';
import { ToolCatalogPort } from './deps.js';
import type { ToolCatalog } from './deps.js';
import { createToolCatalog } from '../tools/catalog.js';

export const ToolCatalogLayer: Layer.Layer<ToolCatalogPort, never, never> = Layer.succeed(
  ToolCatalogPort,
  {
    register: (toolNames, mcpTools): ToolCatalog => createToolCatalog(toolNames, mcpTools),
  }
);
