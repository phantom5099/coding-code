/**
 * 领域数据目录的路径片段常量。
 *
 * 本层只放类型与纯字面量常量，不引用任何包（含 node:path 与 core/path）。
 * 拼接由各领域模块自己完成：先用 `core/path` 的纯函数把入参 cwd 归一化，
 * 再用这里的常量拼出最终路径。
 */

/** `<~/.codingcode>/project` —— 所有工作区的数据根。 */
export const PROJECTS_DIRNAME = 'project';

/** 工作区数据根下存放会话转录的目录名。 */
export const SESSIONS_DIRNAME = 'sessions';

/** 子代理转录所在的子目录名（位于其父会话目录下）。 */
export const SUBAGENTS_DIRNAME = 'subagents';

/** 转录文件后缀。 */
export const TRANSCRIPT_SUFFIX = '.jsonl';
