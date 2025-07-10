import axios from "axios";
import { EventEmitter } from "events";
import { logger } from "../config/logger";
import { NetworkUtils } from "../utils/NetworkUtils";

interface PriceData {
  price: number;
  timestamp: Date;
  change24h?: number;
  volume24h?: number;
}

interface PriceAlert {
  tokenId: string;
  targetPrice: number;
  direction: "above" | "below";
  callback: (currentPrice: number) => void;
}

interface TradeMonitoringConfig {
  tradeId: string;
  tokenId: string;
  entryPrice: number;
  tp1: number;
  tp2: number;
  stopLoss: number;
  maxExitTime: Date;
  trailingStopEnabled: boolean;
  trailingStopRetracement: number;
}

class PriceMonitoringService extends EventEmitter {
  private logger = logger;
  private priceCache: Map<string, PriceData> = new Map();
  private priceAlerts: PriceAlert[] = [];
  private tradeMonitoringConfigs: Map<string, TradeMonitoringConfig> =
    new Map();
  private monitoringInterval: NodeJS.Timeout | null = null;
  private readonly MONITORING_INTERVAL_MS = 30000; // 30 seconds
  private readonly COINGECKO_API_BASE = "https://api.coingecko.com/api/v3";
  private trailingHighs: Map<string, number> = new Map(); // Track highest prices for trailing stops

  constructor() {
    super();
  }

  async start(): Promise<void> {
    if (this.monitoringInterval) {
      this.logger.warn("Price monitoring already started");
      return;
    }

    this.logger.info("Starting price monitoring service");
    this.monitoringInterval = setInterval(
      () => this.monitorPrices(),
      this.MONITORING_INTERVAL_MS
    );

    // Initial price fetch
    await this.monitorPrices();
  }

  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.logger.info("Price monitoring service stopped");
    }
  }

  async getCurrentPrice(tokenSymbol: string): Promise<number | null> {
    try {
      const tokenInfo = NetworkUtils.getTokenInfo(tokenSymbol);
      if (!tokenInfo) {
        this.logger.error(`Token info not found for ${tokenSymbol}`);
        return null;
      }

      const response = await axios.get(
        `${this.COINGECKO_API_BASE}/simple/price?ids=${tokenInfo.coingeckoId}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true`,
        { timeout: 10000 }
      );

      const data = response.data[tokenInfo.coingeckoId];
      if (!data) {
        this.logger.error(`Price data not found for ${tokenSymbol}`);
        return null;
      }

      const priceData: PriceData = {
        price: data.usd,
        timestamp: new Date(),
        change24h: data.usd_24h_change,
        volume24h: data.usd_24h_vol,
      };

      this.priceCache.set(tokenSymbol, priceData);
      return data.usd;
    } catch (error) {
      this.logger.error(`Error fetching price for ${tokenSymbol}:`, error);
      return null;
    }
  }

  getCachedPrice(tokenSymbol: string): PriceData | null {
    return this.priceCache.get(tokenSymbol) || null;
  }

  addTradeMonitoring(config: TradeMonitoringConfig): void {
    this.tradeMonitoringConfigs.set(config.tradeId, config);
    this.logger.info(
      `Added trade monitoring for ${config.tradeId} (${config.tokenId})`
    );

    // Initialize trailing high if trailing stop is enabled
    if (config.trailingStopEnabled) {
      this.trailingHighs.set(config.tradeId, config.entryPrice);
    }
  }

  removeTradeMonitoring(tradeId: string): void {
    this.tradeMonitoringConfigs.delete(tradeId);
    this.trailingHighs.delete(tradeId);
    this.logger.info(`Removed trade monitoring for ${tradeId}`);
  }

  addPriceAlert(alert: PriceAlert): void {
    this.priceAlerts.push(alert);
    this.logger.info(
      `Added price alert for ${alert.tokenId} ${alert.direction} ${alert.targetPrice}`
    );
  }

  private async monitorPrices(): Promise<void> {
    try {
      // Get unique token IDs that need monitoring
      const tokenIds = new Set<string>();

      // Add tokens from trade monitoring
      this.tradeMonitoringConfigs.forEach((config) => {
        tokenIds.add(config.tokenId);
      });

      // Add tokens from price alerts
      this.priceAlerts.forEach((alert) => {
        tokenIds.add(alert.tokenId);
      });

      if (tokenIds.size === 0) {
        return; // Nothing to monitor
      }

      // Fetch prices for all monitored tokens
      await Promise.allSettled(
        Array.from(tokenIds).map((tokenId) => this.getCurrentPrice(tokenId))
      );

      // Check trade conditions
      await this.checkTradeConditions();

      // Check price alerts
      await this.checkPriceAlerts();
    } catch (error) {
      this.logger.error("Error in price monitoring:", error);
    }
  }

  private async checkTradeConditions(): Promise<void> {
    for (const [tradeId, config] of this.tradeMonitoringConfigs) {
      try {
        const currentPrice = await this.getCurrentPrice(config.tokenId);
        if (currentPrice === null) {
          continue;
        }

        const now = new Date();
        let exitCondition: string | null = null;

        // Check max exit time
        if (now >= config.maxExitTime) {
          exitCondition = "MAX_EXIT_TIME";
        }
        // Check stop loss
        else if (currentPrice <= config.stopLoss) {
          exitCondition = "STOP_LOSS";
        }
        // Check TP1
        else if (currentPrice >= config.tp1) {
          // Update trailing high for trailing stop
          if (config.trailingStopEnabled) {
            const currentHigh =
              this.trailingHighs.get(tradeId) || config.entryPrice;
            if (currentPrice > currentHigh) {
              this.trailingHighs.set(tradeId, currentPrice);
            }

            // Check if TP2 was hit and then trailing stop triggered
            if (currentPrice >= config.tp2) {
              const trailingHigh =
                this.trailingHighs.get(tradeId) || currentPrice;
              const trailingStopPrice =
                trailingHigh * (1 - config.trailingStopRetracement / 100);

              if (currentPrice <= trailingStopPrice) {
                exitCondition = "TRAILING_STOP";
              }
            }
          }

          // If not trailing stop exit, check for TP targets
          if (!exitCondition) {
            if (currentPrice >= config.tp2) {
              exitCondition = "TP2";
            } else {
              exitCondition = "TP1";
            }
          }
        }

        if (exitCondition) {
          this.logger.info(
            `Trade ${tradeId} exit condition met: ${exitCondition} at price ${currentPrice}`
          );

          this.emit("tradeExit", {
            tradeId,
            exitCondition,
            exitPrice: currentPrice,
            config,
          });

          // Remove from monitoring
          this.removeTradeMonitoring(tradeId);
        }
      } catch (error) {
        this.logger.error(
          `Error checking trade conditions for ${tradeId}:`,
          error
        );
      }
    }
  }

  private async checkPriceAlerts(): Promise<void> {
    const alertsToRemove: number[] = [];

    for (let i = 0; i < this.priceAlerts.length; i++) {
      const alert = this.priceAlerts[i];
      try {
        const currentPrice = await this.getCurrentPrice(alert.tokenId);
        if (currentPrice === null) {
          continue;
        }

        let alertTriggered = false;
        if (alert.direction === "above" && currentPrice >= alert.targetPrice) {
          alertTriggered = true;
        } else if (
          alert.direction === "below" &&
          currentPrice <= alert.targetPrice
        ) {
          alertTriggered = true;
        }

        if (alertTriggered) {
          this.logger.info(
            `Price alert triggered for ${alert.tokenId}: ${currentPrice} ${alert.direction} ${alert.targetPrice}`
          );
          alert.callback(currentPrice);
          alertsToRemove.push(i);
        }
      } catch (error) {
        this.logger.error(
          `Error checking price alert for ${alert.tokenId}:`,
          error
        );
      }
    }

    // Remove triggered alerts
    for (let i = alertsToRemove.length - 1; i >= 0; i--) {
      this.priceAlerts.splice(alertsToRemove[i], 1);
    }
  }

  getMonitoredTrades(): Map<string, TradeMonitoringConfig> {
    return new Map(this.tradeMonitoringConfigs);
  }

  getTradeStatus(tradeId: string): any {
    const config = this.tradeMonitoringConfigs.get(tradeId);
    if (!config) {
      return null;
    }

    const priceData = this.getCachedPrice(config.tokenId);
    const trailingHigh = this.trailingHighs.get(tradeId);

    return {
      tradeId,
      tokenId: config.tokenId,
      entryPrice: config.entryPrice,
      currentPrice: priceData?.price || null,
      tp1: config.tp1,
      tp2: config.tp2,
      stopLoss: config.stopLoss,
      trailingHigh,
      maxExitTime: config.maxExitTime,
      timeRemaining: config.maxExitTime.getTime() - Date.now(),
      lastUpdate: priceData?.timestamp || null,
    };
  }
}

export default PriceMonitoringService;
export { PriceData, PriceAlert, TradeMonitoringConfig };
