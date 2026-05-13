import pino from "pino";
import { config } from "./config";

let _logger: pino.Logger | null = null;

export function getLogger(): pino.Logger {
  if (!_logger) {
    _logger = pino({
      level: config.LOG_LEVEL,
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: false, ignore: "pid,hostname" },
      },
    });
  }
  return _logger;
}
