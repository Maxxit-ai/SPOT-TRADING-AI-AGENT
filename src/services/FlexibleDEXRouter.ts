import { ethers } from "ethers";
import axios from "axios";
import { logger } from "../config/logger";
import { NetworkConfig } from "../config/networks";

interface QuoteRequest {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  safeAddress: string;
  slippage?: number;
}

interface QuoteResponse {
  aggregator: string;
  amountOut: string;
  gasEstimate: string;
  executionData: {
    to: string;
    data: string;
    value: string;
  };
  confidence: number;
}

/**
 * Simple, flexible DEX router that can easily add new aggregators
 * Currently uses 0x Protocol (which already includes 100+ DEXs)
 * Future: Easy to add other aggregators when needed
 */
export class FlexibleDEXRouter {
  private enabledAggregators: Set<string>;

  constructor() {
    // Start simple - just 0x Protocol (which gives you everything!)
    this.enabledAggregators = new Set(["zerox"]);
    logger.info("FlexibleDEXRouter initialized with 0x Protocol");
  }

  /**
   * Get the best quote (currently from 0x, easily extensible)
   */
  async getBestQuote(request: QuoteRequest): Promise<QuoteResponse> {
    try {
      logger.info(
        `Getting quote: ${request.amountIn} ${request.tokenIn} -> ${request.tokenOut}`
      );

      // For now, just use 0x (which is excellent!)
      if (this.enabledAggregators.has("zerox")) {
        const quote = await this.get0xQuote(request);
        if (quote) {
          logger.info(`✅ Best quote from 0x: ${quote.amountOut} output`);
          return quote;
        }
      }

      // Future: Easy to add more aggregators here
      // if (this.enabledAggregators.has('oneinch')) {
      //   const quote = await this.get1inchQuote(request);
      //   // Compare and select best...
      // }

      throw new Error("No valid quotes available");
    } catch (error) {
      logger.error(`Quote retrieval failed: ${error}`);
      throw error;
    }
  }

  /**
   * 0x Protocol quote (already perfect for your needs!)
   */
  private async get0xQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse | null> {
    try {
      const response = await axios.get("https://api.0x.org/swap/v1/quote", {
        params: {
          sellToken: request.tokenIn,
          buyToken: request.tokenOut,
          sellAmount: request.amountIn,
          takerAddress: request.safeAddress,
          slippagePercentage: (request.slippage || 0.5) / 100,
        },
        headers: {
          "0x-api-key": process.env["ZEROX_API_KEY"],
        },
        timeout: 5000,
      });

      return {
        aggregator: "0x_protocol",
        amountOut: response.data.buyAmount,
        gasEstimate: response.data.gas,
        executionData: {
          to: response.data.to,
          data: response.data.data,
          value: response.data.value || "0",
        },
        confidence: 0.95, // High confidence - 0x is very reliable
      };
    } catch (error) {
      logger.warn(`0x Protocol quote failed: ${error}`);
      return null;
    }
  }

  /**
   * Easy way to add more aggregators in the future
   */
  enableAggregator(aggregatorName: string): void {
    this.enabledAggregators.add(aggregatorName);
    logger.info(`✅ Enabled aggregator: ${aggregatorName}`);
  }

  disableAggregator(aggregatorName: string): void {
    this.enabledAggregators.delete(aggregatorName);
    logger.info(`❌ Disabled aggregator: ${aggregatorName}`);
  }

  getEnabledAggregators(): string[] {
    return Array.from(this.enabledAggregators);
  }

  /**
   * Future: Easy to add 1inch when you want more options
   */
  private async get1inchQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse | null> {
    // Implementation would go here when you're ready
    // For now, just return null
    return null;
  }

  /**
   * Future: Easy to add any other aggregator
   */
  private async getCustomAggregatorQuote(
    request: QuoteRequest
  ): Promise<QuoteResponse | null> {
    // Implementation would go here when you're ready
    return null;
  }
}

export default FlexibleDEXRouter;
