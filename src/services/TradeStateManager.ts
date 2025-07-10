import { EventEmitter } from "events";
import { logger } from "../config/logger";
import { v4 as uuidv4 } from "uuid";

interface TradeEntry {
  tradeId: string;
  userId: string;
  signalId: string;
  safeAddress: string;
  networkKey: string;
  tokenSymbol: string;
  entryPrice: number;
  entryAmount: string;
  targets: {
    tp1: number;
    tp2: number;
  };
  stopLoss: number;
  maxExitTime: Date;
  status:
    | "pending"
    | "entered"
    | "partially_exited"
    | "fully_exited"
    | "stopped_out"
    | "expired"
    | "failed";
  entryTxHash?: string;
  exitTxHashes: string[];
  exitEvents: TradeExitEvent[];
  entryTimestamp: Date;
  updatedAt: Date;
  metadata: {
    signalMessage?: string;
    twitterHandle?: string;
    tweetId?: string;
    estimatedGas?: string;
    slippage?: number;
  };
}

interface TradeExitEvent {
  exitType:
    | "TP1"
    | "TP2"
    | "STOP_LOSS"
    | "TRAILING_STOP"
    | "MAX_EXIT_TIME"
    | "MANUAL";
  exitPrice: number;
  exitAmount: string;
  exitPercentage: number; // Percentage of position exited
  txHash?: string;
  timestamp: Date;
  profitLoss: number; // USD profit/loss for this exit
}

interface TradeExecutionPlan {
  action: "enter" | "exit";
  tradeId: string;
  amount: string;
  reason: string;
  urgency: "low" | "medium" | "high";
}

class TradeStateManager extends EventEmitter {
  private logger = logger;
  private activeTrades: Map<string, TradeEntry> = new Map();
  private tradeHistory: Map<string, TradeEntry> = new Map();
  private userTrades: Map<string, Set<string>> = new Map(); // userId -> Set<tradeId>
  private executionQueue: TradeExecutionPlan[] = [];

  constructor() {
    super();
  }

  createTradeEntry(
    userId: string,
    signalId: string,
    safeAddress: string,
    networkKey: string,
    tokenSymbol: string,
    signalData: any
  ): TradeEntry {
    const tradeId = uuidv4();
    const now = new Date();

    const trade: TradeEntry = {
      tradeId,
      userId,
      signalId,
      safeAddress,
      networkKey,
      tokenSymbol,
      entryPrice: signalData.currentPrice,
      entryAmount: "0", // Will be set when position is entered
      targets: {
        tp1: signalData.targets[0],
        tp2: signalData.targets[1] || signalData.targets[0],
      },
      stopLoss: signalData.stopLoss,
      maxExitTime: new Date(signalData.maxExitTime),
      status: "pending",
      exitTxHashes: [],
      exitEvents: [],
      entryTimestamp: now,
      updatedAt: now,
      metadata: {
        signalMessage: signalData.tradeTip,
        twitterHandle: signalData.twitterHandle,
        tweetId: signalData.tweet_id,
        slippage: 1, // Default 1%
      },
    };

    this.activeTrades.set(tradeId, trade);

    // Add to user's trades
    if (!this.userTrades.has(userId)) {
      this.userTrades.set(userId, new Set());
    }
    this.userTrades.get(userId)!.add(tradeId);

    this.logger.info(
      `Created trade entry ${tradeId} for user ${userId} - ${tokenSymbol}`
    );

    this.emit("tradeCreated", trade);

    return trade;
  }

  updateTradeStatus(
    tradeId: string,
    status: TradeEntry["status"],
    txHash?: string
  ): boolean {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      this.logger.warn(`Trade ${tradeId} not found for status update`);
      return false;
    }

    trade.status = status;
    trade.updatedAt = new Date();

    if (status === "entered" && txHash) {
      trade.entryTxHash = txHash;
    }

    if (
      status === "fully_exited" ||
      status === "stopped_out" ||
      status === "expired"
    ) {
      this.moveToHistory(tradeId);
    }

    this.logger.info(`Updated trade ${tradeId} status to ${status}`);
    this.emit("tradeStatusUpdated", trade);

    return true;
  }

  setTradeEntryAmount(tradeId: string, amount: string): boolean {
    const trade = this.activeTrades.get(tradeId);
    if (!trade) {
      return false;
    }

    trade.entryAmount = amount;
    trade.updatedAt = new Date();

    return true;
  }

  addExitEvent(
    tradeId: string,
    exitEvent: Omit<TradeExitEvent, "timestamp">
  ): boolean {
    const trade =
      this.activeTrades.get(tradeId) || this.tradeHistory.get(tradeId);
    if (!trade) {
      this.logger.warn(`Trade ${tradeId} not found for exit event`);
      return false;
    }

    const completeExitEvent: TradeExitEvent = {
      ...exitEvent,
      timestamp: new Date(),
    };

    trade.exitEvents.push(completeExitEvent);
    trade.updatedAt = new Date();

    if (exitEvent.txHash) {
      trade.exitTxHashes.push(exitEvent.txHash);
    }

    // Update trade status based on exit percentage
    const totalExitPercentage = trade.exitEvents.reduce(
      (sum, event) => sum + event.exitPercentage,
      0
    );

    if (totalExitPercentage >= 100) {
      trade.status = "fully_exited";
      this.moveToHistory(tradeId);
    } else if (totalExitPercentage > 0) {
      trade.status = "partially_exited";
    }

    this.logger.info(
      `Added exit event for trade ${tradeId}: ${exitEvent.exitType} at ${exitEvent.exitPrice}`
    );
    this.emit("tradeExitEvent", { trade, exitEvent: completeExitEvent });

    return true;
  }

  queueTradeExecution(plan: TradeExecutionPlan): void {
    this.executionQueue.push(plan);
    this.logger.info(
      `Queued ${plan.action} for trade ${plan.tradeId}: ${plan.reason}`
    );

    // Sort by urgency (high -> medium -> low)
    this.executionQueue.sort((a, b) => {
      const urgencyOrder = { high: 3, medium: 2, low: 1 };
      return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
    });

    this.emit("tradeQueued", plan);
  }

  getNextExecutionPlan(): TradeExecutionPlan | null {
    return this.executionQueue.shift() || null;
  }

  getActiveTrades(userId?: string): TradeEntry[] {
    if (userId) {
      const userTradeIds = this.userTrades.get(userId) || new Set();
      return Array.from(userTradeIds)
        .map((id) => this.activeTrades.get(id))
        .filter((trade): trade is TradeEntry => trade !== undefined);
    }

    return Array.from(this.activeTrades.values());
  }

  getPendingTrades(userId?: string): TradeEntry[] {
    const trades = Array.from(this.activeTrades.values()).filter(
      (trade) => trade.status === "pending"
    );

    if (userId) {
      return trades.filter((trade) => trade.userId === userId);
    }

    return trades;
  }

  getTrade(tradeId: string): TradeEntry | null {
    return (
      this.activeTrades.get(tradeId) || this.tradeHistory.get(tradeId) || null
    );
  }

  getTradesBySignal(signalId: string): TradeEntry[] {
    const active = Array.from(this.activeTrades.values()).filter(
      (trade) => trade.signalId === signalId
    );

    const historical = Array.from(this.tradeHistory.values()).filter(
      (trade) => trade.signalId === signalId
    );

    return [...active, ...historical];
  }

  getUserTradeHistory(userId: string, limit: number = 50): TradeEntry[] {
    const userTradeIds = this.userTrades.get(userId) || new Set();

    const trades = Array.from(userTradeIds)
      .map((id) => this.activeTrades.get(id) || this.tradeHistory.get(id))
      .filter((trade): trade is TradeEntry => trade !== undefined)
      .sort((a, b) => b.entryTimestamp.getTime() - a.entryTimestamp.getTime())
      .slice(0, limit);

    return trades;
  }

  calculateTradePerformance(trade: TradeEntry): {
    totalPnL: number;
    percentageReturn: number;
    holdingTime: number; // milliseconds
    isComplete: boolean;
    exitedPercentage: number;
  } {
    const entryValue = parseFloat(trade.entryAmount) * trade.entryPrice;
    let totalPnL = 0;
    let exitedPercentage = 0;

    for (const exitEvent of trade.exitEvents) {
      totalPnL += exitEvent.profitLoss;
      exitedPercentage += exitEvent.exitPercentage;
    }

    const percentageReturn = entryValue > 0 ? (totalPnL / entryValue) * 100 : 0;
    const holdingTime = new Date().getTime() - trade.entryTimestamp.getTime();
    const isComplete =
      exitedPercentage >= 100 ||
      ["fully_exited", "stopped_out", "expired"].includes(trade.status);

    return {
      totalPnL,
      percentageReturn,
      holdingTime,
      isComplete,
      exitedPercentage,
    };
  }

  getPortfolioSummary(userId: string): {
    activeTrades: number;
    totalActiveValue: number;
    totalPnL: number;
    averageReturn: number;
    winRate: number;
    totalTrades: number;
  } {
    const userTrades = this.getUserTradeHistory(userId, 1000);

    const activeTrades = userTrades.filter((trade) =>
      ["pending", "entered", "partially_exited"].includes(trade.status)
    ).length;

    let totalActiveValue = 0;
    let totalPnL = 0;
    let completedTrades = 0;
    let winningTrades = 0;

    for (const trade of userTrades) {
      const performance = this.calculateTradePerformance(trade);

      if (!performance.isComplete) {
        totalActiveValue += parseFloat(trade.entryAmount) * trade.entryPrice;
      } else {
        completedTrades++;
        if (performance.totalPnL > 0) {
          winningTrades++;
        }
      }

      totalPnL += performance.totalPnL;
    }

    const averageReturn =
      completedTrades > 0
        ? userTrades
            .filter((trade) => this.calculateTradePerformance(trade).isComplete)
            .reduce(
              (sum, trade) =>
                sum + this.calculateTradePerformance(trade).percentageReturn,
              0
            ) / completedTrades
        : 0;

    const winRate =
      completedTrades > 0 ? (winningTrades / completedTrades) * 100 : 0;

    return {
      activeTrades,
      totalActiveValue,
      totalPnL,
      averageReturn,
      winRate,
      totalTrades: userTrades.length,
    };
  }

  private moveToHistory(tradeId: string): void {
    const trade = this.activeTrades.get(tradeId);
    if (trade) {
      this.tradeHistory.set(tradeId, trade);
      this.activeTrades.delete(tradeId);

      this.logger.info(
        `Moved trade ${tradeId} to history with status ${trade.status}`
      );
    }
  }

  clearOldHistory(daysToKeep: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    let removedCount = 0;

    for (const [tradeId, trade] of this.tradeHistory) {
      if (trade.updatedAt < cutoffDate) {
        this.tradeHistory.delete(tradeId);

        // Remove from user trades index
        const userTradeIds = this.userTrades.get(trade.userId);
        if (userTradeIds) {
          userTradeIds.delete(tradeId);
          if (userTradeIds.size === 0) {
            this.userTrades.delete(trade.userId);
          }
        }

        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger.info(`Cleared ${removedCount} old trades from history`);
    }

    return removedCount;
  }

  getStats(): {
    activeTrades: number;
    historicalTrades: number;
    queuedExecutions: number;
    uniqueUsers: number;
  } {
    return {
      activeTrades: this.activeTrades.size,
      historicalTrades: this.tradeHistory.size,
      queuedExecutions: this.executionQueue.length,
      uniqueUsers: this.userTrades.size,
    };
  }
}

export default TradeStateManager;
export { TradeEntry, TradeExitEvent, TradeExecutionPlan };
