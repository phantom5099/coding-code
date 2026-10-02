/** 服务端错误信封是 `{ error: { code, message } }`，由 ApiError 在客户端承载。 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    public readonly body?: { code: string; message: string }
  ) {
    super(body?.message ?? `HTTP ${status}: ${path}`);
    this.name = 'ApiError';
  }
}
