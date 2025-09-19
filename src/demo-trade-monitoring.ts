/**
 * Demo Script: Trade Monitoring System in Action
 *
 * This script demonstrates how new trades are automatically detected
 * and monitored without requiring restarts or manual API calls.
 */

import express from "express";
import axios from "axios";
import { logger } from "./config/logger";

const SERVER_URL = "http://localhost:3006";

class TradeMonitoringDemo {
  private app: express.Application;

  constructor() {
    this.app = express();
    this.app.use(express.json());
  }

  async runDemo(): Promise<void> {
    try {
      logger.info("🎬 Starting Trade Monitoring Demo");

      // Step 1: Show initial system status
      await this.showSystemStatus("Initial System Status");

      // Step 2: Execute a new trade
      await this.executeNewTrade();

      // Step 3: Show system status after new trade
      await this.showSystemStatus("After New Trade Execution");

      // Step 4: Wait and show monitoring in action
      await this.demonstrateMonitoring();

      // Step 5: Show database sync in action
      await this.demonstrateDatabaseSync();

      logger.info("✅ Demo completed successfully!");
    } catch (error) {
      logger.error("❌ Demo failed:", error);
    }
  }

  private async showSystemStatus(title: string): Promise<void> {
    try {
      logger.info(`\n📊 ${title}`);
      logger.info("=" + "=".repeat(title.length + 4));

      const response = await axios.get(
        `${SERVER_URL}/api/trades/monitoring/status`
      );
      const status = response.data.monitoringStatus;

      logger.info(`🔹 Monitoring Running: ${status.isRunning}`);
      logger.info(`🔹 Active Trades: ${status.monitoredTradesCount}`);
      logger.info(`🔹 Price Check Interval: ${status.monitoringInterval}ms`);
      logger.info(`🔹 Database Sync Interval: ${status.dbSyncInterval}ms`);

      if (status.trades && status.trades.length > 0) {
        logger.info(`🔹 Current Trades:`);
        status.trades.forEach((trade: any, index: number) => {
          logger.info(
            `   ${index + 1}. ${trade.tradeId} (${trade.tokenSymbol}): $${trade.currentPrice || "N/A"} | TP1: $${trade.tp1} | SL: $${trade.sl}`
          );
        });
      } else {
        logger.info(`🔹 No active trades currently`);
      }
    } catch (error) {
      logger.error(`❌ Failed to get system status: ${error}`);
    }
  }

  private async executeNewTrade(): Promise<void> {
    try {
      logger.info(`\n💰 Executing New Trade`);
      logger.info("=" + "=".repeat(20));

      const tradeSignal = {
        "Signal Message": "buy",
        "Token Mentioned": "DEMO",
        TP1: 2500,
        TP2: 2600,
        SL: 2300,
        "Current Price": 2400,
        "Max Exit Time": {
          $date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }, // 2 hours from now
        username: "demo_user",
        safeAddress: "0x742d35Cc6634C0532925a3b8d02d8C61Aa542De9",
      };

      logger.info(`📝 Sending trade signal:`, {
        token: tradeSignal["Token Mentioned"],
        signal: tradeSignal["Signal Message"],
        price: tradeSignal["Current Price"],
        tp1: tradeSignal.TP1,
        sl: tradeSignal.SL,
      });

      const response = await axios.post(
        `${SERVER_URL}/api/signal/process`,
        tradeSignal
      );

      if (response.data.success) {
        logger.info(`✅ Trade executed successfully!`);
        logger.info(
          `📊 Trade will be automatically added to monitoring system`
        );
      } else {
        logger.error(`❌ Trade execution failed:`, response.data.error);
      }
    } catch (error) {
      logger.error(`❌ Failed to execute trade:`, error);
    }
  }

  private async demonstrateMonitoring(): Promise<void> {
    logger.info(`\n🔍 Demonstrating Real-time Monitoring`);
    logger.info("=" + "=".repeat(35));

    logger.info(`⏱️  Monitoring runs automatically every 30 seconds`);
    logger.info(`📈 Price checks happen in background`);
    logger.info(`🚨 Exit conditions are evaluated automatically`);

    // Show monitoring for a few cycles
    for (let i = 0; i < 3; i++) {
      logger.info(`\n⏳ Monitoring cycle ${i + 1}/3`);

      try {
        const response = await axios.get(`${SERVER_URL}/api/trades/active`);
        const activeTrades = response.data.activeTrades;

        if (activeTrades && activeTrades.length > 0) {
          activeTrades.forEach((trade: any) => {
            logger.info(
              `📊 ${trade.tradeId}: Current: $${trade.currentPrice || "Fetching..."} | Target: $${trade.tp1} | Stop: $${trade.sl}`
            );
          });
        }
      } catch (error) {
        logger.error(`Error getting active trades: ${error}`);
      }

      // Wait before next check
      if (i < 2) {
        logger.info(`⏸️  Waiting 10 seconds before next check...`);
        await new Promise((resolve) => setTimeout(resolve, 10000));
      }
    }
  }

  private async demonstrateDatabaseSync(): Promise<void> {
    logger.info(`\n🔄 Database Sync Demonstration`);
    logger.info("=" + "=".repeat(29));

    logger.info(`🗄️  Database sync runs every 60 seconds`);
    logger.info(`🔍 Checks for any trades that might have been missed`);
    logger.info(`➕ Automatically adds new trades to monitoring`);

    try {
      const historyResponse = await axios.get(
        `${SERVER_URL}/api/trades/history?limit=5`
      );
      const tradeHistory = historyResponse.data.trades;

      logger.info(`📚 Recent trade history (${tradeHistory.length} trades):`);
      tradeHistory.forEach((trade: any, index: number) => {
        logger.info(
          `   ${index + 1}. ${trade.tradeId || "Unknown"}: ${trade.tokenMentioned || "Unknown"} - ${trade.status} - ${new Date(trade.createdAt).toLocaleString()}`
        );
      });
    } catch (error) {
      logger.error(`Error getting trade history: ${error}`);
    }
  }
}

// API endpoints for testing
function setupTestEndpoints(demo: TradeMonitoringDemo): void {
  const app = (demo as any).app;

  // Test endpoint to simulate external trade addition
  app.post("/demo/add-external-trade", async (req, res) => {
    try {
      logger.info(`🔧 Simulating external trade addition to MongoDB...`);

      // In a real scenario, this would be an external system adding a trade directly to MongoDB
      // The database sync mechanism would pick it up within 60 seconds

      res.json({
        success: true,
        message: "External trade simulation completed",
        note: "Database sync will detect this within 60 seconds",
      });
    } catch (error) {
      res.status(500).json({ error: error });
    }
  });
}

// Main execution
async function runDemo() {
  const demo = new TradeMonitoringDemo();

  try {
    logger.info(`🎯 Trade Monitoring System Demo`);
    logger.info(`📍 Server URL: ${SERVER_URL}`);
    logger.info(`📝 This demo shows how trades are automatically monitored`);

    await demo.runDemo();
  } catch (error) {
    logger.error("❌ Demo execution failed:", error);
  }
}

// Export for use
export default TradeMonitoringDemo;

// Run demo if executed directly
if (require.main === module) {
  logger.info(`\n🚀 Starting Trade Monitoring Demo`);
  logger.info(`⚠️  Make sure your server is running on ${SERVER_URL}`);
  logger.info(`▶️  Run: npm run dev`);
  logger.info(`\n⏳ Starting demo in 3 seconds...\n`);

  setTimeout(() => {
    runDemo();
  }, 3000);
}
