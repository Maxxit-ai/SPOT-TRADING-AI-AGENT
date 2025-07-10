import { ethers } from "ethers";
import { logger } from "../config/logger";
import { NetworkUtils } from "../utils/NetworkUtils";
import { TokenChainInfo } from "./TokenChainDetectionService";

export interface BalanceInfo {
  tokenSymbol: string;
  tokenAddress: string;
  balance: string;
  balanceFormatted: string;
  decimals: number;
  usdValue?: number;
}

export interface PositionSizeCalculation {
  success: boolean;
  originalBalance: BalanceInfo;
  positionSizePercentage: number;
  positionSizeFormatted: string;
  positionSizeWei: string;
  positionSizeUsd?: number;
  minimumRequired: string;
  meetsMinimum: boolean;
  gasFeeEstimate: string;
  availableAfterGas: string;
  error?: string;
  recommendedAction?: string;
}

export interface PositionSizingConfig {
  defaultPercentage: number; // e.g., 20 for 20%
  minimumUsdAmount: number; // e.g., 0.01 USD minimum
  minimumGasReserve: string; // e.g., "0.001" ETH for gas
  maxPositionPercentage: number; // e.g., 80 for max 80%
}

/**
 * Position Sizing Service
 *
 * This service calculates dynamic position sizes based on:
 * 1. Safe balance of base trading token (USDC)
 * 2. User-defined percentage (default 20%)
 * 3. Minimum amount requirements
 * 4. Gas fee considerations
 * 5. DEX and Safe minimum limits
 */
export class PositionSizingService {
  private defaultConfig: PositionSizingConfig = {
    defaultPercentage: 20, // 20% of balance
    minimumUsdAmount: 0.01, // $0.01 minimum for testing
    minimumGasReserve: "0.001", // 0.001 ETH for gas
    maxPositionPercentage: 80, // Max 80% of balance
  };

  constructor(config?: Partial<PositionSizingConfig>) {
    if (config) {
      this.defaultConfig = { ...this.defaultConfig, ...config };
    }
  }

  /**
   * Calculate position size for trading
   */
  async calculatePositionSize(
    safeAddress: string,
    baseTokenSymbol: string, // e.g., "USDC"
    tokenChainInfo: TokenChainInfo,
    positionPercentage?: number
  ): Promise<PositionSizeCalculation> {
    try {
      const percentage =
        positionPercentage || this.defaultConfig.defaultPercentage;

      logger.info(
        `💰 Calculating ${percentage}% position size for Safe ${safeAddress}`
      );

      // Validate percentage
      if (
        percentage <= 0 ||
        percentage > this.defaultConfig.maxPositionPercentage
      ) {
        return {
          success: false,
          originalBalance: {} as BalanceInfo,
          positionSizePercentage: percentage,
          positionSizeFormatted: "0",
          positionSizeWei: "0",
          minimumRequired: "0",
          meetsMinimum: false,
          gasFeeEstimate: "0",
          availableAfterGas: "0",
          error: `Invalid percentage: ${percentage}%. Must be between 1-${this.defaultConfig.maxPositionPercentage}%`,
          recommendedAction: `Use a percentage between 1-${this.defaultConfig.maxPositionPercentage}%`,
        };
      }

      // Step 1: Get base token balance
      const balanceInfo = await this.getTokenBalance(
        safeAddress,
        baseTokenSymbol,
        tokenChainInfo
      );

      if (!balanceInfo.success) {
        return this.createFailureResult(
          percentage,
          balanceInfo.error || "Failed to get token balance",
          `Ensure Safe ${safeAddress} has ${baseTokenSymbol} balance on ${tokenChainInfo.networkKey}`
        );
      }

      // Step 2: Calculate gas fee reserve if trading native token
      const gasReserve = await this.calculateGasReserve(
        safeAddress,
        tokenChainInfo,
        baseTokenSymbol
      );

      // Step 3: Calculate available balance after gas
      const availableBalance = this.calculateAvailableBalance(
        balanceInfo.balance,
        gasReserve,
        balanceInfo.decimals
      );

      // Step 4: Calculate position size
      const positionSizeWei = this.calculatePercentageAmount(
        availableBalance,
        percentage
      );

      const positionSizeFormatted = ethers.formatUnits(
        positionSizeWei,
        balanceInfo.decimals
      );

      // Step 5: Check minimum requirements
      const meetsMinimum = await this.checkMinimumRequirements(
        positionSizeFormatted,
        baseTokenSymbol,
        tokenChainInfo
      );

      // Step 6: Get USD value if possible
      const positionSizeUsd = await this.getUsdValue(
        positionSizeFormatted,
        baseTokenSymbol
      );

      const result: PositionSizeCalculation = {
        success: true,
        originalBalance: {
          tokenSymbol: baseTokenSymbol,
          tokenAddress: balanceInfo.tokenAddress,
          balance: balanceInfo.balance,
          balanceFormatted: ethers.formatUnits(
            balanceInfo.balance,
            balanceInfo.decimals
          ),
          decimals: balanceInfo.decimals,
          usdValue: balanceInfo.usdValue,
        },
        positionSizePercentage: percentage,
        positionSizeFormatted,
        positionSizeWei,
        positionSizeUsd,
        minimumRequired: this.defaultConfig.minimumUsdAmount.toString(),
        meetsMinimum: meetsMinimum.meetsMinimum,
        gasFeeEstimate: ethers.formatEther(gasReserve),
        availableAfterGas: ethers.formatUnits(
          availableBalance,
          balanceInfo.decimals
        ),
        recommendedAction: meetsMinimum.meetsMinimum
          ? "Position size is valid for trading"
          : meetsMinimum.recommendedAction,
      };

      logger.info(`🔍 Final result debug:`, {
        positionSize: positionSizeFormatted,
        minimumCheckResult: meetsMinimum.meetsMinimum,
        finalMeetsMinimum: result.meetsMinimum,
        success: result.success,
      });

      logger.info(
        `✅ Position size calculated: ${positionSizeFormatted} ${baseTokenSymbol} (${percentage}% of ${ethers.formatUnits(balanceInfo.balance, balanceInfo.decimals)} ${baseTokenSymbol})`
      );

      return result;
    } catch (error) {
      logger.error(`❌ Position size calculation failed:`, error);
      return this.createFailureResult(
        positionPercentage || this.defaultConfig.defaultPercentage,
        error instanceof Error ? error.message : "Unknown error",
        "Please check Safe address and network configuration"
      );
    }
  }

  /**
   * Get token balance for Safe
   */
  private async getTokenBalance(
    safeAddress: string,
    tokenSymbol: string,
    tokenChainInfo: TokenChainInfo
  ): Promise<{
    success: boolean;
    balance?: string;
    tokenAddress?: string;
    decimals?: number;
    usdValue?: number;
    error?: string;
  }> {
    try {
      const network = NetworkUtils.getNetworkByKey(tokenChainInfo.networkKey);
      if (!network) {
        return {
          success: false,
          error: `Network ${tokenChainInfo.networkKey} not supported`,
        };
      }

      const tokenAddress = NetworkUtils.getTokenAddress(
        tokenSymbol,
        tokenChainInfo.networkKey
      );
      if (!tokenAddress) {
        const availableNetworks = Object.keys(
          NetworkUtils.getTokenInfo(tokenSymbol)?.addresses || {}
        );
        return {
          success: false,
          error: `${tokenSymbol} not available on ${tokenChainInfo.networkKey}. Available networks: ${availableNetworks.join(", ")}`,
        };
      }

      logger.info(
        `🔍 Getting ${tokenSymbol} balance from ${tokenChainInfo.networkKey}`,
        {
          tokenAddress:
            tokenAddress.slice(0, 6) + "..." + tokenAddress.slice(-4),
          safeAddress: safeAddress.slice(0, 6) + "..." + safeAddress.slice(-4),
          network: tokenChainInfo.networkKey,
        }
      );

      const provider = new ethers.JsonRpcProvider(network.rpcUrl);
      let balance: bigint;
      let decimals: number;

      // Check if it's a native token
      if (
        tokenAddress === "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" ||
        tokenAddress === ethers.ZeroAddress
      ) {
        // Native token (ETH, MATIC, etc.)
        balance = await provider.getBalance(safeAddress);
        decimals = 18;
      } else {
        // ERC20 token
        const tokenContract = new ethers.Contract(
          tokenAddress,
          [
            "function balanceOf(address) view returns (uint256)",
            "function decimals() view returns (uint8)",
          ],
          provider
        );

        [balance, decimals] = await Promise.all([
          tokenContract.balanceOf(safeAddress),
          tokenContract.decimals(),
        ]);
      }

      // Get USD value
      const usdValue = await this.getUsdValue(
        ethers.formatUnits(balance, decimals),
        tokenSymbol
      );

      return {
        success: true,
        balance: balance.toString(),
        tokenAddress,
        decimals,
        usdValue,
      };
    } catch (error) {
      logger.error(`Failed to get token balance:`, error);

      // Provide more specific error messages
      let errorMessage = "Unknown error";
      if (error instanceof Error) {
        if (error.message.includes("could not decode result data")) {
          errorMessage = `Contract not found or Safe not deployed on ${tokenChainInfo.networkKey}. Verify Safe deployment.`;
        } else if (error.message.includes("network")) {
          errorMessage = `Network error connecting to ${tokenChainInfo.networkKey}. Check RPC connection.`;
        } else {
          errorMessage = error.message;
        }
      }

      return {
        success: false,
        error: `Balance check failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Calculate gas reserve for trading operations
   */
  private async calculateGasReserve(
    safeAddress: string,
    tokenChainInfo: TokenChainInfo,
    baseTokenSymbol: string
  ): Promise<bigint> {
    try {
      // If we're trading native token, we need to reserve some for gas
      const isNativeToken = this.isNativeToken(
        baseTokenSymbol,
        tokenChainInfo.networkKey
      );

      if (isNativeToken) {
        // Reserve enough for multiple transactions (Safe operations are more expensive)
        return ethers.parseEther(this.defaultConfig.minimumGasReserve);
      }

      // For ERC20 tokens, no direct reserve needed from token balance
      return BigInt(0);
    } catch (error) {
      logger.warn(`Failed to calculate gas reserve:`, error);
      // Conservative fallback
      return ethers.parseEther("0.002");
    }
  }

  /**
   * Calculate available balance after gas reserve
   */
  private calculateAvailableBalance(
    totalBalance: string,
    gasReserve: bigint,
    decimals: number
  ): bigint {
    const totalBalanceBigInt = BigInt(totalBalance);

    // For ERC20 tokens (6 decimals like USDC), gas reserve is in ETH (18 decimals)
    // So we don't subtract it from the token balance
    if (decimals !== 18) {
      return totalBalanceBigInt;
    }

    // For native tokens (18 decimals), subtract gas reserve
    const availableBalance = totalBalanceBigInt - gasReserve;
    return availableBalance > 0 ? availableBalance : BigInt(0);
  }

  /**
   * Calculate percentage amount from balance
   */
  private calculatePercentageAmount(
    balance: bigint,
    percentage: number
  ): string {
    const percentageBigInt = BigInt(Math.floor(percentage * 100)); // Convert to basis points
    const positionSize = (balance * percentageBigInt) / BigInt(10000); // Divide by 10000 for percentage
    return positionSize.toString();
  }

  /**
   * Check if amount meets minimum requirements
   */
  private async checkMinimumRequirements(
    amount: string,
    tokenSymbol: string,
    tokenChainInfo: TokenChainInfo
  ): Promise<{ meetsMinimum: boolean; recommendedAction?: string }> {
    try {
      // Get USD value of the amount
      const usdValue = await this.getUsdValue(amount, tokenSymbol);

      logger.info(
        `🔍 Minimum check: ${amount} ${tokenSymbol} = $${usdValue} USD (min: $${this.defaultConfig.minimumUsdAmount})`,
        {
          amount: amount,
          tokenSymbol: tokenSymbol,
          usdValue: usdValue,
          minimumRequired: this.defaultConfig.minimumUsdAmount,
          meetsMinimum: usdValue
            ? usdValue >= this.defaultConfig.minimumUsdAmount
            : false,
        }
      );

      if (usdValue < this.defaultConfig.minimumUsdAmount) {
        return {
          meetsMinimum: false,
          recommendedAction: `Increase position size. Minimum required: $${this.defaultConfig.minimumUsdAmount} USD. Current: $${usdValue?.toFixed(6) || "0"} USD`,
        };
      }

      // Check DEX specific minimums (0x Protocol typically has low minimums)
      const dexMinimum = this.getDexMinimumAmount(
        tokenSymbol,
        tokenChainInfo.networkKey
      );
      const amountNum = parseFloat(amount);

      if (amountNum < dexMinimum) {
        return {
          meetsMinimum: false,
          recommendedAction: `Amount below DEX minimum. Required: ${dexMinimum} ${tokenSymbol}, Current: ${amount} ${tokenSymbol}`,
        };
      }

      return { meetsMinimum: true };
    } catch (error) {
      logger.warn(`Failed to check minimum requirements:`, error);
      return {
        meetsMinimum: false,
        recommendedAction:
          "Could not validate minimum requirements. Please verify amount manually.",
      };
    }
  }

  /**
   * Get USD value of token amount
   */
  private async getUsdValue(
    amount: string,
    tokenSymbol: string
  ): Promise<number | undefined> {
    try {
      // For stablecoins, assume 1:1 USD
      if (["USDC", "USDT", "DAI", "BUSD"].includes(tokenSymbol.toUpperCase())) {
        return parseFloat(amount);
      }

      // For other tokens, could integrate with price APIs
      // For now, return undefined for non-stablecoins
      return undefined;
    } catch (error) {
      logger.warn(`Failed to get USD value for ${tokenSymbol}:`, error);
      return undefined;
    }
  }

  /**
   * Check if token is native to the network
   */
  private isNativeToken(tokenSymbol: string, networkKey: string): boolean {
    const nativeTokens: Record<string, string> = {
      ethereum: "ETH",
      arbitrum: "ETH",
      polygon: "MATIC",
      base: "ETH",
      optimism: "ETH",
    };

    return nativeTokens[networkKey] === tokenSymbol.toUpperCase();
  }

  /**
   * Get DEX minimum amount for token
   */
  private getDexMinimumAmount(tokenSymbol: string, networkKey: string): number {
    // Conservative minimums for different tokens/networks
    const minimums: Record<string, number> = {
      USDC: 0.01, // $0.01 minimum
      USDT: 0.01, // $0.01 minimum
      ETH: 0.001, // 0.001 ETH minimum
      WETH: 0.001, // 0.001 WETH minimum
      MATIC: 0.01, // 0.01 MATIC minimum
    };

    return minimums[tokenSymbol.toUpperCase()] || 0.01; // Default 0.01 token minimum
  }

  /**
   * Create failure result
   */
  private createFailureResult(
    percentage: number,
    error: string,
    recommendedAction: string
  ): PositionSizeCalculation {
    return {
      success: false,
      originalBalance: {} as BalanceInfo,
      positionSizePercentage: percentage,
      positionSizeFormatted: "0",
      positionSizeWei: "0",
      minimumRequired: this.defaultConfig.minimumUsdAmount.toString(),
      meetsMinimum: false,
      gasFeeEstimate: "0",
      availableAfterGas: "0",
      error,
      recommendedAction,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<PositionSizingConfig>): void {
    this.defaultConfig = { ...this.defaultConfig, ...newConfig };
    logger.info(`📊 Position sizing config updated:`, newConfig);
  }

  /**
   * Get current configuration
   */
  getConfig(): PositionSizingConfig {
    return { ...this.defaultConfig };
  }

  /**
   * Get position sizing summary for debugging
   */
  async getPositioningSummary(
    safeAddress: string,
    baseTokenSymbol: string,
    tokenChainInfo: TokenChainInfo,
    positionPercentage?: number
  ): Promise<string> {
    const calculation = await this.calculatePositionSize(
      safeAddress,
      baseTokenSymbol,
      tokenChainInfo,
      positionPercentage
    );

    let summary = `💰 Position Sizing Summary\n\n`;
    summary += `📍 Safe: ${safeAddress}\n`;
    summary += `🌐 Network: ${tokenChainInfo.networkKey}\n`;
    summary += `🪙 Base Token: ${baseTokenSymbol}\n`;
    summary += `📊 Percentage: ${calculation.positionSizePercentage}%\n\n`;

    if (calculation.success) {
      summary += `💳 Original Balance: ${calculation.originalBalance.balanceFormatted} ${baseTokenSymbol}\n`;
      summary += `⛽ Gas Reserve: ${calculation.gasFeeEstimate} ETH\n`;
      summary += `💵 Available: ${calculation.availableAfterGas} ${baseTokenSymbol}\n`;
      summary += `🎯 Position Size: ${calculation.positionSizeFormatted} ${baseTokenSymbol}\n`;

      if (calculation.positionSizeUsd) {
        summary += `💲 USD Value: $${calculation.positionSizeUsd.toFixed(2)}\n`;
      }

      summary += `✅ Meets Minimum: ${calculation.meetsMinimum ? "Yes" : "No"}\n`;
    } else {
      summary += `❌ Error: ${calculation.error}\n`;
    }

    summary += `\n💡 Recommendation: ${calculation.recommendedAction}`;

    return summary;
  }
}

export default PositionSizingService;
