import Safe from "@safe-global/protocol-kit";
import { ethers } from "ethers";
import axios from "axios";
import { NetworkConfig } from "../config/networks";
import { logger } from "../config/logger";
import { NetworkUtils } from "../utils/NetworkUtils";
import {
  NATIVE_ETH_ADDRESS,
  isNativeTokenAddress,
} from "../constants/addresses";

interface SwapParams {
  safeAddress: string;
  sellToken: string;
  buyToken: string;
  sellAmount: string;
  slippagePercentage?: number;
}

interface SwapQuote {
  to: string;
  data: string;
  value: string;
  gas: string;
  gasPrice: string;
}

class TradeExecutionService {
  private safeInstances = new Map<string, Safe>();

  constructor() {
    logger.info(
      "TradeExecutionService initialized with real Safe SDK patterns"
    );
  }

  /**
   * Gets Safe instance using REAL Safe SDK v6 patterns
   */
  private async getSafeInstance(
    safeAddress: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<Safe> {
    const key = `${safeAddress}-${chainId}`;

    if (this.safeInstances.has(key)) {
      return this.safeInstances.get(key)!;
    }

    try {
      // First validate that the Safe exists on this network
      await this.validateSafeDeployment(safeAddress, networkConfig);

      // ✅ REAL Safe SDK v6 initialization - Safe.init() with provider and signer
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const signer = new ethers.Wallet(
        process.env["AGENT_PRIVATE_KEY"]!,
        provider
      );

      const protocolKit = await Safe.init({
        provider: networkConfig.rpcUrl,
        signer: process.env["AGENT_PRIVATE_KEY"]!,
        safeAddress,
      });

      this.safeInstances.set(key, protocolKit);
      logger.info(
        `Safe instance created for ${safeAddress} on chain ${chainId}`
      );

      return protocolKit;
    } catch (error) {
      logger.error(`Failed to create Safe instance: ${error}`);

      // Provide more specific error message if it's a deployment issue
      if (
        error instanceof Error &&
        error.message.includes("SafeProxy contract is not deployed")
      ) {
        throw new Error(
          `Safe address ${safeAddress} is not deployed on ${networkConfig.name} (chainId: ${chainId}). ` +
            `Please ensure the Safe is deployed on the correct network or check the network configuration.`
        );
      }

      throw error;
    }
  }

  /**
   * Validate that a Safe is actually deployed on the target network
   */
  private async validateSafeDeployment(
    safeAddress: string,
    networkConfig: NetworkConfig
  ): Promise<void> {
    try {
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const code = await provider.getCode(safeAddress);

      if (!code || code === "0x") {
        throw new Error(
          `Safe address ${safeAddress} has no contract code on ${networkConfig.name}. ` +
            `This Safe may not be deployed on this network.`
        );
      }

      logger.info(
        `✅ Validated Safe ${safeAddress} exists on ${networkConfig.name}`
      );
    } catch (error) {
      logger.error(
        `Safe validation failed for ${safeAddress} on ${networkConfig.name}: ${error}`
      );
      throw error;
    }
  }

  /**
   * Gets swap quote from 0x API v2 (following official patterns)
   */
  private async getSwapQuote(
    params: SwapParams,
    chainId: number
  ): Promise<SwapQuote> {
    try {
      // Get token contract addresses
      const sellTokenAddress = await this.getTokenAddress(
        params.sellToken,
        chainId
      );
      const buyTokenAddress = await this.getTokenAddress(
        params.buyToken,
        chainId
      );

      if (!sellTokenAddress || !buyTokenAddress) {
        throw new Error(
          `Token addresses not found for ${params.sellToken} or ${params.buyToken} on chain ${chainId}`
        );
      }

      // Convert amount to wei format
      const sellAmountWei = await this.convertToWei(
        params.sellAmount,
        params.sellToken,
        chainId
      );

      logger.info(
        `🔄 Getting 0x quote: ${params.sellAmount} ${params.sellToken} (${sellAmountWei} wei) -> ${params.buyToken} on chain ${chainId}`
      );

      // ✅ Using 0x API v2 with correct format (following official examples)
      const apiUrl = `https://api.0x.org/swap/allowance-holder/quote`;

      const requestParams = {
        chainId: chainId.toString(),
        sellToken: sellTokenAddress,
        buyToken: buyTokenAddress,
        sellAmount: sellAmountWei,
        taker: params.safeAddress,
        slippagePercentage: (params.slippagePercentage || 0.005).toString(), // 0.5%
        skipValidation: "false", // Validate the quote
      };

      logger.info(`📡 0x API Request:`, {
        url: apiUrl,
        params: requestParams,
      });

      const response = await axios.get(apiUrl, {
        params: requestParams,
        headers: {
          "0x-api-key": process.env["ZEROX_API_KEY"] || "",
          "Content-Type": "application/json",
          "0x-version": "v2",
        },
        timeout: 10000,
      });

      logger.info(`✅ 0x API Response received:`, {
        buyAmount: response.data.buyAmount,
        price: response.data.price,
        to: response.data.transaction?.to,
        gasPrice: response.data.transaction?.gasPrice,
      });

      // Log full response to debug potential permit2 signature requirements
      logger.info(`🔍 Full 0x API Response:`, {
        ...response.data,
        transaction: response.data.transaction,
      });

      return {
        to: response.data.transaction.to,
        data: response.data.transaction.data,
        value: response.data.transaction.value || "0",
        gas: response.data.transaction.gas,
        gasPrice: response.data.transaction.gasPrice,
      };
    } catch (error) {
      logger.error(`❌ 0x API call failed:`, {
        error: error instanceof Error ? error.message : error,
        chainId,
        sellToken: params.sellToken,
        buyToken: params.buyToken,
        sellAmount: params.sellAmount,
      });

      if (axios.isAxiosError(error)) {
        logger.error(`🔍 Axios error details:`, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          data: error.response?.data,
          url: error.config?.url,
          params: error.config?.params,
        });
      }

      throw new Error(
        `0x API call failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Executes token swap using REAL Safe SDK transaction patterns
   */
  async executeSwap(
    safeAddress: string,
    sellToken: string,
    buyToken: string,
    sellAmount: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<{
    success: boolean;
    transactionHash?: string;
    amountOut?: string;
    error?: string;
  }> {
    try {
      logger.info(
        `Executing swap: ${sellAmount} ${sellToken} -> ${buyToken} for Safe ${safeAddress}`
      );

      // Debug: Check Safe state before swap
      await this.debugSafeState(safeAddress, sellToken, chainId);

      // Get Safe instance using real patterns
      const protocolKit = await this.getSafeInstance(
        safeAddress,
        chainId,
        networkConfig
      );

      // Get token addresses and amounts in wei
      const sellTokenAddress = await this.getTokenAddress(sellToken, chainId);
      if (!sellTokenAddress) {
        throw new Error(`Sell token address not found for ${sellToken}`);
      }

      // Convert sell amount to wei for allowance check
      const sellAmountWei = await this.convertToWei(
        sellAmount,
        sellToken,
        chainId
      );

      // Step 1: Check USDC balance
      logger.info(`💰 Checking ${sellToken} balance...`);
      const hasBalance = await this.checkTokenBalance(
        safeAddress,
        sellTokenAddress,
        sellAmountWei,
        chainId,
        networkConfig
      );

      if (!hasBalance) {
        throw new Error(`Insufficient ${sellToken} balance in Safe`);
      }

      // Step 2: Ensure Permit2 allowance (only for ERC20 tokens)
      if (!isNativeTokenAddress(sellTokenAddress)) {
        logger.info(`🔐 Ensuring Permit2 allowance for ${sellToken}...`);
        await this.ensurePermit2Allowance(
          safeAddress,
          sellTokenAddress,
          sellAmountWei,
          chainId,
          networkConfig
        );
      }

      // Step 3: Get swap quote from 0x API
      logger.info(`📈 Getting swap quote from 0x API...`);
      const quote = await this.getSwapQuote(
        {
          safeAddress,
          sellToken,
          buyToken,
          sellAmount,
        },
        chainId
      );

      // Step 3.5: Ensure AllowanceHolder allowance (only for ERC20 tokens)
      if (!isNativeTokenAddress(sellTokenAddress)) {
        logger.info(
          `🔐 Ensuring AllowanceHolder allowance for ${sellToken}...`
        );
        await this.ensureAllowanceHolderAllowance(
          safeAddress,
          sellTokenAddress,
          sellAmountWei,
          quote.to, // AllowanceHolder contract address from quote
          chainId,
          networkConfig
        );
      }

      // Step 4: Execute the swap transaction
      logger.info(`🚀 Executing swap transaction...`);

      // Create Safe transaction with proper gas estimation
      const safeTransaction = await protocolKit.createTransaction({
        transactions: [
          {
            to: quote.to,
            value: quote.value,
            data: quote.data,
          },
        ],
      });

      // Get proper gas price for the network
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      const feeData = await provider.getFeeData();

      // Use appropriate gas price based on network
      let gasPrice: string;
      if (feeData.gasPrice) {
        // For networks with legacy gas pricing, use 1.2x the current gas price
        gasPrice = (
          (BigInt(feeData.gasPrice) * BigInt(120)) /
          BigInt(100)
        ).toString();
      } else {
        // Fallback to a reasonable gas price for Arbitrum (0.1 gwei)
        gasPrice = "100000000"; // 0.1 gwei
      }

      logger.info(
        `💰 Using gas price: ${gasPrice} wei (${ethers.formatUnits(gasPrice, "gwei")} gwei)`
      );

      // Sign and execute the transaction with proper gas settings
      const signedSafeTransaction =
        await protocolKit.signTransaction(safeTransaction);

      logger.info(`📝 Safe transaction created`, {
        to: quote.to,
        value: quote.value,
        safeTxGas: safeTransaction.data.safeTxGas,
        gasPrice: gasPrice,
        nonce: safeTransaction.data.nonce,
      });

      logger.info(`✍️ Safe transaction signed, executing...`);

      const executeTxResponse = await protocolKit.executeTransaction(
        signedSafeTransaction,
        {
          gasPrice: gasPrice,
        }
      );

      // Wait for transaction confirmation
      if (executeTxResponse.transactionResponse) {
        const receipt = await (
          executeTxResponse.transactionResponse as any
        ).wait();
        const txHash =
          (executeTxResponse.transactionResponse as any).hash || receipt?.hash;

        logger.info(`✅ Swap executed successfully: ${txHash}`);
        return {
          success: true,
          transactionHash: txHash,
          amountOut: receipt?.logs?.[0]?.data || sellAmount, // Estimate from logs or fallback
        };
      } else {
        throw new Error("Transaction execution failed");
      }
    } catch (error) {
      logger.error(`❌ Swap execution failed: ${error}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Checks if Safe has sufficient token balance
   */
  async checkTokenBalance(
    safeAddress: string,
    tokenAddress: string,
    requiredAmount: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<boolean> {
    try {
      // Input validation
      if (!tokenAddress || !safeAddress || !requiredAmount) {
        throw new Error("Invalid parameters");
      }

      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      if (isNativeTokenAddress(tokenAddress)) {
        // Native token balance (ETH, MATIC, etc.)
        const balance = await provider.getBalance(safeAddress);
        return balance >= BigInt(requiredAmount);
      } else {
        // ERC20 token balance with error handling
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );

        const balance = await tokenContract["balanceOf"](safeAddress);
        return balance >= BigInt(requiredAmount);
      }
    } catch (error) {
      logger.error(`Failed to check token balance: ${error}`);
      // In production, you might want to return false or throw
      return false;
    }
  }

  /**
   * Gets Safe owners (for validation)
   */
  async getSafeOwners(
    safeAddress: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<string[]> {
    try {
      const protocolKit = await this.getSafeInstance(
        safeAddress,
        chainId,
        networkConfig
      );

      // ✅ REAL Safe SDK method
      const owners = await protocolKit.getOwners();
      return owners;
    } catch (error) {
      logger.error(`Failed to get Safe owners: ${error}`);
      throw error;
    }
  }

  /**
   * Gets Safe threshold (for validation)
   */
  async getSafeThreshold(
    safeAddress: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<number> {
    try {
      const protocolKit = await this.getSafeInstance(
        safeAddress,
        chainId,
        networkConfig
      );

      // ✅ REAL Safe SDK method
      const threshold = await protocolKit.getThreshold();
      return threshold;
    } catch (error) {
      logger.error(`Failed to get Safe threshold: ${error}`);
      throw error;
    }
  }

  /**
   * Get Safe balance for a specific token
   */
  async getSafeBalance(
    safeAddress: string,
    tokenAddress: string,
    chainId: number
  ): Promise<string> {
    try {
      const networkConfig = this.getNetworkConfig(chainId);
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      if (isNativeTokenAddress(tokenAddress)) {
        const balance = await provider.getBalance(safeAddress);
        return balance.toString();
      } else {
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        );
        const balance = await tokenContract["balanceOf"](safeAddress);
        return balance.toString();
      }
    } catch (error) {
      logger.error(`Failed to get Safe balance: ${error}`);
      return "0";
    }
  }

  /**
   * Execute a trade based on signal data
   */
  async executeTrade(
    tradeData: any,
    positionSizeAmount: string
  ): Promise<void> {
    try {
      logger.info(
        `Executing trade for ${tradeData.tokenMentioned} with amount ${positionSizeAmount}`
      );

      // Determine the correct network from trade data or validate Safe deployment
      const chainId = await this.determineCorrectNetwork(tradeData);
      const networkConfig = this.getNetworkConfig(chainId);

      logger.info(
        `Using network: ${networkConfig.name} (chainId: ${chainId}) for Safe ${tradeData.safeAddress}`
      );

      const fromToken =
        tradeData.signalMessage === "buy" ? "USDC" : tradeData.tokenMentioned;
      const toToken =
        tradeData.signalMessage === "buy" ? tradeData.tokenMentioned : "USDC";

      logger.info(`📝 Trade details:`, {
        fromToken,
        toToken,
        amount: positionSizeAmount,
        signalMessage: tradeData.signalMessage,
        chainId,
        safeAddress: tradeData.safeAddress,
      });

      const result = await this.executeSwap(
        tradeData.safeAddress,
        fromToken,
        toToken,
        positionSizeAmount, // Now passing the actual token amount, not USD
        chainId,
        networkConfig
      );

      if (!result.success) {
        throw new Error(result.error || "Trade execution failed");
      }

      logger.info(`✅ Trade executed successfully: ${result.transactionHash}`);
    } catch (error) {
      logger.error(`❌ Trade execution failed: ${error}`);
      throw error;
    }
  }

  /**
   * Exit a trade position
   */
  async exitTrade(trade: any, amount: string, reason: string): Promise<void> {
    try {
      logger.info(`Exiting trade ${trade.tradeId} (${reason})`);

      const networkConfig = this.getNetworkConfig(42161);
      const result = await this.executeSwap(
        trade.safeAddress,
        trade.tokenMentioned,
        "USDC",
        amount,
        42161,
        networkConfig
      );

      if (!result.success) {
        throw new Error(result.error || "Trade exit failed");
      }

      logger.info(`Trade exit completed: ${result.transactionHash}`);
    } catch (error) {
      logger.error(`Trade exit failed: ${error}`);
      throw error;
    }
  }

  /**
   * Retry a failed trade
   */
  async retryFailedTrade(trade: any): Promise<void> {
    try {
      logger.info(`Retrying failed trade ${trade.tradeId}`);
      await this.executeTrade(trade, "1"); // Default retry amount as string
      logger.info(`Trade retry completed successfully`);
    } catch (error) {
      logger.error(`Trade retry failed: ${error}`);
      throw error;
    }
  }

  /**
   * Determine the correct network for a Safe address by checking where it's deployed
   */
  private async determineCorrectNetwork(tradeData: any): Promise<number> {
    const safeAddress = tradeData.safeAddress;

    // If networkKey is provided in trade data, use it
    if (tradeData.networkKey) {
      const networkConfig = this.getNetworkConfigByKey(tradeData.networkKey);
      if (networkConfig) {
        logger.info(
          `Using network from trade data: ${tradeData.networkKey} (chainId: ${networkConfig.chainId})`
        );
        return networkConfig.chainId;
      }
    }

    // List of networks to check for Safe deployment
    const networksToCheck = [
      {
        chainId: 42161,
        name: "Arbitrum",
        rpcUrl: "https://arb1.arbitrum.io/rpc",
      },
      {
        chainId: 11155111,
        name: "Sepolia",
        rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
      },
      {
        chainId: 421614,
        name: "Arbitrum Sepolia",
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
      },
      {
        chainId: 84532,
        name: "Base Sepolia",
        rpcUrl: "https://sepolia.base.org",
      },
      { chainId: 137, name: "Polygon", rpcUrl: "https://polygon-rpc.com" },
      { chainId: 8453, name: "Base", rpcUrl: "https://mainnet.base.org" },
      { chainId: 10, name: "Optimism", rpcUrl: "https://mainnet.optimism.io" },
    ];

    for (const network of networksToCheck) {
      try {
        logger.info(
          `Checking if Safe ${safeAddress} exists on ${network.name}...`
        );

        const provider = new ethers.JsonRpcProvider(network.rpcUrl);
        const code = await provider.getCode(safeAddress);

        // If the address has code, it's likely deployed on this network
        if (code && code !== "0x") {
          logger.info(
            `✅ Safe ${safeAddress} found on ${network.name} (chainId: ${network.chainId})`
          );
          return network.chainId;
        }
      } catch (error) {
        logger.debug(`Could not check Safe on ${network.name}: ${error}`);
      }
    }

    // If not found on any network, throw an error with helpful message
    throw new Error(
      `Safe address ${safeAddress} not found on any supported networks. ` +
        `Please ensure the Safe is deployed on one of: Arbitrum, Sepolia, Polygon, Base, or Optimism`
    );
  }

  /**
   * Helper method to get network config by network key
   */
  private getNetworkConfigByKey(networkKey: string): NetworkConfig | null {
    const configMap: Record<string, NetworkConfig> = {
      arbitrum: {
        networkKey: "arbitrum",
        chainId: 42161,
        name: "Arbitrum One",
        rpcUrl: "https://arb1.arbitrum.io/rpc",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://arbiscan.io",
      },
      sepolia: {
        networkKey: "sepolia",
        chainId: 11155111,
        name: "Sepolia Testnet",
        rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.etherscan.io",
      },
      arbitrum_sepolia: {
        networkKey: "arbitrum_sepolia",
        chainId: 421614,
        name: "Arbitrum Sepolia",
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.arbiscan.io",
      },
      base_sepolia: {
        networkKey: "base_sepolia",
        chainId: 84532,
        name: "Base Sepolia",
        rpcUrl: "https://sepolia.base.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.basescan.org",
      },
      polygon: {
        networkKey: "polygon",
        chainId: 137,
        name: "Polygon Mainnet",
        rpcUrl: "https://polygon-rpc.com",
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
        blockExplorer: "https://polygonscan.com",
      },
      base: {
        networkKey: "base",
        chainId: 8453,
        name: "Base",
        rpcUrl: "https://mainnet.base.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://basescan.org",
      },
      optimism: {
        networkKey: "optimism",
        chainId: 10,
        name: "Optimism",
        rpcUrl: "https://mainnet.optimism.io",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://optimistic.etherscan.io",
      },
    };
    return configMap[networkKey] || null;
  }

  /**
   * Get token contract address from symbol and chain
   */
  private async getTokenAddress(
    tokenSymbol: string,
    chainId: number
  ): Promise<string | null> {
    try {
      const networkKey = this.getNetworkKeyFromChainId(chainId);
      if (!networkKey) {
        logger.error(`Network key not found for chainId: ${chainId}`);
        return null;
      }

      // Handle native tokens
      if (this.isNativeToken(tokenSymbol, networkKey)) {
        return NATIVE_ETH_ADDRESS; // 0x address for native tokens in 0x API
      }

      // Get token address from NetworkUtils
      const tokenAddress = NetworkUtils.getTokenAddress(
        tokenSymbol,
        networkKey
      );
      if (!tokenAddress) {
        logger.error(
          `Token address not found for ${tokenSymbol} on ${networkKey}`
        );
        return null;
      }

      return tokenAddress;
    } catch (error) {
      logger.error(`Error getting token address for ${tokenSymbol}:`, error);
      return null;
    }
  }

  /**
   * Convert amount to wei format for API
   */
  private async convertToWei(
    amount: string,
    tokenSymbol: string,
    chainId: number
  ): Promise<string> {
    try {
      const networkKey = this.getNetworkKeyFromChainId(chainId);
      if (!networkKey) {
        throw new Error(`Network key not found for chainId: ${chainId}`);
      }

      // Get token info to determine decimals
      const tokenInfo = NetworkUtils.getTokenInfo(tokenSymbol);
      const decimals = tokenInfo?.decimals || 18; // Default to 18 decimals

      // Convert to wei
      const amountWei = ethers.parseUnits(amount, decimals);
      return amountWei.toString();
    } catch (error) {
      logger.error(`Error converting ${amount} ${tokenSymbol} to wei:`, error);
      throw new Error(
        `Amount conversion failed: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  /**
   * Get network key from chain ID
   */
  private getNetworkKeyFromChainId(chainId: number): string | null {
    const chainToNetworkMap: Record<number, string> = {
      1: "ethereum",
      42161: "arbitrum",
      11155111: "sepolia",
      421614: "arbitrum_sepolia",
      84532: "base_sepolia",
      137: "polygon",
      8453: "base",
      10: "optimism",
    };
    return chainToNetworkMap[chainId] || null;
  }

  /**
   * Check if token is native token for network
   */
  private isNativeToken(tokenSymbol: string, networkKey: string): boolean {
    const nativeTokens: Record<string, string> = {
      ethereum: "ETH",
      arbitrum: "ETH",
      sepolia: "ETH",
      arbitrum_sepolia: "ETH",
      base_sepolia: "ETH",
      base: "ETH",
      optimism: "ETH",
      polygon: "MATIC",
    };
    return nativeTokens[networkKey] === tokenSymbol;
  }

  /**
   * Helper method to get network config
   */
  private getNetworkConfig(chainId: number): NetworkConfig {
    const configs: Record<number, NetworkConfig> = {
      42161: {
        networkKey: "arbitrum",
        chainId: 42161,
        name: "Arbitrum One",
        rpcUrl: "https://arb1.arbitrum.io/rpc",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://arbiscan.io",
      },
      11155111: {
        networkKey: "sepolia",
        chainId: 11155111,
        name: "Sepolia Testnet",
        rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
        nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.etherscan.io",
      },
      421614: {
        networkKey: "arbitrum_sepolia",
        chainId: 421614,
        name: "Arbitrum Sepolia",
        rpcUrl: "https://sepolia-rollup.arbitrum.io/rpc",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.arbiscan.io",
      },
      84532: {
        networkKey: "base_sepolia",
        chainId: 84532,
        name: "Base Sepolia",
        rpcUrl: "https://sepolia.base.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://sepolia.basescan.org",
      },
      137: {
        networkKey: "polygon",
        chainId: 137,
        name: "Polygon Mainnet",
        rpcUrl: "https://polygon-rpc.com",
        nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
        blockExplorer: "https://polygonscan.com",
      },
      8453: {
        networkKey: "base",
        chainId: 8453,
        name: "Base",
        rpcUrl: "https://mainnet.base.org",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://basescan.org",
      },
      10: {
        networkKey: "optimism",
        chainId: 10,
        name: "Optimism",
        rpcUrl: "https://mainnet.optimism.io",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        blockExplorer: "https://optimistic.etherscan.io",
      },
    };
    return configs[chainId] || configs[42161];
  }

  /**
   * Check and set Permit2 allowance if needed
   */
  private async ensurePermit2Allowance(
    safeAddress: string,
    tokenAddress: string,
    amount: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<void> {
    try {
      // Permit2 contract addresses per chain
      const permit2Addresses: Record<number, string> = {
        1: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Ethereum
        42161: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Arbitrum
        137: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Polygon
        8453: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Base
        10: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Optimism
        11155111: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Sepolia
        421614: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Arbitrum Sepolia
        84532: "0x000000000022D473030F116dDEE9F6B43aC78BA3", // Base Sepolia
      };

      const permit2Address = permit2Addresses[chainId];
      if (!permit2Address) {
        logger.warn(`Permit2 not available on chain ${chainId}`);
        return;
      }

      logger.info(`🔍 Checking Permit2 allowance for ${tokenAddress}`);

      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      // Check current allowance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
        ],
        provider
      );

      const currentAllowance = await tokenContract.allowance(
        safeAddress,
        permit2Address
      );
      const requiredAmount = BigInt(amount);

      logger.info(
        `📊 Current Permit2 allowance: ${currentAllowance.toString()}, Required: ${requiredAmount.toString()}`
      );

      if (currentAllowance < requiredAmount) {
        logger.info(`⚠️ Insufficient Permit2 allowance, setting approval...`);

        // Get Safe instance
        const protocolKit = await this.getSafeInstance(
          safeAddress,
          chainId,
          networkConfig
        );

        // Create approval transaction for maximum amount
        const maxAllowance =
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // Max uint256

        const approvalTransaction = await protocolKit.createTransaction({
          transactions: [
            {
              to: tokenAddress,
              value: "0",
              data: new ethers.Interface([
                "function approve(address spender, uint256 amount)",
              ]).encodeFunctionData("approve", [permit2Address, maxAllowance]),
            },
          ],
        });

        // Sign and execute approval
        const signedApproval =
          await protocolKit.signTransaction(approvalTransaction);
        const approvalResult =
          await protocolKit.executeTransaction(signedApproval);

        // Wait for confirmation and verify
        if (approvalResult.transactionResponse) {
          logger.info(
            `⏳ Waiting for Permit2 approval transaction to confirm...`
          );

          try {
            const receipt = await (
              approvalResult.transactionResponse as any
            ).wait();
            const txHash =
              receipt?.hash || (approvalResult.transactionResponse as any).hash;

            // Fix: Check for successful transaction status (can be 1, "success", or truthy)
            const isSuccessful =
              receipt &&
              (receipt.status === 1 ||
                receipt.status === "success" ||
                receipt.status === true ||
                (!receipt.status && receipt.hash)); // Some providers don't set status but provide hash

            if (isSuccessful) {
              logger.info(`✅ Permit2 approval confirmed: ${txHash}`);

              // Double-check the allowance was actually set
              await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds for state to propagate

              const newAllowance = await tokenContract.allowance(
                safeAddress,
                permit2Address
              );
              if (newAllowance >= requiredAmount) {
                logger.info(
                  `🎯 Permit2 allowance verified: ${newAllowance.toString()}`
                );
              } else {
                throw new Error(
                  `Permit2 allowance not set correctly. Expected >= ${requiredAmount}, got ${newAllowance}`
                );
              }
            } else {
              throw new Error(
                `Permit2 approval transaction failed with status: ${receipt?.status || "unknown"}`
              );
            }
          } catch (waitError) {
            logger.error(`❌ Failed to confirm Permit2 approval:`, waitError);
            throw new Error(
              `Permit2 approval confirmation failed: ${waitError}`
            );
          }
        } else {
          throw new Error("Permit2 approval transaction returned no response");
        }
      } else {
        logger.info(`✅ Sufficient Permit2 allowance already set`);
      }
    } catch (error) {
      logger.error(`❌ Failed to check/set Permit2 allowance:`, error);
      throw error;
    }
  }

  /**
   * Check and set AllowanceHolder allowance if needed
   */
  private async ensureAllowanceHolderAllowance(
    safeAddress: string,
    tokenAddress: string,
    amount: string,
    allowanceHolderAddress: string,
    chainId: number,
    networkConfig: NetworkConfig
  ): Promise<void> {
    try {
      logger.info(`🔍 Checking AllowanceHolder allowance for ${tokenAddress}`);

      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      // Check current allowance for AllowanceHolder
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function allowance(address owner, address spender) view returns (uint256)",
        ],
        provider
      );

      const currentAllowance = await tokenContract.allowance(
        safeAddress,
        allowanceHolderAddress
      );
      const requiredAmount = BigInt(amount);

      logger.info(
        `📊 Current AllowanceHolder allowance: ${currentAllowance.toString()}, Required: ${requiredAmount.toString()}`
      );

      if (currentAllowance < requiredAmount) {
        logger.info(
          `⚠️ Insufficient AllowanceHolder allowance, setting approval...`
        );

        // Get Safe instance
        const protocolKit = await this.getSafeInstance(
          safeAddress,
          chainId,
          networkConfig
        );

        // Create approval transaction for maximum amount
        const maxAllowance =
          "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"; // Max uint256

        const approvalTransaction = await protocolKit.createTransaction({
          transactions: [
            {
              to: tokenAddress,
              value: "0",
              data: new ethers.Interface([
                "function approve(address spender, uint256 amount)",
              ]).encodeFunctionData("approve", [
                allowanceHolderAddress,
                maxAllowance,
              ]),
            },
          ],
        });

        // Sign and execute approval
        const signedApproval =
          await protocolKit.signTransaction(approvalTransaction);
        const approvalResult =
          await protocolKit.executeTransaction(signedApproval);

        // Wait for confirmation and verify
        if (approvalResult.transactionResponse) {
          logger.info(
            `⏳ Waiting for AllowanceHolder approval transaction to confirm...`
          );

          try {
            const receipt = await (
              approvalResult.transactionResponse as any
            ).wait();
            const txHash =
              receipt?.hash || (approvalResult.transactionResponse as any).hash;

            // Fix: Check for successful transaction status (can be 1, "success", or truthy)
            const isSuccessful =
              receipt &&
              (receipt.status === 1 ||
                receipt.status === "success" ||
                receipt.status === true ||
                (!receipt.status && receipt.hash)); // Some providers don't set status but provide hash

            if (isSuccessful) {
              logger.info(`✅ AllowanceHolder approval confirmed: ${txHash}`);

              // Double-check the allowance was actually set
              await new Promise((resolve) => setTimeout(resolve, 2000)); // Wait 2 seconds for state to propagate

              const newAllowance = await tokenContract.allowance(
                safeAddress,
                allowanceHolderAddress
              );
              if (newAllowance >= requiredAmount) {
                logger.info(
                  `🎯 AllowanceHolder allowance verified: ${newAllowance.toString()}`
                );
              } else {
                throw new Error(
                  `AllowanceHolder allowance not set correctly. Expected >= ${requiredAmount}, got ${newAllowance}`
                );
              }
            } else {
              throw new Error(
                `AllowanceHolder approval transaction failed with status: ${receipt?.status || "unknown"}`
              );
            }
          } catch (waitError) {
            logger.error(
              `❌ Failed to confirm AllowanceHolder approval:`,
              waitError
            );
            throw new Error(
              `AllowanceHolder approval confirmation failed: ${waitError}`
            );
          }
        } else {
          throw new Error(
            "AllowanceHolder approval transaction returned no response"
          );
        }
      } else {
        logger.info(`✅ Sufficient AllowanceHolder allowance already set`);
      }
    } catch (error) {
      logger.error(`❌ Failed to check/set AllowanceHolder allowance:`, error);
      throw error;
    }
  }

  /**
   * Debug method: Check Safe balance and allowances
   */
  async debugSafeState(
    safeAddress: string,
    tokenSymbol: string,
    chainId: number
  ): Promise<void> {
    try {
      const networkConfig = this.getNetworkConfig(chainId);
      const provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);

      logger.info(`🔍 === DEBUGGING SAFE STATE ===`);
      logger.info(`Safe: ${safeAddress} on ${networkConfig.name}`);

      // Get token address
      const tokenAddress = await this.getTokenAddress(tokenSymbol, chainId);
      if (!tokenAddress) {
        logger.error(`❌ Token address not found for ${tokenSymbol}`);
        return;
      }

      logger.info(`Token ${tokenSymbol}: ${tokenAddress}`);

      // Check token balance
      const tokenContract = new ethers.Contract(
        tokenAddress,
        [
          "function balanceOf(address) view returns (uint256)",
          "function decimals() view returns (uint8)",
          "function allowance(address owner, address spender) view returns (uint256)",
        ],
        provider
      );

      const balance = await tokenContract.balanceOf(safeAddress);
      const decimals = await tokenContract.decimals();
      const balanceFormatted = ethers.formatUnits(balance, decimals);

      logger.info(
        `💰 ${tokenSymbol} Balance: ${balanceFormatted} (${balance.toString()} wei)`
      );

      // Check Permit2 allowance
      const permit2Address = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
      const permit2Allowance = await tokenContract.allowance(
        safeAddress,
        permit2Address
      );
      const permit2AllowanceFormatted = ethers.formatUnits(
        permit2Allowance,
        decimals
      );

      logger.info(
        `🔐 Permit2 Allowance: ${permit2AllowanceFormatted} (${permit2Allowance.toString()} wei)`
      );

      // Check AllowanceHolder allowance (common address)
      const allowanceHolderAddress =
        "0x0000000000001ff3684f28c67538d4d072c22734";
      const allowanceHolderAllowance = await tokenContract.allowance(
        safeAddress,
        allowanceHolderAddress
      );
      const allowanceHolderAllowanceFormatted = ethers.formatUnits(
        allowanceHolderAllowance,
        decimals
      );

      logger.info(
        `🏛️ AllowanceHolder Allowance: ${allowanceHolderAllowanceFormatted} (${allowanceHolderAllowance.toString()} wei)`
      );

      // Check Safe threshold and owners
      const protocolKit = await this.getSafeInstance(
        safeAddress,
        chainId,
        networkConfig
      );
      const owners = await protocolKit.getOwners();
      const threshold = await protocolKit.getThreshold();

      logger.info(`👥 Safe Owners (${owners.length}): ${owners.join(", ")}`);
      logger.info(`📏 Safe Threshold: ${threshold}`);

      logger.info(`🔍 === END DEBUG ===`);
    } catch (error) {
      logger.error(`❌ Debug failed:`, error);
    }
  }
}

export default TradeExecutionService;
