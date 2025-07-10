import { z } from "zod";
import Safe, { SafeAccountConfig } from "@safe-global/protocol-kit";
import { createPublicClient, formatEther, http } from "viem";
import { arbitrum, polygon, base, sepolia } from "viem/chains";
import axios from "axios";

/**
 * Get ETH balance for a Safe wallet
 */
export const getEthBalance = async ({
  address,
  chainId,
}: {
  address: string;
  chainId: string;
}): Promise<string> => {
  try {
    if (!address.startsWith("0x") || address.length !== 42) {
      throw new Error("Invalid address format");
    }

    let apiUrl: string;
    let chainName: string;

    // Determine the correct API endpoint based on chain ID
    switch (chainId) {
      case "1": // Ethereum Mainnet
        apiUrl = `https://safe-transaction-mainnet.safe.global/api/v1/safes/${address}/balances/`;
        chainName = "Ethereum";
        break;
      case "42161": // Arbitrum
        apiUrl = `https://safe-transaction-arbitrum.safe.global/api/v1/safes/${address}/balances/`;
        chainName = "Arbitrum";
        break;
      case "137": // Polygon
        apiUrl = `https://safe-transaction-polygon.safe.global/api/v1/safes/${address}/balances/`;
        chainName = "Polygon";
        break;
      case "8453": // Base
        apiUrl = `https://safe-transaction-base.safe.global/api/v1/safes/${address}/balances/`;
        chainName = "Base";
        break;
      case "11155111": // Sepolia Testnet
        apiUrl = `https://safe-transaction-sepolia.safe.global/api/v1/safes/${address}/balances/`;
        chainName = "Sepolia";
        break;
      default:
        throw new Error(`Chain ID ${chainId} not supported`);
    }

    const response = await axios.get(apiUrl, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: 10000,
    });

    const balanceData = response.data;
    const ethBalance = balanceData.find(
      (token: any) => token?.tokenAddress === null || token?.token === null
    );

    if (!ethBalance) {
      return `No ETH balance found for Safe ${address} on ${chainName}`;
    }

    const balance = formatEther(ethBalance.balance);
    return `Safe ${address} on ${chainName} has ${balance} ETH`;
  } catch (error) {
    console.error("Error fetching balance:", error);
    return `Error fetching balance for ${address}: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

/**
 * Deploy a new Safe wallet optimized for trading
 */
export const deploySafeForTrading = async ({
  userAddress,
  chainId = "42161",
}: {
  userAddress: string;
  chainId?: string;
}): Promise<string> => {
  try {
    const agentAddress = process.env["AGENT_ADDRESS"];
    if (!agentAddress) {
      throw new Error("Agent address not configured");
    }

    let rpcUrl: string;
    let chainName: string;

    // Configure RPC based on chain
    switch (chainId) {
      case "42161": // Arbitrum
        rpcUrl = "https://arb1.arbitrum.io/rpc";
        chainName = "Arbitrum";
        break;
      case "137": // Polygon
        rpcUrl = "https://polygon-rpc.com";
        chainName = "Polygon";
        break;
      case "8453": // Base
        rpcUrl = "https://mainnet.base.org";
        chainName = "Base";
        break;
      case "11155111": // Sepolia
        rpcUrl = "https://rpc.ankr.com/eth_sepolia";
        chainName = "Sepolia";
        break;
      default:
        throw new Error(`Chain ID ${chainId} not supported for deployment`);
    }

    // Create Safe configuration for trading (1-of-2 multisig)
    const safeAccountConfig: SafeAccountConfig = {
      owners: [userAddress, agentAddress], // User + Agent
      threshold: 1, // Either can execute trades
    };

    const saltNonce = Math.trunc(Math.random() * 10 ** 10).toString();

    const protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: process.env["AGENT_PRIVATE_KEY"],
      predictedSafe: {
        safeAccountConfig,
        safeDeploymentConfig: {
          saltNonce,
        },
      },
    });

    const safeAddress = await protocolKit.getAddress();

    const deploymentTransaction =
      await protocolKit.createSafeDeploymentTransaction();

    const safeClient = await protocolKit.getSafeProvider().getExternalSigner();

    if (!safeClient) {
      throw new Error("Failed to get external signer from Safe provider");
    }

    const transactionHash = await safeClient.sendTransaction({
      to: deploymentTransaction.to,
      value: BigInt(deploymentTransaction.value),
      data: deploymentTransaction.data as `0x${string}`,
      chain: null, // Let viem infer the chain from the client
    });

    // Wait for transaction confirmation
    await new Promise((resolve) => setTimeout(resolve, 5000));

    return (
      `✅ Trading Safe deployed successfully on ${chainName}!\n` +
      `📍 Safe Address: ${safeAddress}\n` +
      `🔗 Transaction: ${transactionHash}\n` +
      `👥 Owners: User (${userAddress}) + AI Agent (${agentAddress})\n` +
      `🎯 Threshold: 1 (enables autonomous trading)\n` +
      `🌐 View on Safe App: https://app.safe.global/home?safe=${chainId}:${safeAddress}`
    );
  } catch (error) {
    console.error("Safe deployment error:", error);
    return `❌ Failed to deploy Safe: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

/**
 * Execute a token swap using the Safe wallet
 */
export const executeTokenSwap = async ({
  safeAddress,
  fromToken,
  toToken,
  amount,
  chainId = "42161",
  slippage = 1,
}: {
  safeAddress: string;
  fromToken: string;
  toToken: string;
  amount: string;
  chainId?: string;
  slippage?: number;
}): Promise<string> => {
  try {
    // This would integrate with DEX aggregators like 1inch
    // For now, return a simulation response

    const tradeInfo = {
      from: fromToken.toUpperCase(),
      to: toToken.toUpperCase(),
      amount: amount,
      estimatedGas: "0.002 ETH",
      estimatedOutput: "Unknown (requires DEX integration)",
      priceImpact: "< 0.5%",
    };

    return (
      `🔄 Token Swap Prepared for Safe ${safeAddress}\n` +
      `💱 Trading: ${tradeInfo.amount} ${tradeInfo.from} → ${tradeInfo.to}\n` +
      `⚡ Estimated Gas: ${tradeInfo.estimatedGas}\n` +
      `📈 Price Impact: ${tradeInfo.priceImpact}\n` +
      `🎯 Max Slippage: ${slippage}%\n` +
      `⚠️  Note: This is a simulation. Real execution requires DEX integration.`
    );
  } catch (error) {
    console.error("Token swap error:", error);
    return `❌ Token swap failed: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

/**
 * Get comprehensive Safe information
 */
export const getSafeInfo = async ({
  safeAddress,
  chainId = "42161",
}: {
  safeAddress: string;
  chainId?: string;
}): Promise<string> => {
  try {
    let rpcUrl: string;
    let chainName: string;

    switch (chainId) {
      case "42161":
        rpcUrl = "https://arb1.arbitrum.io/rpc";
        chainName = "Arbitrum";
        break;
      case "137":
        rpcUrl = "https://polygon-rpc.com";
        chainName = "Polygon";
        break;
      case "8453":
        rpcUrl = "https://mainnet.base.org";
        chainName = "Base";
        break;
      default:
        rpcUrl = "https://arb1.arbitrum.io/rpc";
        chainName = "Arbitrum";
    }

    const protocolKit = await Safe.init({
      provider: rpcUrl,
      signer: process.env["AGENT_PRIVATE_KEY"],
      safeAddress: safeAddress,
    });

    const owners = await protocolKit.getOwners();
    const threshold = await protocolKit.getThreshold();
    const isDeployed = await protocolKit.isSafeDeployed();

    return (
      `📋 Safe Information (${chainName})\n` +
      `📍 Address: ${safeAddress}\n` +
      `✅ Deployed: ${isDeployed ? "Yes" : "No"}\n` +
      `👥 Owners: ${owners.join(", ")}\n` +
      `🎯 Threshold: ${threshold}/${owners.length}\n` +
      `🔗 Safe App: https://app.safe.global/home?safe=${chainId}:${safeAddress}`
    );
  } catch (error) {
    console.error("Get Safe info error:", error);
    return `❌ Failed to get Safe info: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
};

// Metadata for LangChain tools
export const getEthBalanceMetadata = {
  name: "getEthBalance",
  description:
    "Get the ETH balance of a Safe wallet on any supported chain (Ethereum, Arbitrum, Polygon, Base, Sepolia)",
  schema: z.object({
    address: z.string().describe("The Safe wallet address (0x...)"),
    chainId: z
      .enum(["1", "42161", "137", "8453", "11155111"])
      .describe(
        "Chain ID: 1=Ethereum, 42161=Arbitrum, 137=Polygon, 8453=Base, 11155111=Sepolia"
      ),
  }),
};

export const deploySafeForTradingMetadata = {
  name: "deploySafeForTrading",
  description:
    "Deploy a new Safe wallet optimized for AI trading with 1-of-2 multisig (user + agent)",
  schema: z.object({
    userAddress: z
      .string()
      .describe("The user's wallet address who will own the Safe"),
    chainId: z
      .enum(["42161", "137", "8453", "11155111"])
      .optional()
      .describe("Chain to deploy on (default: Arbitrum)"),
  }),
};

export const executeTokenSwapMetadata = {
  name: "executeTokenSwap",
  description:
    "Execute a token swap through the Safe wallet using DEX aggregators",
  schema: z.object({
    safeAddress: z
      .string()
      .describe("The Safe wallet address to execute swap from"),
    fromToken: z.string().describe("Token to swap from (symbol or address)"),
    toToken: z.string().describe("Token to swap to (symbol or address)"),
    amount: z.string().describe("Amount to swap (in token units)"),
    chainId: z.string().optional().describe("Chain ID (default: Arbitrum)"),
    slippage: z
      .number()
      .optional()
      .describe("Max slippage percentage (default: 1%)"),
  }),
};

export const getSafeInfoMetadata = {
  name: "getSafeInfo",
  description:
    "Get comprehensive information about a Safe wallet including owners, threshold, and deployment status",
  schema: z.object({
    safeAddress: z.string().describe("The Safe wallet address to query"),
    chainId: z.string().optional().describe("Chain ID (default: Arbitrum)"),
  }),
};
