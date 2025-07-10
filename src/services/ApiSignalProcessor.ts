import { EventEmitter } from "events";
import winston from "winston";
import { v4 as uuidv4 } from "uuid";
import TradeStateManager from "./TradeStateManager";
import TradeExecutionService from "./TradeExecutionService";
import PriceMonitoringService from "./PriceMonitoringService";
import DatabaseService from "./DatabaseService";
import { NetworkUtils } from "../utils/NetworkUtils";
import TokenChainDetectionService from "./TokenChainDetectionService";
import SafeChainValidationService from "./SafeChainValidationService";
import PositionSizingService from "./PositionSizingService";
import { errorHandler } from "./ErrorHandlingService";
import { logger, tradingLogger, flowLogger } from "../config/logger";

/**
 * API Signal Object Interface
 * This matches the new signal format provided by the user
 */
interface ApiSignal {
  "Signal Message": "buy" | "sell";
  "Token Mentioned": string;
  TP1: number;
  TP2: number;
  SL: number;
  "Current Price": number;
  "Max Exit Time": { $date: string };
  username: string;
  safeAddress: string;
}

interface ProcessedSignal {
  signalId: string;
  tradingPair: ProcessedTradingPair;
  status: "success" | "failed" | "pending";
  error?: string;
}

interface ProcessedTradingPair {
  userId: string;
  tradeId: string;
  safeAddress: string;
  networkKey: string;
  status: "success" | "failed" | "pending";
  error?: string;
}

interface TradingConfig {
  positionSizeUsd: number;
  maxDailyTrades: number;
  enableTrailingStop: boolean;
  trailingStopRetracement: number;
  defaultSlippage: number;
  gasBuffer: number;
}

/**
 * ApiSignalProcessor - Handles API-based signal processing
 *
 * This service replaces the database polling approach with direct API signal processing.
 * It processes signals received through API calls instead of monitoring database changes.
 */
class ApiSignalProcessor extends EventEmitter {
  private logger: winston.Logger;
  private dbService: DatabaseService;
  private tradeStateManager: TradeStateManager;
  private tradeExecutionService: TradeExecutionService;
  private priceMonitoringService: PriceMonitoringService;
  private tokenChainService: TokenChainDetectionService;
  private safeValidationService: SafeChainValidationService;
  private positionSizingService: PositionSizingService;
  private config: TradingConfig;
  private processingQueue: Set<string> = new Set();
  private isActive: boolean = false;

  constructor(
    dbService: DatabaseService,
    tradeStateManager: TradeStateManager,
    tradeExecutionService: TradeExecutionService,
    priceMonitoringService: PriceMonitoringService,
    config: TradingConfig
  ) {
    super();

    this.dbService = dbService;
    this.tradeStateManager = tradeStateManager;
    this.tradeExecutionService = tradeExecutionService;
    this.priceMonitoringService = priceMonitoringService;
    this.config = config;

    // Initialize enhanced services
    this.tokenChainService = new TokenChainDetectionService();
    this.safeValidationService = new SafeChainValidationService();
    this.positionSizingService = new PositionSizingService({
      defaultPercentage: 20, // Use 20% of balance as requested
      minimumUsdAmount: 0.01,
      minimumGasReserve: "0.001",
      maxPositionPercentage: 80,
    });

    // Use simplified logger
    this.logger = logger;

    this.setupEventHandlers();

    tradingLogger.success(
      "ApiSignalProcessor initialized with enhanced validation services",
      {
        service: "api-signal-processor",
      }
    );
  }

  private setupEventHandlers(): void {
    // Handle trade exit events from price monitoring
    this.priceMonitoringService.on("tradeExit", async (exitData) => {
      await this.handleTradeExit(exitData);
    });

    // Handle trade execution queue
    setInterval(() => {
      this.processExecutionQueue();
    }, 5000);
  }

  async start(): Promise<void> {
    if (this.isActive) {
      this.logger.warn("API signal processor already running");
      return;
    }

    try {
      // Start price monitoring service
      await this.priceMonitoringService.start();

      this.isActive = true;
      this.logger.info("🚀 API Signal Processor started successfully");
      this.emit("started");
    } catch (error) {
      this.logger.error("Failed to start API signal processor:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isActive) {
      return;
    }

    try {
      this.priceMonitoringService.stop();
      this.isActive = false;

      this.logger.info("⏹️ API Signal Processor stopped");
      this.emit("stopped");
    } catch (error) {
      this.logger.error("Error stopping API signal processor:", error);
    }
  }

  /**
   * Process a signal received via API
   * This is the main entry point for processing signals with enhanced validation
   */
  async processApiSignal(signalData: ApiSignal): Promise<ProcessedSignal> {
    const signalId = uuidv4();
    const flowName = `Signal-${signalId.slice(0, 8)}`;

    // Prevent duplicate processing
    if (this.processingQueue.has(signalId)) {
      const error = errorHandler.createError("SIGNAL_ALREADY_PROCESSING", {
        service: "api-signal-processor",
        operation: "processApiSignal",
        userId: signalData.username,
        signalId,
      });
      throw new Error(error.message);
    }

    this.processingQueue.add(signalId);

    try {
      flowLogger.start(flowName, {
        signalId,
        token: signalData["Token Mentioned"],
        user: signalData.username,
        safeAddress: signalData.safeAddress,
      });

      tradingLogger.signal(
        `New signal received for ${signalData["Token Mentioned"]}`,
        {
          signalId,
          tokenMentioned: signalData["Token Mentioned"],
          username: signalData.username,
          safeAddress: signalData.safeAddress,
          signalMessage: signalData["Signal Message"],
        }
      );

      // Enhanced validation and processing
      const result = await this.processSignalEnhanced(
        signalId,
        signalData,
        flowName
      );

      this.emit("signalProcessed", result);
      flowLogger.complete(flowName, { status: result.status });

      return result;
    } catch (error) {
      flowLogger.fail(flowName, error, "signal-processing");

      const tradingError = errorHandler.createError(
        "SIGNAL_PROCESSING_FAILED",
        {
          service: "api-signal-processor",
          operation: "processApiSignal",
          userId: signalData.username,
          tokenSymbol: signalData["Token Mentioned"],
          safeAddress: signalData.safeAddress,
          signalId,
        },
        error instanceof Error ? error : undefined
      );

      const errorResult: ProcessedSignal = {
        signalId,
        tradingPair: {
          userId: signalData.username,
          tradeId: signalId,
          safeAddress: signalData.safeAddress,
          networkKey: "unknown",
          status: "failed",
          error: tradingError.message,
        },
        status: "failed",
        error: tradingError.message,
      };

      this.emit("signalError", errorResult);
      return errorResult;
    } finally {
      this.processingQueue.delete(signalId);
    }
  }

  /**
   * Enhanced signal processing with comprehensive validation
   */
  private async processSignalEnhanced(
    signalId: string,
    signalData: ApiSignal,
    flowName: string
  ): Promise<ProcessedSignal> {
    try {
      // Step 1: Validate signal data format
      flowLogger.step(flowName, "Validating Signal Format");
      this.validateSignalData(signalData);

      // Step 2: Detect token chain
      flowLogger.step(flowName, "Detecting Token Chain");
      const tokenDetection = await this.tokenChainService.detectTokenChains(
        signalData["Token Mentioned"]
      );

      if (!tokenDetection.success || !tokenDetection.primaryChain) {
        throw errorHandler.createError("TOKEN_NOT_FOUND", {
          service: "api-signal-processor",
          operation: "processSignalEnhanced",
          userId: signalData.username,
          tokenSymbol: signalData["Token Mentioned"],
        });
      }

      tradingLogger.validation(
        `Token ${signalData["Token Mentioned"]} found on ${tokenDetection.primaryChain.networkKey}`,
        {
          type: "token-chain-detection",
          result: "success",
          entity: signalData["Token Mentioned"],
        }
      );

      // Step 3: Get user's Safe deployments from database
      flowLogger.step(flowName, "Getting User Safe Deployments");
      const userSafe = await this.dbService.getUserSafe(
        signalData.username,
        signalData.safeAddress
      );
      const userSafeDeployments = userSafe
        ? await this.dbService.getActiveDeployments(userSafe)
        : [];

      tradingLogger.validation(
        `Found ${userSafeDeployments.length} Safe deployments for user ${signalData.username}`,
        {
          type: "user-safe-deployments",
          result: "success",
          entity: signalData.username,
          deploymentCount: userSafeDeployments.length,
          networks: userSafeDeployments.map((d) => d.networkKey).join(", "),
        }
      );

      // Step 4: Validate Safe deployment and compatibility with user's actual deployments
      flowLogger.step(flowName, "Validating Safe Deployment");
      const safeCompatibility =
        await this.safeValidationService.validateSafeForToken(
          signalData.safeAddress,
          signalData["Token Mentioned"],
          [userSafe] // Pass the full user Safe document which contains deployments
        );

      if (!safeCompatibility.hasCompatibleSafe) {
        throw errorHandler.createError("SAFE_NOT_DEPLOYED", {
          service: "api-signal-processor",
          operation: "processSignalEnhanced",
          userId: signalData.username,
          safeAddress: signalData.safeAddress,
          networkKey: tokenDetection.primaryChain.networkKey,
        });
      }

      tradingLogger.safe(
        `Safe ${signalData.safeAddress} validated on ${safeCompatibility.tokenChainInfo.networkKey}`,
        {
          safeAddress: signalData.safeAddress,
          networkKey: safeCompatibility.tokenChainInfo.networkKey,
        }
      );

      // Step 5: Calculate position size (20% of USDC balance)
      flowLogger.step(flowName, "Calculating Position Size");
      const positionCalculation =
        await this.positionSizingService.calculatePositionSize(
          signalData.safeAddress,
          "USDC", // Base trading token
          safeCompatibility.tokenChainInfo,
          20 // 20% as requested
        );

      tradingLogger.validation(`Position calculation result:`, {
        type: "position-calculation-debug",
        success: positionCalculation.success,
        meetsMinimum: positionCalculation.meetsMinimum,
        positionSize: positionCalculation.positionSizeFormatted,
        minimumRequired: positionCalculation.minimumRequired,
        error: positionCalculation.error,
      });

      if (!positionCalculation.success || !positionCalculation.meetsMinimum) {
        throw errorHandler.createError("POSITION_SIZE_TOO_SMALL", {
          service: "api-signal-processor",
          operation: "processSignalEnhanced",
          userId: signalData.username,
          safeAddress: signalData.safeAddress,
          positionSize: positionCalculation.positionSizeFormatted,
        });
      }

      tradingLogger.trade(
        `Position size calculated: ${positionCalculation.positionSizeFormatted} USDC`,
        {
          amount: positionCalculation.positionSizeFormatted,
          percentage: positionCalculation.positionSizePercentage,
          usdValue: positionCalculation.positionSizeUsd,
        }
      );

      // Step 6: Create trading pair with validated data
      flowLogger.step(flowName, "Creating Trading Pair");
      const tradingPair = await this.createTradingPairEnhanced(
        signalId,
        signalData,
        safeCompatibility,
        positionCalculation
      );

      // Step 7: Execute the trade
      flowLogger.step(flowName, "Executing Trade");
      await this.executeTradeEnhanced(
        tradingPair,
        signalData,
        positionCalculation
      );

      return {
        signalId,
        tradingPair,
        status: "success",
      };
    } catch (error) {
      if (error.code) {
        // Already a TradingError, re-throw
        throw error;
      }

      // Wrap unknown errors
      throw errorHandler.createError(
        "SIGNAL_PROCESSING_FAILED",
        {
          service: "api-signal-processor",
          operation: "processSignalEnhanced",
          userId: signalData.username,
          tokenSymbol: signalData["Token Mentioned"],
          safeAddress: signalData.safeAddress,
        },
        error instanceof Error ? error : undefined
      );
    }
  }

  private validateSignalData(signalData: ApiSignal): void {
    if (
      !signalData["Signal Message"] ||
      !["buy", "sell"].includes(signalData["Signal Message"])
    ) {
      throw new Error("Invalid signal message");
    }

    if (!signalData["Token Mentioned"]) {
      throw new Error("Token mentioned is required");
    }

    if (!signalData.username) {
      throw new Error("Username is required");
    }

    if (!signalData.safeAddress) {
      throw new Error("Safe address is required");
    }

    if (!signalData["Current Price"] || signalData["Current Price"] <= 0) {
      throw new Error("Valid current price is required");
    }

    if (!signalData["Max Exit Time"] || !signalData["Max Exit Time"]["$date"]) {
      throw new Error("Valid max exit time is required");
    }

    // Validate TP and SL values
    if (signalData["Signal Message"] === "buy") {
      if (signalData.TP1 <= signalData["Current Price"]) {
        throw new Error("TP1 must be higher than current price for buy signal");
      }
      if (signalData.SL >= signalData["Current Price"]) {
        throw new Error("SL must be lower than current price for buy signal");
      }
    } else {
      if (signalData.TP1 >= signalData["Current Price"]) {
        throw new Error("TP1 must be lower than current price for sell signal");
      }
      if (signalData.SL <= signalData["Current Price"]) {
        throw new Error("SL must be higher than current price for sell signal");
      }
    }
  }

  private async processSignal(
    signalId: string,
    signalData: ApiSignal
  ): Promise<ProcessedSignal> {
    try {
      // Check if user has an active safe deployment
      const safeDoc = await this.dbService.getUserSafe(
        signalData.username,
        signalData.safeAddress
      );

      if (!safeDoc) {
        throw new Error(
          `No active safe found for user: ${signalData.username} with address: ${signalData.safeAddress}`
        );
      }

      // Verify the provided safe address matches the user's safe
      const activeDeployments =
        await this.dbService.getActiveDeployments(safeDoc);

      this.logger.info(
        `Verifying Safe address ${signalData.safeAddress} for user ${signalData.username}`
      );
      this.logger.info(
        `Available deployments:`,
        activeDeployments.map((d) => ({
          networkKey: d.networkKey,
          safeAddress: d.safeAddress,
          deploymentStatus: d.deploymentStatus,
          isActive: d.isActive,
        }))
      );

      const matchingSafe = activeDeployments.find(
        (deployment) =>
          deployment.safeAddress?.toLowerCase() ===
          signalData.safeAddress.toLowerCase()
      );

      if (!matchingSafe) {
        this.logger.error(
          `Safe address mismatch! Provided: ${signalData.safeAddress}, ` +
            `Available: ${activeDeployments.map((d) => d.safeAddress).join(", ")}`
        );
        throw new Error(
          `Safe address ${signalData.safeAddress} not found for user ${signalData.username}. ` +
            `Available Safe addresses: ${activeDeployments.map((d) => d.safeAddress).join(", ")}`
        );
      }

      this.logger.info(
        `✅ Safe address verified! Using deployment on ${matchingSafe.networkKey}`
      );

      // Create trading pair data
      const tradingPair = await this.createTradingPair(
        signalId,
        signalData,
        matchingSafe
      );

      // Execute the trade
      await this.executeTrade(tradingPair, signalData);

      return {
        signalId,
        tradingPair,
        status: "success",
      };
    } catch (error) {
      this.logger.error(`Error processing signal ${signalId}:`, error);

      return {
        signalId,
        tradingPair: {
          userId: signalData.username,
          tradeId: signalId,
          safeAddress: signalData.safeAddress,
          networkKey: "arbitrum",
          status: "failed",
          error: error instanceof Error ? error.message : "Unknown error",
        },
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Create trading pair with enhanced validation data
   */
  private async createTradingPairEnhanced(
    signalId: string,
    signalData: ApiSignal,
    safeCompatibility: any,
    positionCalculation: any
  ): Promise<ProcessedTradingPair> {
    const tradeId = `${signalId}_${signalData.username}`;

    tradingLogger.trade(
      `Creating trading pair for ${signalData["Token Mentioned"]}`,
      {
        tradeId,
        safeAddress: signalData.safeAddress,
        networkKey: safeCompatibility.tokenChainInfo.networkKey,
        positionSize: positionCalculation.positionSizeFormatted,
      }
    );

    return {
      userId: signalData.username,
      tradeId,
      safeAddress: signalData.safeAddress,
      networkKey: safeCompatibility.tokenChainInfo.networkKey,
      status: "pending",
    };
  }

  /**
   * Execute trade with enhanced validation and position sizing
   */
  private async executeTradeEnhanced(
    tradingPair: ProcessedTradingPair,
    signalData: ApiSignal,
    positionCalculation: any
  ): Promise<void> {
    try {
      // Convert signal data to the format expected by the trade execution service
      const tradeData = {
        tradeId: tradingPair.tradeId,
        userId: tradingPair.userId,
        safeAddress: tradingPair.safeAddress,
        networkKey: tradingPair.networkKey,
        tokenMentioned: signalData["Token Mentioned"],
        signalMessage: signalData["Signal Message"],
        currentPrice: signalData["Current Price"],
        tp1: signalData.TP1,
        tp2: signalData.TP2,
        sl: signalData.SL,
        maxExitTime: new Date(signalData["Max Exit Time"]["$date"]),
        signalId: tradingPair.tradeId.split("_")[0],
      };

      tradingLogger.trade(
        `Executing trade with position size: $${positionCalculation.positionSizeUsd}`,
        {
          tradeId: tradingPair.tradeId,
          token: signalData["Token Mentioned"],
          amount: positionCalculation.positionSizeFormatted,
        }
      );

      // Execute the trade with the calculated token amount
      await this.tradeExecutionService.executeTrade(
        tradeData,
        positionCalculation.positionSizeFormatted // Pass token amount, not USD
      );

      // Update status
      tradingPair.status = "success";

      tradingLogger.success(
        `Trade executed successfully: ${tradingPair.tradeId}`,
        {
          service: "trade-execution",
          tradeId: tradingPair.tradeId,
          userId: tradingPair.userId,
        }
      );
    } catch (error) {
      tradingPair.status = "failed";
      tradingPair.error =
        error instanceof Error ? error.message : "Unknown error";

      tradingLogger.error(
        `Trade execution failed: ${tradingPair.tradeId}`,
        error,
        {
          service: "trade-execution",
          tradeId: tradingPair.tradeId,
        }
      );

      throw error;
    }
  }

  private async createTradingPair(
    signalId: string,
    signalData: ApiSignal,
    safeDeployment: any
  ): Promise<ProcessedTradingPair> {
    // Extract network information from Safe deployment
    let networkKey = safeDeployment.networkKey;

    // Try to get network info from the deployment metadata
    if (!networkKey && safeDeployment.deployments) {
      // If deployments array exists, get the network from the first active deployment
      const activeDeployment = Array.isArray(safeDeployment.deployments)
        ? safeDeployment.deployments.find(
            (d: any) => d.status === "active" || d.status === "deployed"
          )
        : null;

      if (activeDeployment && activeDeployment.networkKey) {
        networkKey = activeDeployment.networkKey;
      } else if (activeDeployment && activeDeployment.chainId) {
        // Map chainId to networkKey
        const chainIdMap: Record<number, string> = {
          42161: "arbitrum",
          11155111: "sepolia",
          421614: "arbitrum_sepolia",
          84532: "base_sepolia",
          137: "polygon",
          8453: "base",
          10: "optimism",
        };
        networkKey = chainIdMap[activeDeployment.chainId];
      }
    }

    // Default to arbitrum if no network info found (but log a warning)
    if (!networkKey) {
      this.logger.warn(
        `No network information found for Safe ${signalData.safeAddress}, defaulting to arbitrum. ` +
          `This may cause network mismatch errors.`
      );
      networkKey = "arbitrum";
    }

    const tradeId = `${signalId}_${signalData.username}`;

    this.logger.info(
      `Creating trading pair for Safe ${signalData.safeAddress} on network: ${networkKey}`
    );

    return {
      userId: signalData.username,
      tradeId,
      safeAddress: signalData.safeAddress,
      networkKey,
      status: "pending",
    };
  }

  private async executeTrade(
    tradingPair: ProcessedTradingPair,
    signalData: ApiSignal
  ): Promise<void> {
    try {
      // Convert signal data to the format expected by the trade execution service
      const tradeData = {
        tradeId: tradingPair.tradeId,
        userId: tradingPair.userId,
        safeAddress: tradingPair.safeAddress,
        networkKey: tradingPair.networkKey,
        tokenMentioned: signalData["Token Mentioned"],
        signalMessage: signalData["Signal Message"],
        currentPrice: signalData["Current Price"],
        tp1: signalData.TP1,
        tp2: signalData.TP2,
        sl: signalData.SL,
        maxExitTime: new Date(signalData["Max Exit Time"]["$date"]),
        signalId: tradingPair.tradeId.split("_")[0],
      };

      // Calculate position size - use default small amount for legacy method
      const positionSizeAmount = "1"; // 1 USDC default for legacy calls

      // Execute the trade
      await this.tradeExecutionService.executeTrade(
        tradeData,
        positionSizeAmount
      );

      // Update status
      tradingPair.status = "success";

      this.logger.info(
        `✅ Trade executed successfully: ${tradingPair.tradeId} for ${tradingPair.userId}`
      );
    } catch (error) {
      tradingPair.status = "failed";
      tradingPair.error =
        error instanceof Error ? error.message : "Unknown error";

      this.logger.error(
        `❌ Trade execution failed: ${tradingPair.tradeId} - ${tradingPair.error}`
      );

      throw error;
    }
  }

  private async processExecutionQueue(): Promise<void> {
    try {
      // Process any pending trades in the execution queue
      const pendingTrades = await this.tradeStateManager.getPendingTrades();

      for (const trade of pendingTrades) {
        try {
          await this.tradeExecutionService.retryFailedTrade(trade);
        } catch (error) {
          this.logger.error(`Error retrying trade ${trade.tradeId}:`, error);
        }
      }
    } catch (error) {
      this.logger.error("Error processing execution queue:", error);
    }
  }

  private async handleTradeExit(exitData: any): Promise<void> {
    try {
      this.logger.info(
        `🔄 Handling trade exit: ${exitData.tradeId} - ${exitData.reason}`
      );

      // Execute the trade exit
      await this.tradeExecutionService.exitTrade(
        exitData.trade,
        exitData.amount,
        exitData.reason
      );

      this.emit("tradeExited", exitData);
    } catch (error) {
      this.logger.error(`Error handling trade exit:`, error);
    }
  }

  /**
   * Get the current status of the API signal processor
   */
  getStatus(): {
    isActive: boolean;
    processingQueue: number;
    activeTrades: number;
    monitoredTrades: number;
    lastProcessed?: Date;
  } {
    return {
      isActive: this.isActive,
      processingQueue: this.processingQueue.size,
      activeTrades: this.tradeStateManager.getActiveTrades().length,
      monitoredTrades: this.priceMonitoringService.getMonitoredTrades().size,
      lastProcessed: new Date(),
    };
  }

  /**
   * Update the trading configuration
   */
  updateConfig(config: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info("Trading configuration updated", config);
  }
}

export default ApiSignalProcessor;
export { ApiSignal, ProcessedSignal, ProcessedTradingPair, TradingConfig };
