import { Layer } from 'effect';
import { ToolCatalogPort } from './deps.js';
import type { ToolCatalog } from './deps.js';
import { createToolCatalog } from '../tools/catalog.js';

/**
 * ToolCatalogPort 的实现（组合根一侧）。
 *
 * agent 只 import ToolCatalogPort 并传入名字名单，这里才是唯一接触具体工具装配的地方。
 * register 委托工具模块的 createToolCatalog：按名单从全量静态表查表注册，并合并 MCP 工具，
 * 回传成品（tools 描述列表 + lookup 查找闭包）——agent 拿到后直接消费，不再 describe/get。
 */
export const ToolCatalogLayer: Layer.Layer<ToolCatalogPort, never, never> = Layer.succeed(
  ToolCatalogPort,
  {
    register: (toolNames, mcpTools): ToolCatalog => createToolCatalog(toolNames, mcpTools),
  }
);
