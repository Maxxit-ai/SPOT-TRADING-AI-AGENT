import winston from "winston";
import path from "path";

/**
 * Simplified Trading Agent Logger
 *
 * Features:
 * - Clean console output with emojis and colors
 * - Single error.log file for critical errors only
 * - No separate service loggers (unified approach)
 * - Clear, readable format for development and production
 * - Structured data for debugging when needed
 */

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ level, message, timestamp, service, ...meta }) => {
    // Emoji mapping for different log levels
    const emojiMap: Record<string, string> = {
      error: "❌",
      warn: "⚠️",
      info: "ℹ️",
      debug: "🔍",
      verbose: "📝",
    };

    // Color mapping for levels
    const colorMap: Record<string, string> = {
      error: "\x1b[31m", // Red
      warn: "\x1b[33m", // Yellow
      info: "\x1b[36m", // Cyan
      debug: "\x1b[35m", // Magenta
      verbose: "\x1b[37m", // White
    };

    const emoji = emojiMap[level] || "📝";
    const color = colorMap[level] || "\x1b[0m";
    const reset = "\x1b[0m";

    // Service prefix if provided
    const servicePrefix = service ? `[${service}] ` : "";

    // Format the main message
    let formattedMessage = `${color}${emoji} ${timestamp} ${servicePrefix}${message}${reset}`;

    // Add metadata if present (for debugging)
    if (Object.keys(meta).length > 0) {
      const metaString = Object.entries(meta)
        .filter(([key, value]) => key !== "timestamp" && value !== undefined)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ");

      if (metaString) {
        formattedMessage += `\n  ${color}└─ ${metaString}${reset}`;
      }
    }

    return formattedMessage;
  })
);

// File format for error logs only
const fileFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create the main logger
export const logger = winston.createLogger({
  level: process.env["LOG_LEVEL"] || "info",
  defaultMeta: { service: "trading-agent" },
  transports: [
    // Console transport with beautiful formatting
    new winston.transports.Console({
      format: consoleFormat,
      level: process.env["LOG_LEVEL"] || "info",
    }),

    // File transport for errors only
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 3,
      // Create logs directory if it doesn't exist
      options: { flags: "a" },
    }),
  ],

  // Handle uncaught exceptions
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(process.cwd(), "logs", "exceptions.log"),
      format: fileFormat,
    }),
  ],

  // Don't exit on handled exceptions
  exitOnError: false,
});

/**
 * Trading-specific logger methods for common operations
 */
export const tradingLogger = {
  /**
   * Log signal processing events
   */
  signal: (message: string, signalData?: any) => {
    logger.info(`📡 ${message}`, {
      service: "signal-processor",
      signalId: signalData?.signalId,
      token: signalData?.tokenMentioned || signalData?.token,
      user: signalData?.username || signalData?.user,
    });
  },

  /**
   * Log trade execution events
   */
  trade: (message: string, tradeData?: any) => {
    logger.info(`💱 ${message}`, {
      service: "trade-execution",
      tradeId: tradeData?.tradeId,
      token: tradeData?.tokenMentioned || tradeData?.token,
      amount: tradeData?.amount,
      network: tradeData?.networkKey,
    });
  },

  /**
   * Log Safe operations
   */
  safe: (message: string, safeData?: any) => {
    logger.info(`🔐 ${message}`, {
      service: "safe-operations",
      safeAddress: safeData?.safeAddress,
      network: safeData?.networkKey || safeData?.network,
      chainId: safeData?.chainId,
    });
  },

  /**
   * Log price and market events
   */
  market: (message: string, marketData?: any) => {
    logger.info(`📊 ${message}`, {
      service: "market-data",
      token: marketData?.token || marketData?.symbol,
      price: marketData?.price,
      change: marketData?.change,
    });
  },

  /**
   * Log validation events
   */
  validation: (message: string, validationData?: any) => {
    logger.info(`✅ ${message}`, {
      service: "validation",
      type: validationData?.type,
      result: validationData?.result,
      entity: validationData?.entity,
    });
  },

  /**
   * Log error events with context
   */
  error: (message: string, error?: Error | any, context?: any) => {
    logger.error(`💥 ${message}`, {
      service: context?.service || "unknown",
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
              name: error.name,
            }
          : error,
      context,
    });
  },

  /**
   * Log successful operations
   */
  success: (message: string, data?: any) => {
    logger.info(`🎉 ${message}`, {
      service: data?.service || "general",
      ...data,
    });
  },

  /**
   * Log warnings with recommendations
   */
  warning: (message: string, recommendation?: string, data?: any) => {
    logger.warn(
      `⚠️  ${message}${recommendation ? ` | 💡 ${recommendation}` : ""}`,
      {
        service: data?.service || "general",
        recommendation,
        ...data,
      }
    );
  },
};

/**
 * Create service-specific logger (simplified approach)
 */
export const createServiceLogger = (serviceName: string) => {
  return {
    info: (message: string, meta?: any) =>
      logger.info(message, { service: serviceName, ...meta }),
    error: (message: string, meta?: any) =>
      logger.error(message, { service: serviceName, ...meta }),
    warn: (message: string, meta?: any) =>
      logger.warn(message, { service: serviceName, ...meta }),
    debug: (message: string, meta?: any) =>
      logger.debug(message, { service: serviceName, ...meta }),
  };
};

/**
 * Initialize logger with directory creation
 */
export const initializeLogger = async () => {
  try {
    const fs = await import("fs");
    const logsDir = path.join(process.cwd(), "logs");

    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }

    logger.info("🚀 Trading Agent Logger initialized");
    return true;
  } catch (error) {
    console.error("Failed to initialize logger:", error);
    return false;
  }
};

/**
 * Get current log level
 */
export const getLogLevel = (): string => {
  return logger.level;
};

/**
 * Set log level dynamically
 */
export const setLogLevel = (level: string): void => {
  logger.level = level;
  logger.info(`📝 Log level set to: ${level}`);
};

/**
 * Trading flow logger for step-by-step tracking
 */
export const flowLogger = {
  start: (flowName: string, data?: any) => {
    logger.info(`🚀 Starting ${flowName}`, {
      service: "flow-tracker",
      flow: flowName,
      step: "start",
      ...data,
    });
  },

  step: (flowName: string, stepName: string, data?: any) => {
    logger.info(`⏭️  ${flowName} → ${stepName}`, {
      service: "flow-tracker",
      flow: flowName,
      step: stepName,
      ...data,
    });
  },

  complete: (flowName: string, result?: any) => {
    logger.info(`✅ Completed ${flowName}`, {
      service: "flow-tracker",
      flow: flowName,
      step: "complete",
      result,
    });
  },

  fail: (flowName: string, error: any, step?: string) => {
    logger.error(`❌ Failed ${flowName}${step ? ` at ${step}` : ""}`, {
      service: "flow-tracker",
      flow: flowName,
      step: step || "unknown",
      error:
        error instanceof Error
          ? {
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
  },
};

// Initialize logger on import
initializeLogger();

export default logger;
