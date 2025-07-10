import { logger, tradingLogger } from "../config/logger";

export interface TradingError {
  code: string;
  message: string;
  type:
    | "user"
    | "system"
    | "network"
    | "validation"
    | "insufficient_funds"
    | "not_found";
  severity: "low" | "medium" | "high" | "critical";
  actionable: boolean;
  recommendedAction?: string;
  technicalDetails?: string;
  context?: Record<string, any>;
  timestamp: Date;
}

export interface ErrorContext {
  service: string;
  operation: string;
  userId?: string;
  safeAddress?: string;
  tokenSymbol?: string;
  networkKey?: string;
  tradeId?: string;
  [key: string]: any;
}

/**
 * Enhanced Error Handling Service
 *
 * This service provides:
 * 1. Categorized error types with clear explanations
 * 2. Actionable recommendations for users and developers
 * 3. Structured error logging with context
 * 4. User-friendly error messages
 * 5. Technical details for debugging
 */
export class ErrorHandlingService {
  private static instance: ErrorHandlingService;

  private errorMap: Record<string, Partial<TradingError>> = {
    // Token and Chain Errors
    TOKEN_NOT_FOUND: {
      type: "not_found",
      severity: "high",
      actionable: true,
      message: "Token not found on any supported networks",
      recommendedAction:
        "Verify the token symbol is correct. Check if the token is available on supported networks: Ethereum, Arbitrum, Polygon, Base, Optimism",
    },
    TOKEN_CHAIN_MISMATCH: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Token is not available on the current network",
      recommendedAction:
        "Deploy a Safe on the correct network for this token, or choose a different token available on your current network",
    },
    UNSUPPORTED_NETWORK: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Network is not supported by the trading system",
      recommendedAction:
        "Use one of the supported networks: Ethereum, Arbitrum, Polygon, Base, or Optimism",
    },

    // Safe Wallet Errors
    SAFE_NOT_DEPLOYED: {
      type: "not_found",
      severity: "high",
      actionable: true,
      message: "Safe wallet is not deployed on the required network",
      recommendedAction:
        "Deploy a Safe wallet on the target network using the deploySafeForTrading function",
    },
    SAFE_NOT_FOUND: {
      type: "not_found",
      severity: "high",
      actionable: true,
      message: "Safe wallet not found for user",
      recommendedAction:
        "Create a Safe wallet first using the deploySafeForTrading function",
    },
    SAFE_INSUFFICIENT_BALANCE: {
      type: "insufficient_funds",
      severity: "high",
      actionable: true,
      message: "Safe wallet has insufficient balance for trading",
      recommendedAction:
        "Deposit funds into your Safe wallet. Ensure you have both the trading token and native tokens for gas fees",
    },
    SAFE_INVALID_CONFIGURATION: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Safe wallet configuration is invalid",
      recommendedAction:
        "Check Safe wallet owners and threshold settings. Ensure the AI agent is configured as an owner",
    },

    // Trading and Position Errors
    INSUFFICIENT_USDC_BALANCE: {
      type: "insufficient_funds",
      severity: "high",
      actionable: true,
      message: "Insufficient USDC balance for trading",
      recommendedAction:
        "Deposit USDC into your Safe wallet on the target network. Minimum recommended balance: $50 USDC",
    },
    POSITION_SIZE_TOO_SMALL: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Position size is below minimum requirements",
      recommendedAction:
        "Increase your position size or deposit more funds. Minimum position size: $0.01 USD",
    },
    POSITION_SIZE_TOO_LARGE: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Position size exceeds maximum allowed percentage",
      recommendedAction:
        "Reduce position size to maximum 80% of available balance for risk management",
    },
    INVALID_POSITION_PERCENTAGE: {
      type: "validation",
      severity: "low",
      actionable: true,
      message: "Invalid position sizing percentage",
      recommendedAction:
        "Use a percentage between 1% and 80%. Recommended: 20% for balanced risk",
    },

    // DEX and Swap Errors
    SWAP_QUOTE_FAILED: {
      type: "network",
      severity: "medium",
      actionable: true,
      message: "Failed to get swap quote from DEX",
      recommendedAction:
        "Try again in a few moments. If the issue persists, check if the token pair is supported on the DEX",
    },
    SWAP_EXECUTION_FAILED: {
      type: "system",
      severity: "high",
      actionable: true,
      message: "Swap execution failed",
      recommendedAction:
        "Check transaction on block explorer. Ensure sufficient gas fees and token balances. Try with a lower slippage tolerance",
    },
    INSUFFICIENT_LIQUIDITY: {
      type: "network",
      severity: "medium",
      actionable: true,
      message: "Insufficient liquidity for the requested swap",
      recommendedAction:
        "Try a smaller trade size or different token pair. Consider trading during higher volume periods",
    },
    SLIPPAGE_TOO_HIGH: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Price slippage is too high for safe trading",
      recommendedAction:
        "Reduce trade size or increase slippage tolerance (with caution). Consider trading during less volatile periods",
    },

    // Network and Connection Errors
    RPC_CONNECTION_FAILED: {
      type: "network",
      severity: "medium",
      actionable: false,
      message: "Failed to connect to blockchain network",
      recommendedAction:
        "Network connectivity issue. Please try again in a few moments",
    },
    NETWORK_CONGESTION: {
      type: "network",
      severity: "low",
      actionable: true,
      message: "Network is congested, transactions may be slow",
      recommendedAction:
        "Consider increasing gas fees for faster processing or try again during off-peak hours",
    },
    TRANSACTION_TIMEOUT: {
      type: "network",
      severity: "medium",
      actionable: true,
      message: "Transaction timed out",
      recommendedAction:
        "Check transaction status on block explorer. If not found, try again with higher gas fees",
    },

    // API and External Service Errors
    PRICE_DATA_UNAVAILABLE: {
      type: "network",
      severity: "medium",
      actionable: false,
      message: "Price data is temporarily unavailable",
      recommendedAction:
        "Price feeds are temporarily unavailable. Please try again in a few minutes",
    },
    API_RATE_LIMITED: {
      type: "system",
      severity: "low",
      actionable: false,
      message: "API rate limit exceeded",
      recommendedAction:
        "Too many requests. Please wait a moment before trying again",
    },

    // Signal Processing Errors
    INVALID_SIGNAL_FORMAT: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Signal format is invalid",
      recommendedAction:
        "Ensure signal contains all required fields: Signal Message, Token Mentioned, TP1, TP2, SL, Current Price, Max Exit Time, username, safeAddress",
    },
    SIGNAL_EXPIRED: {
      type: "validation",
      severity: "low",
      actionable: false,
      message: "Signal has expired",
      recommendedAction:
        "Signal exceeded maximum exit time. No action taken for safety",
    },
    INVALID_PRICE_LEVELS: {
      type: "validation",
      severity: "medium",
      actionable: true,
      message: "Invalid take profit or stop loss levels",
      recommendedAction:
        "For buy signals: TP1 > Current Price > SL. For sell signals: SL > Current Price > TP1",
    },

    // System Errors
    DATABASE_CONNECTION_FAILED: {
      type: "system",
      severity: "critical",
      actionable: false,
      message: "Database connection failed",
      recommendedAction: "System maintenance required. Please contact support",
    },
    CONFIGURATION_ERROR: {
      type: "system",
      severity: "high",
      actionable: false,
      message: "System configuration error",
      recommendedAction: "Configuration issue detected. Please contact support",
    },
    UNKNOWN_ERROR: {
      type: "system",
      severity: "medium",
      actionable: false,
      message: "An unexpected error occurred",
      recommendedAction:
        "Please try again. If the issue persists, contact support with the error details",
    },
  };

  private constructor() {}

  public static getInstance(): ErrorHandlingService {
    if (!ErrorHandlingService.instance) {
      ErrorHandlingService.instance = new ErrorHandlingService();
    }
    return ErrorHandlingService.instance;
  }

  /**
   * Create a structured trading error
   */
  createError(
    code: string,
    context: ErrorContext,
    originalError?: Error,
    customMessage?: string
  ): TradingError {
    const errorTemplate = this.errorMap[code] || this.errorMap["UNKNOWN_ERROR"];

    const tradingError: TradingError = {
      code,
      message:
        customMessage || errorTemplate.message || "Unknown error occurred",
      type: errorTemplate.type || "system",
      severity: errorTemplate.severity || "medium",
      actionable: errorTemplate.actionable || false,
      recommendedAction: errorTemplate.recommendedAction,
      technicalDetails: originalError?.message || originalError?.stack,
      context,
      timestamp: new Date(),
    };

    // Log the error with appropriate level
    this.logError(tradingError, originalError);

    return tradingError;
  }

  /**
   * Handle and format error for user display
   */
  handleError(
    code: string,
    context: ErrorContext,
    originalError?: Error,
    customMessage?: string
  ): { userMessage: string; technicalMessage: string; error: TradingError } {
    const tradingError = this.createError(
      code,
      context,
      originalError,
      customMessage
    );

    const userMessage = this.formatUserMessage(tradingError);
    const technicalMessage = this.formatTechnicalMessage(tradingError);

    return {
      userMessage,
      technicalMessage,
      error: tradingError,
    };
  }

  /**
   * Format error message for end users
   */
  private formatUserMessage(error: TradingError): string {
    let message = `❌ ${error.message}`;

    if (error.actionable && error.recommendedAction) {
      message += `\n\n💡 Recommendation: ${error.recommendedAction}`;
    }

    // Add context information relevant to users
    if (error.context) {
      const userContext = [];
      if (error.context.tokenSymbol)
        userContext.push(`Token: ${error.context.tokenSymbol}`);
      if (error.context.networkKey)
        userContext.push(`Network: ${error.context.networkKey}`);
      if (error.context.safeAddress)
        userContext.push(
          `Safe: ${error.context.safeAddress.slice(0, 6)}...${error.context.safeAddress.slice(-4)}`
        );

      if (userContext.length > 0) {
        message += `\n\n📍 Context: ${userContext.join(" | ")}`;
      }
    }

    return message;
  }

  /**
   * Format technical message for developers/debugging
   */
  private formatTechnicalMessage(error: TradingError): string {
    let message = `[${error.code}] ${error.message}`;

    if (error.technicalDetails) {
      message += `\nTechnical Details: ${error.technicalDetails}`;
    }

    if (error.context) {
      message += `\nContext: ${JSON.stringify(error.context, null, 2)}`;
    }

    return message;
  }

  /**
   * Log error with appropriate level and context
   */
  private logError(error: TradingError, originalError?: Error): void {
    const logData = {
      errorCode: error.code,
      errorType: error.type,
      severity: error.severity,
      service: error.context.service || "unknown",
      context: error.context,
      originalError: originalError
        ? {
            message: originalError.message,
            stack: originalError.stack,
            name: originalError.name,
          }
        : undefined,
    };

    switch (error.severity) {
      case "critical":
        tradingLogger.error(
          `🚨 CRITICAL: ${error.message}`,
          originalError,
          logData
        );
        break;
      case "high":
        tradingLogger.error(
          `🔴 HIGH: ${error.message}`,
          originalError,
          logData
        );
        break;
      case "medium":
        tradingLogger.warning(
          `🟡 MEDIUM: ${error.message}`,
          error.recommendedAction,
          logData
        );
        break;
      case "low":
        logger.warn(`🟢 LOW: ${error.message}`, logData);
        break;
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryable(errorCode: string): boolean {
    const retryableErrors = [
      "RPC_CONNECTION_FAILED",
      "NETWORK_CONGESTION",
      "TRANSACTION_TIMEOUT",
      "SWAP_QUOTE_FAILED",
      "PRICE_DATA_UNAVAILABLE",
      "API_RATE_LIMITED",
    ];

    return retryableErrors.includes(errorCode);
  }

  /**
   * Get error statistics for monitoring
   */
  getErrorSeverityLevel(
    errorCode: string
  ): "low" | "medium" | "high" | "critical" {
    return this.errorMap[errorCode]?.severity || "medium";
  }

  /**
   * Validate error context completeness
   */
  validateContext(context: ErrorContext): boolean {
    return !!(context.service && context.operation);
  }

  /**
   * Create error from validation result
   */
  fromValidationResult(
    validationResult: any,
    context: ErrorContext
  ): TradingError {
    if (!validationResult.success) {
      return this.createError(
        "VALIDATION_FAILED",
        context,
        undefined,
        validationResult.error || "Validation failed"
      );
    }

    return this.createError("UNKNOWN_ERROR", context);
  }

  /**
   * Add custom error mapping
   */
  addErrorMapping(code: string, errorTemplate: Partial<TradingError>): void {
    this.errorMap[code] = errorTemplate;
  }

  /**
   * Get all error codes for debugging
   */
  getAllErrorCodes(): string[] {
    return Object.keys(this.errorMap);
  }
}

// Export singleton instance
export const errorHandler = ErrorHandlingService.getInstance();
export default errorHandler;
