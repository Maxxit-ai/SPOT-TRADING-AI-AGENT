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
 * Enhanced Token Chain Detection Service
 *
 * This service intelligently detects which chains support specific tokens by:
 * 1. Checking known tokens from TOKEN_MAP
 * 2. Querying CoinGecko API for popular tokens
 * 3. Using DexScreener API for new/trending tokens
 * 4. Fallback to block explorer APIs
 * 5. Smart chain recommendation based on user's Safe deployments
 */
export class TokenChainDetectionService {
  private cache = new Map<string, ChainDetectionResult>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

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

      logger.info(`🔍 Detecting chains for token: ${tokenSymbol}`);

      // Step 1: Check known tokens first
      const knownTokenInfo = this.checkKnownTokens(tokenSymbol);
      if (knownTokenInfo.success && knownTokenInfo.tokenInfo?.length) {
        logger.info(`✅ Found ${tokenSymbol} in known tokens`);
        this.cache.set(cacheKey, knownTokenInfo);
        return this.selectOptimalChain(knownTokenInfo, userSafeDeployments);
      }

      // Step 2: Query external APIs for unknown tokens
      const detectionResults = await Promise.allSettled([
        this.queryCoingecko(tokenSymbol),
        this.queryDexScreener(tokenSymbol),
        this.queryMoralisAPI(tokenSymbol),
      ]);

      // Aggregate results from all sources
      const allTokenInfo: TokenChainInfo[] = [];

      for (const result of detectionResults) {
        if (result.status === "fulfilled" && result.value.success) {
          allTokenInfo.push(...(result.value.tokenInfo || []));
        }
      }

      if (allTokenInfo.length === 0) {
        const errorResult: ChainDetectionResult = {
          success: false,
          error: `Token ${tokenSymbol} not found on any supported chains`,
          recommendedAction: `Please verify the token symbol. Supported tokens: ${Object.keys(TOKEN_MAP).join(", ")}`,
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
        `✅ Detected ${tokenSymbol} on ${uniqueTokenInfo.length} chains`
      );

      return this.selectOptimalChain(result, userSafeDeployments);
    } catch (error) {
      logger.error(
        `❌ Token chain detection failed for ${tokenSymbol}:`,
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
   * Query CoinGecko API for token information
   */
  private async queryCoingecko(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    try {
      logger.info(`🦎 Querying CoinGecko for ${tokenSymbol}`);

      const searchResponse = await axios.get(
        `https://api.coingecko.com/api/v3/search?query=${tokenSymbol}`,
        { timeout: 5000 }
      );

      const coins = searchResponse.data.coins || [];
      const exactMatch = coins.find(
        (coin: any) => coin.symbol?.toLowerCase() === tokenSymbol.toLowerCase()
      );

      if (!exactMatch) {
        return { success: false };
      }

      // Get detailed coin data
      const coinResponse = await axios.get(
        `https://api.coingecko.com/api/v3/coins/${exactMatch.id}`,
        { timeout: 5000 }
      );

      const coinData = coinResponse.data;
      const platforms = coinData.platforms || {};
      const chainInfos: TokenChainInfo[] = [];

      // Map CoinGecko platform names to our network keys
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

      return {
        success: chainInfos.length > 0,
        tokenInfo: chainInfos,
        primaryChain: chainInfos[0],
      };
    } catch (error) {
      logger.warn(`CoinGecko query failed for ${tokenSymbol}:`, error);
      return { success: false };
    }
  }

  /**
   * Query DexScreener API for new/trending tokens
   */
  private async queryDexScreener(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    try {
      logger.info(`📊 Querying DexScreener for ${tokenSymbol}`);

      const response = await axios.get(
        `https://api.dexscreener.com/latest/dex/search/?q=${tokenSymbol}`,
        { timeout: 5000 }
      );

      const pairs = response.data.pairs || [];
      const chainInfos: TokenChainInfo[] = [];

      // Map DexScreener chain IDs to our network keys
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
              pair.baseToken.symbol?.toUpperCase() || tokenSymbol.toUpperCase(),
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

      return {
        success: chainInfos.length > 0,
        tokenInfo: chainInfos,
        primaryChain: chainInfos[0],
      };
    } catch (error) {
      logger.warn(`DexScreener query failed for ${tokenSymbol}:`, error);
      return { success: false };
    }
  }

  /**
   * Query Moralis API as additional source
   */
  private async queryMoralisAPI(
    tokenSymbol: string
  ): Promise<ChainDetectionResult> {
    try {
      // This would require Moralis API key
      // For now, return empty result
      return { success: false };
    } catch (error) {
      return { success: false };
    }
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
      dexscreener: 3,
      etherscan: 2,
      manual: 1,
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
    logger.info("🧹 Token chain detection cache cleared");
  }
}

export default TokenChainDetectionService;
