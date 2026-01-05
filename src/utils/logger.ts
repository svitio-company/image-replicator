/**
 * Standardized logging utility with consistent formatting and levels
 */

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

interface LogContext {
  [key: string]: string | number | boolean | undefined;
}

class Logger {
  private debugEnabled: boolean;

  constructor(debugEnabled = false) {
    this.debugEnabled = debugEnabled;
  }

  /**
   * Enable or disable debug logging
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Format log message with timestamp, level, and context
   */
  private formatMessage(
    level: LogLevel,
    message: string,
    context?: LogContext
  ): string {
    const timestamp = new Date().toISOString();
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    return `[${timestamp}] ${level} ${message}${contextStr}`;
  }

  /**
   * Log debug message (only if debug is enabled)
   */
  debug(message: string, context?: LogContext): void {
    if (this.debugEnabled) {
      console.debug(this.formatMessage(LogLevel.DEBUG, message, context));
    }
  }

  /**
   * Log info message
   */
  info(message: string, context?: LogContext): void {
    console.log(this.formatMessage(LogLevel.INFO, message, context));
  }

  /**
   * Log warning message
   */
  warn(message: string, context?: LogContext): void {
    console.warn(this.formatMessage(LogLevel.WARN, message, context));
  }

  /**
   * Log error message
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    const errorContext = {
      ...context,
      ...(error instanceof Error
        ? { error: error.message, stack: error.stack }
        : { error: String(error) }),
    };
    console.error(this.formatMessage(LogLevel.ERROR, message, errorContext));
  }
}

// Global logger instance
export const logger = new Logger();

/**
 * Initialize logger with configuration
 */
export function initLogger(debugEnabled: boolean): void {
  logger.setDebugEnabled(debugEnabled);
}
