import { EventEmitter } from "events";
import { logger } from "../config/logger";
import DatabaseService from "./DatabaseService";
import TradeExecutionService from "./TradeExecutionService";
import PriceMonitoringService from "./PriceMonitoringService";
import { ObjectId } from "mongodb";

interface MonitoredTrade {
  _id: string;
  tradeId: string;
  userId: string;
  safeAddress: string;
  networkKey: string;
  tokenSymbol: string;
  tokenMentioned: string;
  signalMessage: "buy" | "sell";
  entryPrice: number;
  currentPrice?: number;

  // Exit conditions from signal
  tp1: number;
  tp2: number;
  sl: number;
  maxExitTime: Date;

  // Trade execution data
  entryTxHash: string;
  entryAmount: string;
  executedAt: Date;

  // Current status
  status: "active" | "exited" | "failed";

  // Monitoring data
  lastPriceCheck?: Date;
  priceCheckCount: number;

  // Trailing stop data
  highestPriceSinceEntry: number;
  trailingStopPrice: number;
  trailingStopEnabled: boolean;
}

interface ExitCondition {
  type: "TP1" | "TP2" | "STOP_LOSS" | "MAX_EXIT_TIME" | "TRAILING_STOP";
  currentPrice: number;
  targetPrice?: number;
  triggered: boolean;
}

class TradeMonitoringService extends EventEmitter {
  private logger = logger;
  private monitoredTrades: Map<string, MonitoredTrade> = new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private dbSyncInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  private readonly MONITORING_INTERVAL_MS = 30000; // 30 seconds
  private readonly PRICE_CHECK_TIMEOUT = 10000; // 10 seconds timeout for price fetching
  private readonly DB_SYNC_INTERVAL_MS = 60000; // 1 minute - check for new trades in DB

  constructor(
    private databaseService: DatabaseService,
    private tradeExecutionService: TradeExecutionService,
    private priceMonitoringService: PriceMonitoringService
  ) {
    super();
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.warn("Trade monitoring service is already running");
      return;
    }

    try {
      this.logger.info("🚀 Starting Trade Monitoring Service");

      // Load active trades from database
      await this.loadActiveTradesFromDatabase();

      // Start monitoring interval
      this.monitoringInterval = setInterval(
        () => this.monitorAllTrades(),
        this.MONITORING_INTERVAL_MS
      );

      // Start database sync interval to catch any missed trades
      this.dbSyncInterval = setInterval(
        () => this.syncWithDatabase(),
        this.DB_SYNC_INTERVAL_MS
      );

      this.isRunning = true;
      this.logger.info(
        `✅ Trade monitoring started with ${this.monitoredTrades.size} active trades`
      );

      // Initial monitoring run
      await this.monitorAllTrades();
    } catch (error) {
      this.logger.error("❌ Failed to start trade monitoring service:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.logger.info("🛑 Stopping Trade Monitoring Service");

    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    if (this.dbSyncInterval) {
      clearInterval(this.dbSyncInterval);
      this.dbSyncInterval = null;
    }

    this.isRunning = false;
    this.monitoredTrades.clear();

    this.logger.info("✅ Trade monitoring service stopped");
  }

  private async loadActiveTradesFromDatabase(): Promise<void> {
    try {
      const activeTrades = await this.databaseService.getActiveTrades();

      for (const trade of activeTrades) {
        const monitoredTrade: MonitoredTrade = {
          _id: trade._id.toString(),
          tradeId: trade.tradeId,
          userId: trade.userId,
          safeAddress: trade.safeAddress,
          networkKey: trade.networkKey,
          tokenSymbol: trade.tokenSymbol || trade.tokenMentioned,
          tokenMentioned: trade.tokenMentioned,
          signalMessage: trade.signalMessage,
          entryPrice: trade.entryPrice || trade.currentPrice,
          tp1: trade.tp1,
          tp2: trade.tp2,
          sl: trade.sl,
          maxExitTime: new Date(trade.maxExitTime),
          entryTxHash: trade.entryTxHash || "",
          entryAmount: trade.entryAmount || "0",
          executedAt: new Date(trade.executedAt || trade.createdAt),
          status: trade.status,
          priceCheckCount: 0,
          // Initialize trailing stop data
          highestPriceSinceEntry: trade.entryPrice || trade.currentPrice,
          trailingStopPrice: (trade.entryPrice || trade.currentPrice) * 0.99, // 1% below entry
          trailingStopEnabled: true,
        };

        this.monitoredTrades.set(trade._id.toString(), monitoredTrade);
        this.logger.info(
          `📊 Loaded trade for monitoring: ${trade.tradeId} (${trade.tokenMentioned})`
        );
      }

      this.logger.info(
        `📈 Loaded ${activeTrades.length} active trades for monitoring`
      );
    } catch (error) {
      this.logger.error("❌ Error loading active trades from database:", error);
    }
  }

  private async syncWithDatabase(): Promise<void> {
    try {
      const activeTrades = await this.databaseService.getActiveTrades();
      let newTradesFound = 0;

      for (const trade of activeTrades) {
        const tradeId = trade._id.toString();

        // If this trade is not currently being monitored, add it
        if (!this.monitoredTrades.has(tradeId)) {
          const monitoredTrade: MonitoredTrade = {
            _id: tradeId,
            tradeId: trade.tradeId,
            userId: trade.userId,
            safeAddress: trade.safeAddress,
            networkKey: trade.networkKey,
            tokenSymbol: trade.tokenSymbol || trade.tokenMentioned,
            tokenMentioned: trade.tokenMentioned,
            signalMessage: trade.signalMessage,
            entryPrice: trade.entryPrice || trade.currentPrice,
            tp1: trade.tp1,
            tp2: trade.tp2,
            sl: trade.sl,
            maxExitTime: new Date(trade.maxExitTime),
            entryTxHash: trade.entryTxHash || "",
            entryAmount: trade.entryAmount || "0",
            executedAt: new Date(trade.executedAt || trade.createdAt),
            status: trade.status,
            priceCheckCount: 0,
            // Initialize trailing stop data
            highestPriceSinceEntry: trade.entryPrice || trade.currentPrice,
            trailingStopPrice: (trade.entryPrice || trade.currentPrice) * 0.99, // 1% below entry
            trailingStopEnabled: true,
          };

          this.monitoredTrades.set(tradeId, monitoredTrade);
          newTradesFound++;

          this.logger.info(
            `🔄 Database sync: Added new trade to monitoring: ${trade.tradeId} (${trade.tokenMentioned})`
          );
          this.emit("tradeAdded", monitoredTrade);
        }
      }

      if (newTradesFound > 0) {
        this.logger.info(
          `🔄 Database sync completed: Found ${newTradesFound} new trades to monitor`
        );
      }
    } catch (error) {
      this.logger.error("❌ Error during database sync:", error);
    }
  }

  async addTradeToMonitoring(tradeData: any): Promise<void> {
    try {
      // Store in database first
      const mongoId = await this.databaseService.storeExecutedTrade(tradeData);

      // Add to monitoring
      const monitoredTrade: MonitoredTrade = {
        _id: mongoId,
        tradeId: tradeData.tradeId,
        userId: tradeData.userId,
        safeAddress: tradeData.safeAddress,
        networkKey: tradeData.networkKey,
        tokenSymbol: tradeData.tokenSymbol || tradeData.tokenMentioned,
        tokenMentioned: tradeData.tokenMentioned,
        signalMessage: tradeData.signalMessage,
        entryPrice: tradeData.entryPrice || tradeData.currentPrice,
        tp1: tradeData.tp1,
        tp2: tradeData.tp2,
        sl: tradeData.sl,
        maxExitTime: new Date(tradeData.maxExitTime),
        entryTxHash: tradeData.entryTxHash || "",
        entryAmount: tradeData.entryAmount || "0",
        executedAt: new Date(),
        status: "active",
        priceCheckCount: 0,
        // Initialize trailing stop data
        highestPriceSinceEntry: tradeData.entryPrice || tradeData.currentPrice,
        trailingStopPrice:
          (tradeData.entryPrice || tradeData.currentPrice) * 0.99, // 1% below entry
        trailingStopEnabled: true,
      };

      this.monitoredTrades.set(mongoId, monitoredTrade);

      this.logger.info(
        `✅ Added trade to monitoring: ${tradeData.tradeId} (${tradeData.tokenMentioned})`
      );
      this.emit("tradeAdded", monitoredTrade);
    } catch (error) {
      this.logger.error("❌ Error adding trade to monitoring:", error);
      throw error;
    }
  }

  private async monitorAllTrades(): Promise<void> {
    if (this.monitoredTrades.size === 0) {
      return;
    }

    this.logger.info(
      `🔍 Monitoring ${this.monitoredTrades.size} active trades...`
    );

    const monitoringPromises = Array.from(this.monitoredTrades.values()).map(
      (trade) =>
        this.monitorSingleTrade(trade).catch((error) => {
          this.logger.error(`Error monitoring trade ${trade.tradeId}:`, error);
        })
    );

    await Promise.allSettled(monitoringPromises);
  }

  private async monitorSingleTrade(trade: MonitoredTrade): Promise<void> {
    try {
      // Get current price
      const currentPrice = await this.getCurrentPrice(trade.tokenSymbol);
      if (!currentPrice) {
        this.logger.warn(`⚠️ Unable to get price for ${trade.tokenSymbol}`);
        return;
      }

      // Update trade with current price
      trade.currentPrice = currentPrice;
      trade.lastPriceCheck = new Date();
      trade.priceCheckCount++;

      // Update trailing stop data
      this.updateTrailingStopData(trade, currentPrice);

      // Check exit conditions
      const exitCondition = this.checkExitConditions(trade, currentPrice);

      if (exitCondition.triggered) {
        this.logger.info(
          `🚨 Exit condition triggered for ${trade.tradeId}: ${exitCondition.type} at price ${currentPrice}`
        );
        await this.executeTradeExit(trade, exitCondition);
      } else {
        // Log monitoring status every 10 checks
        if (trade.priceCheckCount % 10 === 0) {
          this.logger.info(
            `📊 Trade ${trade.tradeId}: Current: $${currentPrice}, TP1: $${trade.tp1}, SL: $${trade.sl}, Trailing: $${trade.trailingStopPrice.toFixed(4)}, Time left: ${this.getTimeRemaining(trade.maxExitTime)}`
          );
        }
      }
    } catch (error) {
      this.logger.error(`❌ Error monitoring trade ${trade.tradeId}:`, error);
    }
  }

  private async getCurrentPrice(tokenSymbol: string): Promise<number | null> {
    try {
      return await this.priceMonitoringService.getCurrentPrice(tokenSymbol);
    } catch (error) {
      this.logger.error(`Error getting price for ${tokenSymbol}:`, error);
      return null;
    }
  }

  private updateTrailingStopData(
    trade: MonitoredTrade,
    currentPrice: number
  ): void {
    if (!trade.trailingStopEnabled) return;

    // For BUY positions: track highest price and update trailing stop
    if (trade.signalMessage === "buy") {
      if (currentPrice > trade.highestPriceSinceEntry) {
        trade.highestPriceSinceEntry = currentPrice;
        // Update trailing stop to 1% below the new highest price
        trade.trailingStopPrice = currentPrice * 0.99;

        this.logger.info(
          `📈 Trailing stop updated for ${trade.tradeId}: New high $${currentPrice.toFixed(4)}, Trailing stop $${trade.trailingStopPrice.toFixed(4)}`
        );
      }
    }
    // For SELL positions: track lowest price and update trailing stop
    else if (trade.signalMessage === "sell") {
      if (currentPrice < trade.highestPriceSinceEntry) {
        trade.highestPriceSinceEntry = currentPrice;
        // Update trailing stop to 1% above the new lowest price
        trade.trailingStopPrice = currentPrice * 1.01;

        this.logger.info(
          `📉 Trailing stop updated for ${trade.tradeId}: New low $${currentPrice.toFixed(4)}, Trailing stop $${trade.trailingStopPrice.toFixed(4)}`
        );
      }
    }
  }

  private checkExitConditions(
    trade: MonitoredTrade,
    currentPrice: number
  ): ExitCondition {
    const now = new Date();

    // Check Max Exit Time first
    if (now >= trade.maxExitTime) {
      return {
        type: "MAX_EXIT_TIME",
        currentPrice,
        triggered: true,
      };
    }

    // For BUY positions
    if (trade.signalMessage === "buy") {
      // Check Trailing Stop first (highest priority after Max Time)
      if (
        trade.trailingStopEnabled &&
        currentPrice <= trade.trailingStopPrice
      ) {
        return {
          type: "TRAILING_STOP",
          currentPrice,
          targetPrice: trade.trailingStopPrice,
          triggered: true,
        };
      }

      // Check Stop Loss (only if trailing stop hasn't triggered)
      if (currentPrice <= trade.sl) {
        return {
          type: "STOP_LOSS",
          currentPrice,
          targetPrice: trade.sl,
          triggered: true,
        };
      }

      // Check Take Profit levels
      if (currentPrice >= trade.tp2) {
        return {
          type: "TP2",
          currentPrice,
          targetPrice: trade.tp2,
          triggered: true,
        };
      } else if (currentPrice >= trade.tp1) {
        return {
          type: "TP1",
          currentPrice,
          targetPrice: trade.tp1,
          triggered: true,
        };
      }
    }

    // For SELL positions (if applicable)
    else if (trade.signalMessage === "sell") {
      // Check Trailing Stop first (highest priority after Max Time)
      if (
        trade.trailingStopEnabled &&
        currentPrice >= trade.trailingStopPrice
      ) {
        return {
          type: "TRAILING_STOP",
          currentPrice,
          targetPrice: trade.trailingStopPrice,
          triggered: true,
        };
      }

      // Check Stop Loss (only if trailing stop hasn't triggered)
      if (currentPrice >= trade.sl) {
        return {
          type: "STOP_LOSS",
          currentPrice,
          targetPrice: trade.sl,
          triggered: true,
        };
      }

      // Check Take Profit levels (price goes down)
      if (currentPrice <= trade.tp2) {
        return {
          type: "TP2",
          currentPrice,
          targetPrice: trade.tp2,
          triggered: true,
        };
      } else if (currentPrice <= trade.tp1) {
        return {
          type: "TP1",
          currentPrice,
          targetPrice: trade.tp1,
          triggered: true,
        };
      }
    }

    return {
      type: "TP1",
      currentPrice,
      triggered: false,
    };
  }

  private async executeTradeExit(
    trade: MonitoredTrade,
    exitCondition: ExitCondition
  ): Promise<void> {
    try {
      this.logger.info(
        `🔄 Executing exit for trade ${trade.tradeId}: ${exitCondition.type}`
      );

      // Remove from monitoring immediately to prevent duplicate exits
      this.monitoredTrades.delete(trade._id);

      // Prepare exit trade data
      const exitTradeData = {
        tradeId: trade.tradeId,
        userId: trade.userId,
        safeAddress: trade.safeAddress,
        networkKey: trade.networkKey,
        tokenMentioned: trade.tokenMentioned,
        signalMessage: trade.signalMessage === "buy" ? "sell" : "buy", // Reverse the signal
        currentPrice: exitCondition.currentPrice,
        entryPrice: trade.entryPrice,
        entryAmount: trade.entryAmount,
      };

      // Execute the exit trade
      await this.tradeExecutionService.executeTrade(
        exitTradeData,
        trade.entryAmount // Use the full amount from entry
      );

      // Calculate P&L
      const entryValue = parseFloat(trade.entryAmount) * trade.entryPrice;
      const exitValue =
        parseFloat(trade.entryAmount) * exitCondition.currentPrice;
      const profitLoss =
        trade.signalMessage === "buy"
          ? exitValue - entryValue
          : entryValue - exitValue;

      // Update database
      const exitData = {
        exitType: exitCondition.type,
        exitPrice: exitCondition.currentPrice,
        exitAmount: trade.entryAmount,
        profitLoss: profitLoss,
        exitedAt: new Date(),
      };

      await this.databaseService.updateTradeStatus(
        trade._id,
        "exited",
        exitData
      );

      this.logger.info(
        `✅ Trade ${trade.tradeId} successfully exited: ${exitCondition.type} | P&L: $${profitLoss.toFixed(2)}`
      );

      this.emit("tradeExited", {
        trade,
        exitCondition,
        profitLoss,
        exitData,
      });
    } catch (error) {
      this.logger.error(
        `❌ Failed to execute exit for trade ${trade.tradeId}:`,
        error
      );

      // Update trade status to failed
      await this.databaseService.updateTradeStatus(trade._id, "failed", {
        error: error instanceof Error ? error.message : "Unknown error",
        failedAt: new Date(),
      });

      this.emit("tradeExitFailed", {
        trade,
        exitCondition,
        error,
      });
    }
  }

  private getTimeRemaining(maxExitTime: Date): string {
    const now = new Date();
    const remaining = maxExitTime.getTime() - now.getTime();

    if (remaining <= 0) {
      return "EXPIRED";
    }

    const hours = Math.floor(remaining / (1000 * 60 * 60));
    const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

    return `${hours}h ${minutes}m`;
  }

  // Public methods for external access
  getMonitoredTrades(): MonitoredTrade[] {
    return Array.from(this.monitoredTrades.values());
  }

  getTradeStatus(tradeId: string): MonitoredTrade | null {
    return (
      Array.from(this.monitoredTrades.values()).find(
        (trade) => trade.tradeId === tradeId
      ) || null
    );
  }

  async manualExitTrade(
    tradeId: string,
    reason: string = "Manual exit"
  ): Promise<boolean> {
    try {
      const trade = Array.from(this.monitoredTrades.values()).find(
        (t) => t.tradeId === tradeId
      );

      if (!trade) {
        this.logger.warn(`Trade ${tradeId} not found for manual exit`);
        return false;
      }

      const exitCondition: ExitCondition = {
        type: "TP1", // Using TP1 as placeholder for manual exit
        currentPrice: trade.currentPrice || trade.entryPrice,
        triggered: true,
      };

      await this.executeTradeExit(trade, exitCondition);
      this.logger.info(`✅ Manual exit completed for trade ${tradeId}`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Manual exit failed for trade ${tradeId}:`, error);
      return false;
    }
  }

  getSystemStatus(): any {
    return {
      isRunning: this.isRunning,
      monitoredTradesCount: this.monitoredTrades.size,
      monitoringInterval: this.MONITORING_INTERVAL_MS,
      dbSyncInterval: this.DB_SYNC_INTERVAL_MS,
      lastCheck: new Date(),
      features: {
        automaticTradeDetection: true,
        periodicDatabaseSync: true,
        realTimePriceMonitoring: true,
        automaticExitExecution: true,
      },
      trades: this.getMonitoredTrades().map((trade) => ({
        tradeId: trade.tradeId,
        tokenSymbol: trade.tokenSymbol,
        currentPrice: trade.currentPrice,
        entryPrice: trade.entryPrice,
        tp1: trade.tp1,
        tp2: trade.tp2,
        sl: trade.sl,
        trailingStopPrice: trade.trailingStopPrice,
        highestPriceSinceEntry: trade.highestPriceSinceEntry,
        trailingStopEnabled: trade.trailingStopEnabled,
        timeRemaining: this.getTimeRemaining(trade.maxExitTime),
        priceCheckCount: trade.priceCheckCount,
      })),
    };
  }
}

export default TradeMonitoringService;
export { MonitoredTrade, ExitCondition };
