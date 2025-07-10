import { EventEmitter } from "events";
import { logger } from "../config/logger";
import { ChangeStreamDocument } from "mongodb";
import DatabaseService from "./DatabaseService";
import TradeStateManager from "./TradeStateManager";
import TradeExecutionService from "./TradeExecutionService";
import PriceMonitoringService from "./PriceMonitoringService";
import { NetworkUtils } from "../utils/NetworkUtils";

interface ProcessedSignal {
  signalId: string;
  tradingPairs: ProcessedTradingPair[];
  totalSubscribers: number;
  successfulTrades: number;
  failedTrades: number;
  errors: string[];
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
  positionSizeUsd: number; // Default position size in USD
  maxDailyTrades: number;
  enableTrailingStop: boolean;
  trailingStopRetracement: number; // Percentage
  defaultSlippage: number;
  gasBuffer: number; // Extra gas percentage
}

class TradingSignalWatcher extends EventEmitter {
  private logger = logger;
  private dbService: DatabaseService;
  private tradeStateManager: TradeStateManager;
  private tradeExecutionService: TradeExecutionService;
  private priceMonitoringService: PriceMonitoringService;
  private isWatching: boolean = false;
  private changeStream: any = null;
  private config: TradingConfig;
  private processingQueue: Set<string> = new Set(); // Track signals being processed

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

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Handle trade exit events from price monitoring
    this.priceMonitoringService.on("tradeExit", async (exitData) => {
      await this.handleTradeExit(exitData);
    });

    // Handle trade execution queue
    setInterval(() => {
      this.processExecutionQueue();
    }, 5000); // Process queue every 5 seconds
  }

  async start(): Promise<void> {
    if (this.isWatching) {
      this.logger.warn("Trading signal watcher already running");
      return;
    }

    try {
      // Start price monitoring service
      await this.priceMonitoringService.start();

      // Create and setup change stream
      this.changeStream = this.dbService.createSignalChangeStream();

      this.changeStream.on("change", async (change: ChangeStreamDocument) => {
        await this.handleSignalChange(change);
      });

      this.changeStream.on("error", (error: Error) => {
        this.logger.error("Change stream error:", error);
        this.emit("error", error);
      });

      this.isWatching = true;
      this.logger.info("🚀 Trading signal watcher started successfully");
      this.emit("started");
    } catch (error) {
      this.logger.error("Failed to start trading signal watcher:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isWatching) {
      return;
    }

    try {
      if (this.changeStream) {
        await this.changeStream.close();
        this.changeStream = null;
      }

      this.priceMonitoringService.stop();
      this.isWatching = false;

      this.logger.info("⏹️ Trading signal watcher stopped");
      this.emit("stopped");
    } catch (error) {
      this.logger.error("Error stopping trading signal watcher:", error);
    }
  }

  private async handleSignalChange(
    change: ChangeStreamDocument
  ): Promise<void> {
    try {
      if (change.operationType !== "insert" || !change.fullDocument) {
        return;
      }

      const signal = change.fullDocument;
      const signalId = signal["_id"].toString();

      // Prevent duplicate processing
      if (this.processingQueue.has(signalId)) {
        this.logger.warn(`Signal ${signalId} already being processed`);
        return;
      }

      this.processingQueue.add(signalId);
      this.logger.info(
        `📡 New trading signal received: ${signalId} for ${signal["signal_data"]?.tokenMentioned}`
      );

      try {
        const result = await this.processSignal(signal);
        this.emit("signalProcessed", result);

        this.logger.info(
          `✅ Signal ${signalId} processed: ${result.successfulTrades}/${result.totalSubscribers} trades successful`
        );
      } finally {
        this.processingQueue.delete(signalId);
      }
    } catch (error) {
      this.logger.error("Error handling signal change:", error);
      this.emit("error", error);
    }
  }

  private async processSignal(signal: any): Promise<ProcessedSignal> {
    const signalId = signal._id.toString();
    const result: ProcessedSignal = {
      signalId,
      tradingPairs: [],
      totalSubscribers: 0,
      successfulTrades: 0,
      failedTrades: 0,
      errors: [],
    };

    try {
      // Validate signal data
      if (
        !signal.signal_data ||
        !signal.subscribers ||
        signal.subscribers.length === 0
      ) {
        result.errors.push("Invalid signal data or no subscribers");
        return result;
      }

      const { signal_data, subscribers } = signal;
      result.totalSubscribers = subscribers.length;

      // Process each subscriber
      const subscriberPromises = subscribers.map(async (subscriber: any) => {
        return await this.processSubscriber(
          subscriber.username,
          signalId,
          signal_data
        );
      });

      const subscriberResults = await Promise.allSettled(subscriberPromises);

      for (let i = 0; i < subscriberResults.length; i++) {
        const subscriberResult = subscriberResults[i];
        const subscriber = subscribers[i];

        if (subscriberResult.status === "fulfilled" && subscriberResult.value) {
          result.tradingPairs.push(subscriberResult.value);

          if (subscriberResult.value.status === "success") {
            result.successfulTrades++;
          } else {
            result.failedTrades++;
          }
        } else {
          result.failedTrades++;
          result.errors.push(
            `Failed to process subscriber ${subscriber.username}: ${
              subscriberResult.status === "rejected"
                ? subscriberResult.reason
                : "Unknown error"
            }`
          );
        }
      }

      return result;
    } catch (error) {
      this.logger.error(`Error processing signal ${signalId}:`, error);
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
      return result;
    }
  }

  private async processSubscriber(
    username: string,
    signalId: string,
    signalData: any
  ): Promise<ProcessedTradingPair | null> {
    try {
      // Get user's Safe
      const userSafe = await this.dbService.getUserSafe(username);
      if (!userSafe) {
        throw new Error(`No active Safe found for user ${username}`);
      }

      // Get active deployments
      const activeDeployments =
        await this.dbService.getActiveDeployments(userSafe);
      if (activeDeployments.length === 0) {
        throw new Error(`No active Safe deployments for user ${username}`);
      }

      // Determine optimal network for the token
      const tokenSymbol = signalData.tokenMentioned;
      const optimalNetwork = NetworkUtils.determineOptimalNetwork(
        tokenSymbol,
        activeDeployments
      );

      if (!optimalNetwork) {
        throw new Error(
          `Token ${tokenSymbol} not supported on user's networks`
        );
      }

      const deployment = activeDeployments.find(
        (d) => d.networkKey === optimalNetwork
      );
      if (!deployment) {
        throw new Error(`Deployment not found for network ${optimalNetwork}`);
      }

      // Create trade entry
      const trade = this.tradeStateManager.createTradeEntry(
        username,
        signalId,
        deployment.address,
        optimalNetwork,
        tokenSymbol,
        signalData
      );

      // Queue trade for execution
      this.tradeStateManager.queueTradeExecution({
        action: "enter",
        tradeId: trade.tradeId,
        amount: this.config.positionSizeUsd.toString(),
        reason: `New signal for ${tokenSymbol}`,
        urgency: "medium",
      });

      this.logger.info(
        `✅ Created trade ${trade.tradeId} for ${username} on ${optimalNetwork}`
      );

      return {
        userId: username,
        tradeId: trade.tradeId,
        safeAddress: deployment.address,
        networkKey: optimalNetwork,
        status: "pending",
      };
    } catch (error) {
      this.logger.error(`Failed to process subscriber ${username}:`, error);

      return {
        userId: username,
        tradeId: "",
        safeAddress: "",
        networkKey: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  private async processExecutionQueue(): Promise<void> {
    const plan = this.tradeStateManager.getNextExecutionPlan();
    if (!plan) {
      return; // Nothing to execute
    }

    try {
      this.logger.info(
        `🔄 Processing execution plan: ${plan.action} for trade ${plan.tradeId}`
      );

      const trade = this.tradeStateManager.getTrade(plan.tradeId);
      if (!trade) {
        this.logger.error(`Trade ${plan.tradeId} not found`);
        return;
      }

      if (plan.action === "enter") {
        await this.executeTrade(trade, plan.amount);
      } else if (plan.action === "exit") {
        await this.exitTrade(trade, plan.amount, plan.reason);
      }
    } catch (error) {
      this.logger.error(`Error processing execution plan:`, error);
      this.tradeStateManager.updateTradeStatus(plan.tradeId, "failed");
    }
  }

  private async executeTrade(
    trade: any,
    positionSizeUsd: string
  ): Promise<void> {
    try {
      // Calculate trade amount based on current price
      const currentPrice = await this.priceMonitoringService.getCurrentPrice(
        trade.tokenSymbol
      );
      if (!currentPrice) {
        throw new Error(`Failed to get current price for ${trade.tokenSymbol}`);
      }

      // For buying, we need to determine what token to sell (assume USDC for now)
      const fromToken = "USDC";
      const toToken = trade.tokenSymbol;
      const fromAmount = positionSizeUsd;

      // Check if user has sufficient balance
      const networkConfig = NetworkUtils.getNetworkByKey(trade.networkKey);
      const fromTokenAddress = NetworkUtils.getTokenAddress(
        fromToken,
        trade.networkKey
      );
      const balance = await this.tradeExecutionService.getSafeBalance(
        trade.safeAddress,
        fromTokenAddress || fromToken,
        networkConfig?.chainId || 42161
      );

      if (!balance || parseFloat(balance) < parseFloat(fromAmount)) {
        throw new Error(
          `Insufficient ${fromToken} balance. Available: ${balance}, Required: ${fromAmount}`
        );
      }

      // Execute the swap
      const result: any = await this.tradeExecutionService.executeSwap(
        trade.safeAddress,
        fromToken,
        toToken,
        fromAmount,
        networkConfig?.chainId || 42161,
        networkConfig!
      );

      if (result.success) {
        // Update trade state
        this.tradeStateManager.updateTradeStatus(
          trade.tradeId,
          "entered",
          result.transactionHash
        );
        this.tradeStateManager.setTradeEntryAmount(
          trade.tradeId,
          result.amountOut || "0"
        );

        // Start monitoring for exit conditions
        this.priceMonitoringService.addTradeMonitoring({
          tradeId: trade.tradeId,
          tokenId: trade.tokenSymbol,
          entryPrice: currentPrice,
          tp1: trade.targets.tp1,
          tp2: trade.targets.tp2,
          stopLoss: trade.stopLoss,
          maxExitTime: trade.maxExitTime,
          trailingStopEnabled: this.config.enableTrailingStop,
          trailingStopRetracement: this.config.trailingStopRetracement,
        });

        this.logger.info(
          `✅ Trade ${trade.tradeId} entered successfully at ${currentPrice}`
        );
        this.emit("tradeEntered", { trade, result });
      } else {
        throw new Error(result.error || "Trade execution failed");
      }
    } catch (error) {
      this.logger.error(`Failed to execute trade ${trade.tradeId}:`, error);
      this.tradeStateManager.updateTradeStatus(trade.tradeId, "failed");
      this.emit("tradeFailed", { trade, error });
    }
  }

  private async exitTrade(
    trade: any,
    amount: string,
    reason: string
  ): Promise<void> {
    try {
      const currentPrice = await this.priceMonitoringService.getCurrentPrice(
        trade.tokenSymbol
      );
      if (!currentPrice) {
        throw new Error(`Failed to get current price for ${trade.tokenSymbol}`);
      }

      // For exiting, sell the token back to USDC
      const fromToken = trade.tokenSymbol;
      const toToken = "USDC";

      const exitNetworkConfig = NetworkUtils.getNetworkByKey(trade.networkKey);
      const result: any = await this.tradeExecutionService.executeSwap(
        trade.safeAddress,
        fromToken,
        toToken,
        amount,
        exitNetworkConfig?.chainId || 42161,
        exitNetworkConfig!
      );

      if (result.success) {
        // Calculate P&L
        const entryValue = parseFloat(amount) * trade.entryPrice;
        const exitValue = parseFloat(result.amountOut || "0");
        const profitLoss = exitValue - entryValue;

        // Add exit event
        this.tradeStateManager.addExitEvent(trade.tradeId, {
          exitType: this.getExitType(reason),
          exitPrice: currentPrice,
          exitAmount: amount,
          exitPercentage: 100, // Full exit for now
          txHash: result.transactionHash,
          profitLoss,
        });

        this.logger.info(
          `✅ Trade ${trade.tradeId} exited: ${reason} at ${currentPrice}, P&L: $${profitLoss.toFixed(2)}`
        );
        this.emit("tradeExited", { trade, result, reason, profitLoss });
      } else {
        throw new Error(result.error || "Exit execution failed");
      }
    } catch (error) {
      this.logger.error(`Failed to exit trade ${trade.tradeId}:`, error);
      this.emit("tradeExitFailed", { trade, error, reason });
    }
  }

  private async handleTradeExit(exitData: any): Promise<void> {
    const { tradeId, exitCondition, exitPrice, config } = exitData;

    this.logger.info(
      `🔔 Exit condition triggered for trade ${tradeId}: ${exitCondition}`
    );

    const trade = this.tradeStateManager.getTrade(tradeId);
    if (!trade) {
      this.logger.error(`Trade ${tradeId} not found for exit`);
      return;
    }

    // Queue exit execution
    this.tradeStateManager.queueTradeExecution({
      action: "exit",
      tradeId,
      amount: trade.entryAmount, // Exit full position
      reason: exitCondition,
      urgency: exitCondition === "STOP_LOSS" ? "high" : "medium",
    });
  }

  private getExitType(reason: string): any {
    const exitTypeMap: { [key: string]: any } = {
      TP1: "TP1",
      TP2: "TP2",
      STOP_LOSS: "STOP_LOSS",
      TRAILING_STOP: "TRAILING_STOP",
      MAX_EXIT_TIME: "MAX_EXIT_TIME",
    };

    return exitTypeMap[reason] || "MANUAL";
  }

  getStatus(): {
    isWatching: boolean;
    processingQueue: number;
    activeTrades: number;
    monitoredTrades: number;
    lastProcessed?: Date;
  } {
    return {
      isWatching: this.isWatching,
      processingQueue: this.processingQueue.size,
      activeTrades: this.tradeStateManager.getActiveTrades().length,
      monitoredTrades: this.priceMonitoringService.getMonitoredTrades().size,
    };
  }

  updateConfig(config: Partial<TradingConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.info("Trading configuration updated:", config);
  }
}

export default TradingSignalWatcher;
export { ProcessedSignal, ProcessedTradingPair, TradingConfig };
