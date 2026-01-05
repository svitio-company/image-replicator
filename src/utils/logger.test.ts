import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { logger, initLogger, LogLevel } from "./logger";

describe("Logger", () => {
  let consoleSpy: {
    log: ReturnType<typeof spyOn>;
    debug: ReturnType<typeof spyOn>;
    warn: ReturnType<typeof spyOn>;
    error: ReturnType<typeof spyOn>;
  };

  beforeEach(() => {
    // Spy on console methods
    consoleSpy = {
      log: spyOn(console, "log").mockImplementation(() => {}),
      debug: spyOn(console, "debug").mockImplementation(() => {}),
      warn: spyOn(console, "warn").mockImplementation(() => {}),
      error: spyOn(console, "error").mockImplementation(() => {}),
    };
    
    // Reset logger to default state
    logger.setDebugEnabled(false);
    logger.setJsonFormat(false);
  });

  afterEach(() => {
    // Restore console methods
    consoleSpy.log.mockRestore();
    consoleSpy.debug.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  describe("Plain text logging", () => {
    test("should log info message in plain text format", () => {
      logger.info("Test message");
      
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      
      expect(loggedMessage).toContain("INFO");
      expect(loggedMessage).toContain("Test message");
      expect(loggedMessage).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    test("should log info message with context in plain text format", () => {
      logger.info("Test message", { userId: "123", action: "login" });
      
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      
      expect(loggedMessage).toContain("INFO");
      expect(loggedMessage).toContain("Test message");
      expect(loggedMessage).toContain('"userId":"123"');
      expect(loggedMessage).toContain('"action":"login"');
    });

    test("should log warn message in plain text format", () => {
      logger.warn("Warning message");
      
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.warn.mock.calls[0][0];
      
      expect(loggedMessage).toContain("WARN");
      expect(loggedMessage).toContain("Warning message");
    });

    test("should log error message in plain text format", () => {
      const error = new Error("Something went wrong");
      logger.error("Error occurred", error);
      
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      
      expect(loggedMessage).toContain("ERROR");
      expect(loggedMessage).toContain("Error occurred");
      expect(loggedMessage).toContain("Something went wrong");
    });

    test("should not log debug message when debug is disabled", () => {
      logger.debug("Debug message");
      
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    test("should log debug message when debug is enabled", () => {
      logger.setDebugEnabled(true);
      logger.debug("Debug message");
      
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.debug.mock.calls[0][0];
      
      expect(loggedMessage).toContain("DEBUG");
      expect(loggedMessage).toContain("Debug message");
    });
  });

  describe("JSON logging", () => {
    beforeEach(() => {
      logger.setJsonFormat(true);
    });

    test("should log info message in JSON format", () => {
      logger.info("Test message");
      
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed).toHaveProperty("timestamp");
      expect(parsed.level).toBe("INFO");
      expect(parsed.message).toBe("Test message");
      expect(parsed.timestamp).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
    });

    test("should log info message with context in JSON format", () => {
      logger.info("Test message", { userId: "123", action: "login", count: 5 });
      
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("INFO");
      expect(parsed.message).toBe("Test message");
      expect(parsed.userId).toBe("123");
      expect(parsed.action).toBe("login");
      expect(parsed.count).toBe(5);
    });

    test("should log warn message in JSON format", () => {
      logger.warn("Warning message", { code: 123 });
      
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.warn.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("WARN");
      expect(parsed.message).toBe("Warning message");
      expect(parsed.code).toBe(123);
    });

    test("should log error message with Error object in JSON format", () => {
      const error = new Error("Something went wrong");
      logger.error("Error occurred", error);
      
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("ERROR");
      expect(parsed.message).toBe("Error occurred");
      expect(parsed.error).toBe("Something went wrong");
      expect(parsed.stack).toBeDefined();
      expect(typeof parsed.stack).toBe("string");
    });

    test("should log error message with string error in JSON format", () => {
      logger.error("Error occurred", "Simple error string");
      
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("ERROR");
      expect(parsed.message).toBe("Error occurred");
      expect(parsed.error).toBe("Simple error string");
    });

    test("should log error with context in JSON format", () => {
      const error = new Error("Test error");
      logger.error("Error occurred", error, { requestId: "req-123", userId: "user-456" });
      
      const loggedMessage = consoleSpy.error.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("ERROR");
      expect(parsed.message).toBe("Error occurred");
      expect(parsed.error).toBe("Test error");
      expect(parsed.requestId).toBe("req-123");
      expect(parsed.userId).toBe("user-456");
      expect(parsed.stack).toBeDefined();
    });

    test("should log debug message in JSON format when enabled", () => {
      logger.setDebugEnabled(true);
      logger.debug("Debug message", { debugInfo: "test" });
      
      expect(consoleSpy.debug).toHaveBeenCalledTimes(1);
      const loggedMessage = consoleSpy.debug.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("DEBUG");
      expect(parsed.message).toBe("Debug message");
      expect(parsed.debugInfo).toBe("test");
    });

    test("should not log debug message in JSON format when disabled", () => {
      logger.setDebugEnabled(false);
      logger.debug("Debug message");
      
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    test("should handle boolean context values in JSON format", () => {
      logger.info("Test message", { isActive: true, isDeleted: false });
      
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.isActive).toBe(true);
      expect(parsed.isDeleted).toBe(false);
    });

    test("should handle undefined context values in JSON format", () => {
      logger.info("Test message", { definedValue: "test", undefinedValue: undefined });
      
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.definedValue).toBe("test");
      expect(parsed.undefinedValue).toBeUndefined();
    });
  });

  describe("initLogger", () => {
    test("should initialize logger with debug enabled", () => {
      initLogger(true);
      logger.debug("Test debug");
      
      expect(consoleSpy.debug).toHaveBeenCalled();
    });

    test("should initialize logger with JSON format", () => {
      initLogger(false, true);
      logger.info("Test message");
      
      const loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("INFO");
      expect(parsed.message).toBe("Test message");
    });

    test("should initialize logger with both debug and JSON format", () => {
      initLogger(true, true);
      logger.debug("Test debug");
      
      expect(consoleSpy.debug).toHaveBeenCalled();
      const loggedMessage = consoleSpy.debug.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      
      expect(parsed.level).toBe("DEBUG");
      expect(parsed.message).toBe("Test debug");
    });
  });

  describe("Format switching", () => {
    test("should switch from plain text to JSON format", () => {
      logger.info("Plain text message");
      let loggedMessage = consoleSpy.log.mock.calls[0][0];
      expect(loggedMessage).toContain("INFO");
      expect(() => JSON.parse(loggedMessage)).toThrow();
      
      logger.setJsonFormat(true);
      logger.info("JSON message");
      loggedMessage = consoleSpy.log.mock.calls[1][0];
      const parsed = JSON.parse(loggedMessage);
      expect(parsed.message).toBe("JSON message");
    });

    test("should switch from JSON to plain text format", () => {
      logger.setJsonFormat(true);
      logger.info("JSON message");
      let loggedMessage = consoleSpy.log.mock.calls[0][0];
      const parsed = JSON.parse(loggedMessage);
      expect(parsed.message).toBe("JSON message");
      
      logger.setJsonFormat(false);
      logger.info("Plain text message");
      loggedMessage = consoleSpy.log.mock.calls[1][0];
      expect(loggedMessage).toContain("INFO");
      expect(loggedMessage).toContain("Plain text message");
    });
  });
});
