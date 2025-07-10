import Safe from "@safe-global/protocol-kit";
import { ethers } from "ethers";
import { logger } from "../config/logger";
import { NetworkUtils } from "../utils/NetworkUtils";
import TokenChainDetectionService, {
  TokenChainInfo,
} from "./TokenChainDetectionService";

export interface SafeValidationResult {
  isValid: boolean;
  safeAddress: string;
  networkKey: string;
  chainId: number;
  isDeployed: boolean;
  owners?: string[];
  threshold?: number;
  hasRequiredBalance?: boolean;
  error?: string;
  recommendedAction?: string;
}

export interface SafeCompatibilityCheck {
  safeAddress: string;
  tokenChainInfo: TokenChainInfo;
  hasCompatibleSafe: boolean;
  validationResult?: SafeValidationResult;
  alternativeChains?: TokenChainInfo[];
  recommendedAction: string;
}

/**
 * Safe Chain Validation Service
 *
 * This service ensures that:
 * 1. Safe is deployed on the correct chain for the token
 * 2. Safe has proper configuration (owners, threshold)
 * 3. Safe has sufficient balance for trading
 * 4. Provides recommendations for deployment if needed
 */
export class SafeChainValidationService {
  private tokenChainService: TokenChainDetectionService;
  private validationCache = new Map<string, SafeValidationResult>();
  private readonly CACHE_TTL = 2 * 60 * 1000; // 2 minutes

  constructor() {
    this.tokenChainService = new TokenChainDetectionService();
  }

  /**
   * Main method to validate Safe compatibility with token trading
   */
  async validateSafeForToken(
    safeAddress: string,
    tokenSymbol: string,
    userSafeDeployments?: any[]
  ): Promise<SafeCompatibilityCheck> {
    try {
      logger.info(`🔍 Validating Safe ${safeAddress} for token ${tokenSymbol}`);

      // Step 1: Detect which chains support the token
      const tokenDetection = await this.tokenChainService.detectTokenChains(
        tokenSymbol,
        userSafeDeployments
      );

      if (!tokenDetection.success || !tokenDetection.primaryChain) {
        return {
          safeAddress,
          tokenChainInfo: {} as TokenChainInfo,
          hasCompatibleSafe: false,
          recommendedAction:
            tokenDetection.error ||
            `Token ${tokenSymbol} not found on any supported chains`,
        };
      }

      const primaryChain = tokenDetection.primaryChain;
      logger.info(
        `🎯 Primary chain for ${tokenSymbol}: ${primaryChain.networkKey}`
      );

      // Step 2: Check if user actually has Safe deployed on primary chain using database
      const hasDeploymentOnPrimary = this.checkUserDeploymentOnChain(
        safeAddress,
        primaryChain.networkKey,
        userSafeDeployments
      );

      if (hasDeploymentOnPrimary) {
        // Step 3: Validate the known deployment
        const safeValidation = await this.validateSafeOnChain(
          safeAddress,
          primaryChain.networkKey,
          primaryChain.chainId
        );

        if (safeValidation.isValid && safeValidation.isDeployed) {
          logger.info(
            `✅ Safe ${safeAddress} is valid on ${primaryChain.networkKey}`
          );
          return {
            safeAddress,
            tokenChainInfo: primaryChain,
            hasCompatibleSafe: true,
            validationResult: safeValidation,
            recommendedAction: "Safe is ready for trading",
          };
        }
      } else {
        logger.warn(
          `⚠️ Safe ${safeAddress} not deployed on primary chain ${primaryChain.networkKey} according to database`
        );
      }

      // Step 4: Check alternative chains where user has deployments
      const userNetworks = this.getUserDeploymentNetworks(userSafeDeployments);
      const alternativeChains =
        tokenDetection.tokenInfo?.filter(
          (info) =>
            info.networkKey !== primaryChain.networkKey &&
            userNetworks.includes(info.networkKey)
        ) || [];

      for (const altChain of alternativeChains) {
        const hasDeploymentOnAlt = this.checkUserDeploymentOnChain(
          safeAddress,
          altChain.networkKey,
          userSafeDeployments
        );

        if (hasDeploymentOnAlt) {
          const altValidation = await this.validateSafeOnChain(
            safeAddress,
            altChain.networkKey,
            altChain.chainId
          );

          if (altValidation.isValid && altValidation.isDeployed) {
            logger.info(
              `✅ Safe ${safeAddress} found on alternative chain: ${altChain.networkKey}`
            );
            return {
              safeAddress,
              tokenChainInfo: altChain,
              hasCompatibleSafe: true,
              validationResult: altValidation,
              recommendedAction: `Using ${altChain.networkKey} chain for trading`,
            };
          }
        }
      }

      // Step 5: No compatible deployment found
      logger.warn(`❌ No compatible Safe deployment found for ${safeAddress}`);

      const userNetworksStr = userNetworks.join(", ");
      const tokenNetworksStr =
        tokenDetection.tokenInfo?.map((t) => t.networkKey).join(", ") ||
        primaryChain.networkKey;

      return {
        safeAddress,
        tokenChainInfo: primaryChain,
        hasCompatibleSafe: false,
        alternativeChains,
        recommendedAction:
          `Safe is deployed on: [${userNetworksStr}] but token ${tokenSymbol} is available on: [${tokenNetworksStr}]. ` +
          `Deploy Safe on ${primaryChain.networkKey} to trade ${tokenSymbol}.`,
      };
    } catch (error) {
      logger.error(`❌ Safe validation failed:`, error);
      return {
        safeAddress,
        tokenChainInfo: {} as TokenChainInfo,
        hasCompatibleSafe: false,
        recommendedAction: `Validation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  }

  /**
   * Validate Safe deployment on a specific chain
   */
  async validateSafeOnChain(
    safeAddress: string,
    networkKey: string,
    chainId: number
  ): Promise<SafeValidationResult> {
    try {
      const cacheKey = `${safeAddress}:${networkKey}`;
      const cached = this.validationCache.get(cacheKey);

      if (cached && this.isCacheValid(cached)) {
        logger.info(
          `📦 Using cached validation for ${safeAddress} on ${networkKey}`
        );
        return cached;
      }

      logger.info(`🔍 Validating Safe ${safeAddress} on ${networkKey}`);

      const network = NetworkUtils.getNetworkByKey(networkKey);
      if (!network) {
        const result: SafeValidationResult = {
          isValid: false,
          safeAddress,
          networkKey,
          chainId,
          isDeployed: false,
          error: `Network ${networkKey} not supported`,
          recommendedAction: `Use supported networks: ${NetworkUtils.getNetworkByKey("arbitrum")?.name || "Arbitrum"}`,
        };
        return result;
      }

      // Check if Safe is deployed by trying to get basic info
      const isDeployed = await this.checkSafeDeployment(
        safeAddress,
        network.rpcUrl
      );

      if (!isDeployed) {
        const result: SafeValidationResult = {
          isValid: false,
          safeAddress,
          networkKey,
          chainId,
          isDeployed: false,
          error: `Safe not deployed on ${network.name}`,
          recommendedAction: `Deploy Safe on ${network.name} to enable trading`,
        };
        this.validationCache.set(cacheKey, result);
        return result;
      }

      // Get Safe details
      const safeDetails = await this.getSafeDetails(
        safeAddress,
        network.rpcUrl
      );

      const result: SafeValidationResult = {
        isValid: true,
        safeAddress,
        networkKey,
        chainId,
        isDeployed: true,
        owners: safeDetails.owners,
        threshold: safeDetails.threshold,
        hasRequiredBalance: safeDetails.hasBalance,
        recommendedAction: "Safe is ready for trading",
      };

      this.validationCache.set(cacheKey, result);
      logger.info(
        `✅ Safe validation completed for ${safeAddress} on ${networkKey}`
      );

      return result;
    } catch (error) {
      logger.error(
        `❌ Safe validation failed for ${safeAddress} on ${networkKey}:`,
        error
      );

      const result: SafeValidationResult = {
        isValid: false,
        safeAddress,
        networkKey,
        chainId,
        isDeployed: false,
        error: `Validation error: ${error instanceof Error ? error.message : "Unknown error"}`,
        recommendedAction:
          "Please check Safe address and network configuration",
      };

      return result;
    }
  }

  /**
   * Check if Safe contract is deployed at the address
   */
  private async checkSafeDeployment(
    safeAddress: string,
    rpcUrl: string
  ): Promise<boolean> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const code = await provider.getCode(safeAddress);

      // If code is '0x', the address has no contract deployed
      return code !== "0x";
    } catch (error) {
      logger.warn(`Failed to check Safe deployment:`, error);
      return false;
    }
  }

  /**
   * Get detailed Safe information using Safe SDK
   */
  private async getSafeDetails(
    safeAddress: string,
    rpcUrl: string
  ): Promise<{
    owners: string[];
    threshold: number;
    hasBalance: boolean;
  }> {
    try {
      // Create Safe instance to get details
      const protocolKit = await Safe.init({
        provider: rpcUrl,
        safeAddress: safeAddress,
      });

      const [owners, threshold, balance] = await Promise.all([
        protocolKit.getOwners(),
        protocolKit.getThreshold(),
        this.checkSafeBalance(safeAddress, rpcUrl),
      ]);

      return {
        owners,
        threshold,
        hasBalance: balance > 0,
      };
    } catch (error) {
      logger.warn(`Failed to get Safe details:`, error);

      // Fallback: try basic contract calls
      return this.getSafeDetailsBasic(safeAddress, rpcUrl);
    }
  }

  /**
   * Basic Safe details using direct contract calls
   */
  private async getSafeDetailsBasic(
    safeAddress: string,
    rpcUrl: string
  ): Promise<{
    owners: string[];
    threshold: number;
    hasBalance: boolean;
  }> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);

      // Safe ABI for basic functions
      const safeAbi = [
        "function getOwners() view returns (address[])",
        "function getThreshold() view returns (uint256)",
      ];

      const safeContract = new ethers.Contract(safeAddress, safeAbi, provider);

      const [owners, threshold, balance] = await Promise.all([
        safeContract.getOwners(),
        safeContract.getThreshold(),
        this.checkSafeBalance(safeAddress, rpcUrl),
      ]);

      return {
        owners: owners || [],
        threshold: Number(threshold) || 1,
        hasBalance: balance > 0,
      };
    } catch (error) {
      logger.warn(`Failed to get basic Safe details:`, error);
      return {
        owners: [],
        threshold: 1,
        hasBalance: false,
      };
    }
  }

  /**
   * Check Safe native token balance
   */
  private async checkSafeBalance(
    safeAddress: string,
    rpcUrl: string
  ): Promise<number> {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const balance = await provider.getBalance(safeAddress);
      return parseFloat(ethers.formatEther(balance));
    } catch (error) {
      logger.warn(`Failed to check Safe balance:`, error);
      return 0;
    }
  }

  /**
   * Generate deployment recommendation based on validation results
   */
  private generateDeploymentRecommendation(
    safeAddress: string,
    tokenChainInfo: TokenChainInfo,
    validationResult: SafeValidationResult
  ): string {
    if (!validationResult.isDeployed) {
      return (
        `Deploy Safe on ${tokenChainInfo.networkKey} network to trade ${tokenChainInfo.symbol}. ` +
        `Use the deploySafeForTrading tool with chainId: ${tokenChainInfo.chainId}`
      );
    }

    if (validationResult.owners?.length === 0) {
      return `Safe configuration issue on ${tokenChainInfo.networkKey}. Please check Safe setup.`;
    }

    if (!validationResult.hasRequiredBalance) {
      return `Fund Safe ${safeAddress} on ${tokenChainInfo.networkKey} with native tokens for gas fees.`;
    }

    return `Unknown issue with Safe ${safeAddress} on ${tokenChainInfo.networkKey}. Please verify deployment.`;
  }

  /**
   * Check if cached result is still valid
   */
  private isCacheValid(cached: SafeValidationResult): boolean {
    return Date.now() - (cached as any).cachedAt < this.CACHE_TTL;
  }

  /**
   * Get validation summary for all user Safes
   */
  async validateAllUserSafes(
    userSafeDeployments: any[],
    tokenSymbol: string
  ): Promise<SafeValidationResult[]> {
    const results: SafeValidationResult[] = [];

    for (const deployment of userSafeDeployments) {
      if (deployment.safeAddress && deployment.networkKey) {
        const network = NetworkUtils.getNetworkByKey(deployment.networkKey);
        if (network) {
          const result = await this.validateSafeOnChain(
            deployment.safeAddress,
            deployment.networkKey,
            network.chainId
          );
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Check if user has Safe deployed on specific chain according to database
   */
  private checkUserDeploymentOnChain(
    safeAddress: string,
    networkKey: string,
    userSafeDeployments?: any[]
  ): boolean {
    if (!userSafeDeployments || userSafeDeployments.length === 0) {
      return false;
    }

    // Check each user deployment
    for (const deployment of userSafeDeployments) {
      // Handle both deployment object and nested deployments structure
      if (deployment.deployments && deployment.deployments[networkKey]) {
        const networkDeployment = deployment.deployments[networkKey];
        return (
          networkDeployment.address?.toLowerCase() ===
            safeAddress.toLowerCase() &&
          networkDeployment.isActive &&
          networkDeployment.deploymentStatus === "deployed"
        );
      }

      // Handle direct deployment object
      if (
        deployment.safeAddress?.toLowerCase() === safeAddress.toLowerCase() &&
        deployment.networkKey === networkKey &&
        deployment.isActive
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all networks where user has active Safe deployments
   */
  private getUserDeploymentNetworks(userSafeDeployments?: any[]): string[] {
    if (!userSafeDeployments || userSafeDeployments.length === 0) {
      return [];
    }

    const networks = new Set<string>();

    for (const deployment of userSafeDeployments) {
      // Handle nested deployments structure
      if (deployment.deployments) {
        Object.keys(deployment.deployments).forEach((networkKey) => {
          const networkDeployment = deployment.deployments[networkKey];
          if (
            networkDeployment.isActive &&
            networkDeployment.deploymentStatus === "deployed"
          ) {
            networks.add(networkKey);
          }
        });
      }

      // Handle direct deployment object
      if (deployment.networkKey && deployment.isActive) {
        networks.add(deployment.networkKey);
      }
    }

    return Array.from(networks);
  }

  /**
   * Clear validation cache
   */
  clearCache(): void {
    this.validationCache.clear();
    this.tokenChainService.clearCache();
    logger.info("🧹 Safe validation cache cleared");
  }

  /**
   * Get detailed validation report for debugging
   */
  async getValidationReport(
    safeAddress: string,
    tokenSymbol: string,
    userSafeDeployments?: any[]
  ): Promise<string> {
    const compatibility = await this.validateSafeForToken(
      safeAddress,
      tokenSymbol,
      userSafeDeployments
    );

    let report = `🔍 Safe Validation Report\n\n`;
    report += `📍 Safe Address: ${safeAddress}\n`;
    report += `🪙 Token: ${tokenSymbol}\n`;
    report += `🌐 Primary Chain: ${compatibility.tokenChainInfo.networkKey || "Unknown"}\n`;
    report += `✅ Compatible: ${compatibility.hasCompatibleSafe ? "Yes" : "No"}\n\n`;

    if (compatibility.validationResult) {
      const result = compatibility.validationResult;
      report += `📊 Validation Details:\n`;
      report += `- Deployed: ${result.isDeployed ? "Yes" : "No"}\n`;
      report += `- Owners: ${result.owners?.length || 0}\n`;
      report += `- Threshold: ${result.threshold || "Unknown"}\n`;
      report += `- Has Balance: ${result.hasRequiredBalance ? "Yes" : "No"}\n\n`;
    }

    if (compatibility.alternativeChains?.length) {
      report += `🔄 Alternative Chains:\n`;
      compatibility.alternativeChains.forEach((chain) => {
        report += `- ${chain.networkKey} (${chain.symbol})\n`;
      });
      report += `\n`;
    }

    report += `💡 Recommendation: ${compatibility.recommendedAction}`;

    return report;
  }
}

export default SafeChainValidationService;
