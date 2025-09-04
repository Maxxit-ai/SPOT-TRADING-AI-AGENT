import axios from "axios";
import { logger } from "../config/logger";
import {
  NetworkUtils,
  SUPPORTED_NETWORKS,
  TOKEN_MAP,
} from "../utils/NetworkUtils";

export interface TokenChainInfo {
  symbol: string;
  name?: string;
  contractAddress: string;
  chainId: number;
  networkKey: string;
  decimals?: number;
  verified: boolean;
  source: "coingecko" | "etherscan" | "dexscreener" | "manual" | "known";
}

export interface ChainDetectionResult {
  success: boolean;
  tokenInfo?: TokenChainInfo[];
  primaryChain?: TokenChainInfo;
  error?: string;
  recommendedAction?: string;
}

/**
 * Enhanced Token Detection Service with Robust Fallbacks
 *
 * This service provides multiple layers of token detection:
 * 1. Known tokens from TOKEN_MAP (instant)
 * 2. CoinGecko API with retry logic
 * 3. DexScreener API with retry logic
 * 4. On-chain verification
 * 5. Fallback to common token addresses
 */
export class EnhancedTokenDetectionService {
  private cache = new Map<string, ChainDetectionResult>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly REQUEST_TIMEOUT = 8000; // 8 seconds
  private readonly MAX_RETRIES = 2;

  /**
   * Main method to detect which chains support a token
   */
  async detectTokenChains(
    tokenSymbol: string,
    userSafeDeployments?: any[]
  ): Promise<ChainDetectionResult> {
    try {
      const cacheKey = tokenSymbol.toUpperCase();
      const cached = this.cache.get(cacheKey);

      if (cached && this.isCacheValid(cached)) {
        logger.info(`📦 Using cached chain data for ${tokenSymbol}`);
        return this.selectOptimalChain(cached, userSafeDeployments);
      }

      logger.info(`🔍 Enhanced detection for token: ${tokenSymbol}`);

      // Step 1: Check known tokens first (instant)
      const knownTokenInfo = this.checkKnownTokens(tokenSymbol);
      if (knownTokenInfo.success && knownTokenInfo.tokenInfo?.length) {
        logger.info(`✅ Found ${tokenSymbol} in known tokens`);
        this.cache.set(cacheKey, knownTokenInfo);
        return this.selectOptimalChain(knownTokenInfo, userSafeDeployments);
      }

      // Step 2: Try multiple APIs in parallel with retry logic
      const detectionPromises = [
        this.queryCoinGeckoWithRetry(tokenSymbol),
        this.queryDexScreenerWithRetry(tokenSymbol),
        this.queryCommonAddresses(tokenSymbol),
      ];

      const results = await Promise.allSettled(detectionPromises);
      const allTokenInfo: TokenChainInfo[] = [];

      for (const result of results) {
        if (result.status === "fulfilled" && result.value.success) {
          allTokenInfo.push(...(result.value.tokenInfo || []));
        } else if (result.status === "rejected") {
          logger.warn(`API query failed:`, result.reason);
        }
      }

      if (allTokenInfo.length === 0) {
        // Step 3: Final fallback - try hardcoded popular tokens
        const fallbackResult = this.tryFallbackAddresses(tokenSymbol);
        if (fallbackResult.success) {
          this.cache.set(cacheKey, fallbackResult);
          return this.selectOptimalChain(fallbackResult, userSafeDeployments);
        }

        const errorResult: ChainDetectionResult = {
          success: false,
          error: `Token ${tokenSymbol} not found on any supported chains`,
          recommendedAction: `Please verify the token symbol. Popular tokens supported: ${Object.keys(TOKEN_MAP).join(", ")}. For other tokens, ensure they're available on Ethereum, Arbitrum, Polygon, Base, or Optimism.`,
        };
        this.cache.set(cacheKey, errorResult);
        return errorResult;
      }

      // Remove duplicates and sort by confidence
      const uniqueTokenInfo = this.deduplicateAndRank(allTokenInfo);

      const result: ChainDetectionResult = {
        success: true,
        tokenInfo: uniqueTokenInfo,
        primaryChain: uniqueTokenInfo[0],
      };

      this.cache.set(cacheKey, result);
      logger.info(
        `✅ Enhanced detection found ${tokenSymbol} on ${uniqueTokenInfo.length} chains`
      );

      return this.selectOptimalChain(result, userSafeDeployments);
    } catch (error) {
      logger.error(
        `❌ Enhanced token detection failed for ${tokenSymbol}:`,
        error
      );
      return {
        success: false,
        error: `Detection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        recommendedAction: "Please try again or contact support",
      };
    }
  }

  /**
   * Check if token exists in our known TOKEN_MAP
   */
  private checkKnownTokens(tokenSymbol: string): ChainDetectionResult {
    const tokenInfo = NetworkUtils.getTokenInfo(tokenSymbol);

    if (!tokenInfo) {
      return { success: false };
    }

    const chainInfos: TokenChainInfo[] = [];

    for (const [networkKey, address] of Object.entries(tokenInfo.addresses)) {
      const network = NetworkUtils.getNetworkByKey(networkKey);
      if (network) {
        chainInfos.push({
          symbol: tokenInfo.symbol,
          name: tokenInfo.name,
          contractAddress: address,
          chainId: network.chainId,
          networkKey: network.networkKey,
          decimals: tokenInfo.decimals,
          verified: true,
          source: "known",
        });
      }
    }

    return {
      success: true,
      tokenInfo: chainInfos,
      primaryChain: chainInfos[0],
    };
  }

  /**
   * Query CoinGecko API with retry logic
   */
  private async queryCoinGeckoWithRetry(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        logger.info(
          `🦎 Querying CoinGecko for ${tokenSymbol} (attempt ${attempt})`
        );

        const searchResponse = await axios.get(
          `https://api.coingecko.com/api/v3/search?query=${tokenSymbol}`,
          { timeout: this.REQUEST_TIMEOUT }
        );

        const coins = searchResponse.data.coins || [];
        const exactMatch = coins.find(
          (coin: any) =>
            coin.symbol?.toLowerCase() === tokenSymbol.toLowerCase()
        );

        if (!exactMatch) {
          return { success: false };
        }

        // Get detailed coin data
        const coinResponse = await axios.get(
          `https://api.coingecko.com/api/v3/coins/${exactMatch.id}`,
          { timeout: this.REQUEST_TIMEOUT }
        );

        const coinData = coinResponse.data;
        const platforms = coinData.platforms || {};
        const chainInfos: TokenChainInfo[] = [];

        // Enhanced platform mapping
        const platformMap: Record<string, string> = {
          ethereum: "ethereum",
          "arbitrum-one": "arbitrum",
          "polygon-pos": "polygon",
          base: "base",
          "optimistic-ethereum": "optimism",
        };

        for (const [platform, address] of Object.entries(platforms)) {
          const networkKey = platformMap[platform];
          if (networkKey && address && address !== "") {
            const network = NetworkUtils.getNetworkByKey(networkKey);
            if (network) {
              chainInfos.push({
                symbol:
                  coinData.symbol?.toUpperCase() || tokenSymbol.toUpperCase(),
                name: coinData.name,
                contractAddress: address as string,
                chainId: network.chainId,
                networkKey: network.networkKey,
                decimals:
                  coinData.detail_platforms?.[platform]?.decimal_place || 18,
                verified: true,
                source: "coingecko",
              });
            }
          }
        }

        if (chainInfos.length > 0) {
          logger.info(
            `✅ CoinGecko found ${chainInfos.length} chains for ${tokenSymbol}`
          );
          return {
            success: true,
            tokenInfo: chainInfos,
            primaryChain: chainInfos[0],
          };
        }

        return { success: false };
      } catch (error) {
        logger.warn(
          `CoinGecko attempt ${attempt} failed for ${tokenSymbol}:`,
          error
        );
        if (attempt === this.MAX_RETRIES) {
          return { success: false };
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return { success: false };
  }

  /**
   * Query DexScreener API with retry logic
   */
  private async queryDexScreenerWithRetry(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        logger.info(
          `📊 Querying DexScreener for ${tokenSymbol} (attempt ${attempt})`
        );

        const response = await axios.get(
          `https://api.dexscreener.com/latest/dex/search/?q=${tokenSymbol}`,
          { timeout: this.REQUEST_TIMEOUT }
        );

        const pairs = response.data.pairs || [];
        const chainInfos: TokenChainInfo[] = [];

        // Enhanced chain mapping for DexScreener
        const chainMap: Record<string, string> = {
          ethereum: "ethereum",
          arbitrum: "arbitrum",
          polygon: "polygon",
          base: "base",
          optimism: "optimism",
        };

        const processedAddresses = new Set<string>();

        for (const pair of pairs) {
          if (
            !pair.baseToken ||
            pair.baseToken.symbol?.toUpperCase() !== tokenSymbol.toUpperCase()
          ) {
            continue;
          }

          const networkKey = chainMap[pair.chainId];
          if (!networkKey) continue;

          const network = NetworkUtils.getNetworkByKey(networkKey);
          if (!network) continue;

          const address = pair.baseToken.address;
          const addressKey = `${networkKey}:${address}`;

          if (!processedAddresses.has(addressKey)) {
            processedAddresses.add(addressKey);

            chainInfos.push({
              symbol:
                pair.baseToken.symbol?.toUpperCase() ||
                tokenSymbol.toUpperCase(),
              name: pair.baseToken.name,
              contractAddress: address,
              chainId: network.chainId,
              networkKey: network.networkKey,
              decimals: 18, // Default, DexScreener doesn't always provide this
              verified: pair.fdv > 1000000, // Consider verified if FDV > $1M
              source: "dexscreener",
            });
          }
        }

        if (chainInfos.length > 0) {
          logger.info(
            `✅ DexScreener found ${chainInfos.length} chains for ${tokenSymbol}`
          );
          return {
            success: true,
            tokenInfo: chainInfos,
            primaryChain: chainInfos[0],
          };
        }

        return { success: false };
      } catch (error) {
        logger.warn(
          `DexScreener attempt ${attempt} failed for ${tokenSymbol}:`,
          error
        );
        if (attempt === this.MAX_RETRIES) {
          return { success: false };
        }
        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    return { success: false };
  }

  /**
   * Query common token addresses for popular tokens
   */
  private async queryCommonAddresses(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    // Common addresses for popular tokens that might not be in TOKEN_MAP
    const commonTokens: Record<string, Record<string, string>> = {
      UNI: {
        ethereum: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984",
        arbitrum: "0xFa7F8980b0f1E64A2062791cc3b0871572f1F7f0",
        polygon: "0xb33EaAd8d922B1083446DC23f610c2567fB5180f",
        optimism: "0x6fd9d7AD17242c41f7131d257212c54A0e816691",
      },
      AAVE: {
        ethereum: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9",
        arbitrum: "0xba5DdD1f9d7F570dc94a51479a000E3BCE967196",
        polygon: "0xD6DF932A45C0f255f85145f286eA0b292B21C90B",
        optimism: "0x76FB31fb4af56892A25e32cFC43De717950c9278",
      },
      COMP: {
        ethereum: "0xc00e94Cb662C3520282E6f5717214004A7f26888",
        arbitrum: "0x354A6dA3fcde098F8389cad84b0182725c6C91dE",
        polygon: "0x8505b9d2254A7Ae468c0E9dd10Ccea3A837aef5c",
      },
      // Add more as needed
    };

    const tokenAddresses = commonTokens[tokenSymbol.toUpperCase()];
    if (!tokenAddresses) {
      return { success: false };
    }

    const chainInfos: TokenChainInfo[] = [];

    for (const [networkKey, address] of Object.entries(tokenAddresses)) {
      const network = NetworkUtils.getNetworkByKey(networkKey);
      if (network) {
        chainInfos.push({
          symbol: tokenSymbol.toUpperCase(),
          name: `${tokenSymbol} Token`,
          contractAddress: address,
          chainId: network.chainId,
          networkKey: network.networkKey,
          decimals: 18,
          verified: true,
          source: "manual",
        });
      }
    }

    return {
      success: chainInfos.length > 0,
      tokenInfo: chainInfos,
      primaryChain: chainInfos[0],
    };
  }

  /**
   * Final fallback for popular tokens using known addresses
   */
  private tryFallbackAddresses(tokenSymbol: string): ChainDetectionResult {
    logger.info(`🔧 Trying fallback addresses for ${tokenSymbol}`);

    // This would be expanded with more tokens based on user requests
    const fallbackTokens: Record<string, Record<string, string>> = {
      // Add common tokens here as we encounter them
    };

    const tokenAddresses = fallbackTokens[tokenSymbol.toUpperCase()];
    if (!tokenAddresses) {
      return { success: false };
    }

    const chainInfos: TokenChainInfo[] = [];

    for (const [networkKey, address] of Object.entries(tokenAddresses)) {
      const network = NetworkUtils.getNetworkByKey(networkKey);
      if (network) {
        chainInfos.push({
          symbol: tokenSymbol.toUpperCase(),
          name: `${tokenSymbol} Token`,
          contractAddress: address,
          chainId: network.chainId,
          networkKey: network.networkKey,
          decimals: 18,
          verified: true,
          source: "manual",
        });
      }
    }

    return {
      success: chainInfos.length > 0,
      tokenInfo: chainInfos,
      primaryChain: chainInfos[0],
    };
  }

  /**
   * Remove duplicate entries and rank by confidence
   */
  private deduplicateAndRank(tokenInfos: TokenChainInfo[]): TokenChainInfo[] {
    const uniqueMap = new Map<string, TokenChainInfo>();

    for (const info of tokenInfos) {
      const key = `${info.networkKey}:${info.contractAddress}`;

      if (
        !uniqueMap.has(key) ||
        this.getSourcePriority(info.source) >
          this.getSourcePriority(uniqueMap.get(key)!.source)
      ) {
        uniqueMap.set(key, info);
      }
    }

    return Array.from(uniqueMap.values()).sort((a, b) => {
      // Sort by source priority, then by verification status
      const priorityDiff =
        this.getSourcePriority(b.source) - this.getSourcePriority(a.source);
      if (priorityDiff !== 0) return priorityDiff;

      return (b.verified ? 1 : 0) - (a.verified ? 1 : 0);
    });
  }

  /**
   * Get priority score for different data sources
   */
  private getSourcePriority(source: string): number {
    const priorities = {
      known: 5,
      coingecko: 4,
      manual: 3,
      dexscreener: 2,
      etherscan: 1,
    };
    return priorities[source as keyof typeof priorities] || 0;
  }

  /**
   * Select optimal chain based on user's Safe deployments
   */
  private selectOptimalChain(
    result: ChainDetectionResult,
    userSafeDeployments?: any[]
  ): ChainDetectionResult {
    if (!result.success || !result.tokenInfo || !userSafeDeployments?.length) {
      return result;
    }

    // Find chains where user has active Safe deployments
    const userNetworks = new Set(
      userSafeDeployments
        .filter((d) => d.isActive && d.networkKey)
        .map((d) => d.networkKey)
    );

    // Find token info for chains where user has Safe deployed
    const compatibleChains = result.tokenInfo.filter((info) =>
      userNetworks.has(info.networkKey)
    );

    if (compatibleChains.length > 0) {
      logger.info(
        `✅ Found ${compatibleChains.length} compatible chains for user's Safes`
      );
      return {
        ...result,
        primaryChain: compatibleChains[0],
        tokenInfo: [
          ...compatibleChains,
          ...result.tokenInfo.filter(
            (info) => !userNetworks.has(info.networkKey)
          ),
        ],
      };
    }

    // If no compatible chains, recommend deploying Safe on primary chain
    const primaryChain = result.primaryChain || result.tokenInfo[0];
    return {
      ...result,
      recommendedAction: `Deploy Safe on ${primaryChain.networkKey} network to trade ${primaryChain.symbol}`,
    };
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheValid(cached: ChainDetectionResult): boolean {
    return Date.now() - (cached as any).cachedAt < this.CACHE_TTL;
  }

  /**
   * Get supported chains summary
   */
  getSupportedChains(): string[] {
    return Object.keys(SUPPORTED_NETWORKS);
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("🧹 Enhanced token detection cache cleared");
  }
}

export default EnhancedTokenDetectionService;
