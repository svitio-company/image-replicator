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
  private jsonFormat: boolean;

  constructor(debugEnabled = false, jsonFormat = false) {
    this.debugEnabled = debugEnabled;
    this.jsonFormat = jsonFormat;
  }

  /**
   * Enable or disable debug logging
   */
  setDebugEnabled(enabled: boolean): void {
    this.debugEnabled = enabled;
  }

  /**
   * Enable or disable JSON format
   */
  setJsonFormat(enabled: boolean): void {
    this.jsonFormat = enabled;
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
    
    if (this.jsonFormat) {
      const logEntry = {
        timestamp,
        level,
        message,
        ...context,
      };
      return JSON.stringify(logEntry);
    }
    
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
export function initLogger(debugEnabled: boolean, jsonFormat = false): void {
  logger.setDebugEnabled(debugEnabled);
  logger.setJsonFormat(jsonFormat);
}
