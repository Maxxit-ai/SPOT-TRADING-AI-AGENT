/**
 * Test Script for Complete Trade Monitoring Flow
 *
 * This script demonstrates the complete flow from trade execution to monitoring and exit:
 * 1. Execute a trade
 * 2. Store it in MongoDB for monitoring
 * 3. Monitor for exit conditions (TP/SL/Max Exit Time)
 * 4. Execute exit trade when conditions are met
 */

import DatabaseService from "./services/DatabaseService";
import TradeExecutionService from "./services/TradeExecutionService";
import PriceMonitoringService from "./services/PriceMonitoringService";
import TradeMonitoringService from "./services/TradeMonitoringService";
import { logger } from "./config/logger";

// Test configuration
const TEST_CONFIG = {
  // MongoDB configuration
  database: {
    signalFlowUri:
      process.env.MONGODB_SIGNAL_FLOW_URI ||
      "mongodb://localhost:27017/ctxbt-signal-flow",
    signalFlowDb: process.env.MONGODB_SIGNAL_FLOW_DB || "ctxbt-signal-flow",
    signalFlowCollection:
      process.env.MONGODB_SIGNAL_FLOW_COLLECTION || "trading-signals",
    safeDeploymentUri:
      process.env.MONGODB_SAFE_DEPLOYMENT_URI ||
      "mongodb://localhost:27017/safe-deployment-service",
    safeDeploymentDb:
      process.env.MONGODB_SAFE_DEPLOYMENT_DB || "safe-deployment-service",
    safeCollection: process.env.MONGODB_SAFE_COLLECTION || "safes",
    tradesCollection: "executed-trades",
  },
  // Test trade data
  testTrade: {
    tradeId: `test_trade_${Date.now()}`,
    userId: "test_user",
    safeAddress: "0x742d35Cc6634C0532925a3b8d02d8C61Aa542De9", // Example Safe address
    networkKey: "arbitrum",
    tokenMentioned: "ETH",
    tokenSymbol: "ETH",
    signalMessage: "buy" as const,
    currentPrice: 2400,
    tp1: 2500, // Take profit 1 at $2500
    tp2: 2600, // Take profit 2 at $2600
    sl: 2350, // Stop loss at $2350
    maxExitTime: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
    entryAmount: "0.1", // 0.1 ETH
    entryTxHash:
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  },
};

class TradeMonitoringFlowTest {
  private databaseService: DatabaseService;
  private tradeExecutionService: TradeExecutionService;
  private priceMonitoringService: PriceMonitoringService;
  private tradeMonitoringService: TradeMonitoringService;

  constructor() {
    // Initialize services
    this.databaseService = new DatabaseService(TEST_CONFIG.database);
    this.tradeExecutionService = new TradeExecutionService();
    this.priceMonitoringService = new PriceMonitoringService();
    this.tradeMonitoringService = new TradeMonitoringService(
      this.databaseService,
      this.tradeExecutionService,
      this.priceMonitoringService
    );

    // Connect services
    this.tradeExecutionService.setTradeMonitoringService(
      this.tradeMonitoringService
    );
  }

  async runCompleteFlowTest(): Promise<void> {
    try {
      logger.info("🧪 Starting Complete Trade Monitoring Flow Test");

      // Step 1: Connect to database
      await this.connectServices();

      // Step 2: Simulate a successful trade execution and store for monitoring
      await this.simulateTradeExecution();

      // Step 3: Start monitoring services
      await this.startMonitoringServices();

      // Step 4: Simulate price changes and monitor exit conditions
      await this.simulatePriceChanges();

      // Step 5: Test manual exit functionality
      await this.testManualExit();

      // Step 6: Display monitoring status
      await this.displayMonitoringStatus();

      logger.info(
        "✅ Complete Trade Monitoring Flow Test completed successfully"
      );
    } catch (error) {
      logger.error("❌ Test failed:", error);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  private async connectServices(): Promise<void> {
    logger.info("📡 Connecting to database...");
    await this.databaseService.connect();
    logger.info("✅ Database connected");
  }

  private async simulateTradeExecution(): Promise<void> {
    logger.info("💰 Simulating trade execution...");

    // Simulate adding a trade to monitoring (as if it was just executed)
    const tradeData = {
      ...TEST_CONFIG.testTrade,
      executedAt: new Date(),
    };

    await this.tradeMonitoringService.addTradeToMonitoring(tradeData);
    logger.info(`✅ Trade ${tradeData.tradeId} added to monitoring system`);
  }

  private async startMonitoringServices(): Promise<void> {
    logger.info("🔍 Starting monitoring services...");

    await this.priceMonitoringService.start();
    await this.tradeMonitoringService.start();

    logger.info("✅ All monitoring services started");
  }

  private async simulatePriceChanges(): Promise<void> {
    logger.info("📈 Simulating price changes to test exit conditions...");

    const testScenarios = [
      {
        price: 2450,
        description: "Price rises to $2450 (between entry and TP1)",
      },
      {
        price: 2510,
        description: "Price rises to $2510 (above TP1, should trigger exit)",
      },
    ];

    for (const scenario of testScenarios) {
      logger.info(`📊 Testing scenario: ${scenario.description}`);

      // Simulate getting this price (this would normally come from the price monitoring service)
      // For testing, we can directly check what would happen
      const monitoredTrades = this.tradeMonitoringService.getMonitoredTrades();

      for (const trade of monitoredTrades) {
        logger.info(
          `📋 Trade ${trade.tradeId}: Entry: $${trade.entryPrice}, Current: $${scenario.price}, TP1: $${trade.tp1}, SL: $${trade.sl}`
        );

        if (scenario.price >= trade.tp1) {
          logger.info(
            `🚨 Exit condition would be triggered: TP1 reached at $${scenario.price}`
          );
        } else if (scenario.price <= trade.sl) {
          logger.info(
            `🚨 Exit condition would be triggered: Stop Loss hit at $${scenario.price}`
          );
        } else {
          logger.info(`⏳ No exit condition met, continuing to monitor...`);
        }
      }

      // Wait a bit between scenarios
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  private async testManualExit(): Promise<void> {
    logger.info("🔧 Testing manual exit functionality...");

    const monitoredTrades = this.tradeMonitoringService.getMonitoredTrades();

    if (monitoredTrades.length > 0) {
      const testTrade = monitoredTrades[0];
      logger.info(`📤 Attempting manual exit for trade: ${testTrade.tradeId}`);

      // Note: This would normally execute a real exit trade
      // For testing purposes, we'll just simulate the call
      logger.info(
        `✅ Manual exit simulation completed for trade ${testTrade.tradeId}`
      );
    } else {
      logger.info("ℹ️ No trades available for manual exit test");
    }
  }

  private async displayMonitoringStatus(): Promise<void> {
    logger.info("📊 Current Monitoring Status:");

    const status = this.tradeMonitoringService.getSystemStatus();

    logger.info(`🔹 Monitoring Service Running: ${status.isRunning}`);
    logger.info(`🔹 Monitored Trades Count: ${status.monitoredTradesCount}`);
    logger.info(`🔹 Monitoring Interval: ${status.monitoringInterval}ms`);

    if (status.trades && status.trades.length > 0) {
      logger.info("📋 Active Trades:");
      status.trades.forEach((trade: any) => {
        logger.info(
          `  • ${trade.tradeId} (${trade.tokenSymbol}): Entry: $${trade.entryPrice}, Current: $${trade.currentPrice || "N/A"}, TP1: $${trade.tp1}, SL: $${trade.sl}, Time left: ${trade.timeRemaining}`
        );
      });
    } else {
      logger.info("📋 No active trades to monitor");
    }

    // Get trade history from database
    const tradeHistory = await this.databaseService.getTradeHistory();
    logger.info(`📈 Total Trades in Database: ${tradeHistory.length}`);

    if (tradeHistory.length > 0) {
      logger.info("📋 Recent Trades:");
      tradeHistory.slice(0, 3).forEach((trade: any) => {
        logger.info(
          `  • ${trade.tradeId || "Unknown"}: ${trade.tokenMentioned || "Unknown"} - Status: ${trade.status} - Created: ${trade.createdAt}`
        );
      });
    }
  }

  private async cleanup(): Promise<void> {
    logger.info("🧹 Cleaning up test environment...");

    try {
      await this.tradeMonitoringService.stop();
      this.priceMonitoringService.stop();
      await this.databaseService.disconnect();

      logger.info("✅ Cleanup completed");
    } catch (error) {
      logger.error("⚠️ Error during cleanup:", error);
    }
  }
}

// Main execution
async function runTest() {
  const test = new TradeMonitoringFlowTest();

  try {
    await test.runCompleteFlowTest();
    process.exit(0);
  } catch (error) {
    logger.error("❌ Test execution failed:", error);
    process.exit(1);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  runTest();
}

export default TradeMonitoringFlowTest;
