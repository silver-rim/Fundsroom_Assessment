/**
 * Minimal structured logger.
 *
 * Exists so that no application code calls `console.log` directly: log level,
 * formatting and destination are decided in one place. In production the output
 * is single-line JSON, which is what Render's log viewer indexes well; in
 * development it stays human-readable.
 */
import { env } from '../config/env';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MINIMUM_LEVEL: LogLevel = env.isProduction ? 'info' : 'debug';

function write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[MINIMUM_LEVEL]) return;

  const timestamp = new Date().toISOString();

  if (env.isProduction) {
    process.stdout.write(`${JSON.stringify({ timestamp, level, message, ...meta })}\n`);
    return;
  }

  const suffix = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
  process.stdout.write(`${timestamp} ${level.toUpperCase().padEnd(5)} ${message}${suffix}\n`);
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => write('debug', message, meta),
  info: (message: string, meta?: Record<string, unknown>) => write('info', message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => write('warn', message, meta),
  error: (message: string, meta?: Record<string, unknown>) => write('error', message, meta),
};
