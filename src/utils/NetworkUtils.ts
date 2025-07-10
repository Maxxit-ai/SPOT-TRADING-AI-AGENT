import {
  NATIVE_ETH_ADDRESS,
  NATIVE_MATIC_ADDRESS,
  isNativeTokenAddress,
} from "../constants/addresses";

export interface NetworkConfig {
  networkKey: string;
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  blockExplorer: string;
  safeTransactionService?: string;
}

export const SUPPORTED_NETWORKS: Record<string, NetworkConfig> = {
  ethereum: {
    networkKey: "ethereum",
    chainId: 1,
    name: "Ethereum Mainnet",
    rpcUrl:
      process.env["ETHEREUM_RPC_URL"] ||
      "https://mainnet.infura.io/v3/YOUR_INFURA_KEY",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://etherscan.io",
    safeTransactionService: "https://safe-transaction-mainnet.safe.global",
  },
  sepolia: {
    networkKey: "sepolia",
    chainId: 11155111,
    name: "Sepolia Testnet",
    rpcUrl:
      process.env["ETHEREUM_RPC_URL"] ||
      "https://ethereum-sepolia-rpc.publicnode.com",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://sepolia.etherscan.io",
    safeTransactionService: "https://safe-transaction-sepolia.safe.global",
  },
  arbitrum: {
    networkKey: "arbitrum",
    chainId: 42161,
    name: "Arbitrum One",
    rpcUrl: process.env["ARBITRUM_RPC_URL"] || "https://arb1.arbitrum.io/rpc",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://arbiscan.io",
    safeTransactionService: "https://safe-transaction-arbitrum.safe.global",
  },
  arbitrum_sepolia: {
    networkKey: "arbitrum_sepolia",
    chainId: 421614,
    name: "Arbitrum Sepolia",
    rpcUrl:
      process.env["ARBITRUM_RPC_URL"] ||
      "https://sepolia-rollup.arbitrum.io/rpc",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://sepolia.arbiscan.io",
    safeTransactionService: "https://safe-transaction-arbitrum.safe.global",
  },
  polygon: {
    networkKey: "polygon",
    chainId: 137,
    name: "Polygon Mainnet",
    rpcUrl: process.env["POLYGON_RPC_URL"] || "https://polygon-rpc.com",
    nativeCurrency: { name: "MATIC", symbol: "MATIC", decimals: 18 },
    blockExplorer: "https://polygonscan.com",
    safeTransactionService: "https://safe-transaction-polygon.safe.global",
  },
  base: {
    networkKey: "base",
    chainId: 8453,
    name: "Base",
    rpcUrl: process.env["BASE_RPC_URL"] || "https://mainnet.base.org",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://basescan.org",
    safeTransactionService: "https://safe-transaction-base.safe.global",
  },
  optimism: {
    networkKey: "optimism",
    chainId: 10,
    name: "Optimism",
    rpcUrl: process.env["OPTIMISM_RPC_URL"] || "https://mainnet.optimism.io",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    blockExplorer: "https://optimistic.etherscan.io",
    safeTransactionService: "https://safe-transaction-optimism.safe.global",
  },
};

export interface TokenInfo {
  symbol: string;
  name: string;
  coingeckoId: string;
  addresses: Record<string, string>; // networkKey -> token address
  decimals: number;
}

export const TOKEN_MAP: Record<string, TokenInfo> = {
  ETH: {
    symbol: "ETH",
    name: "Ethereum",
    coingeckoId: "ethereum",
    addresses: {
      ethereum: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
      sepolia: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
      arbitrum: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
      arbitrum_sepolia: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
      base: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
      optimism: NATIVE_ETH_ADDRESS, // Native ETH (DEX standard)
    },
    decimals: 18,
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    coingeckoId: "usd-coin",
    addresses: {
      ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      sepolia: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // USDC testnet
      arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
      arbitrum_sepolia: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d", // USDC testnet
      polygon: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174",
      base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      optimism: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    },
    decimals: 6,
  },
  USDT: {
    symbol: "USDT",
    name: "Tether USD",
    coingeckoId: "tether",
    addresses: {
      ethereum: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      arbitrum: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
      polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
      base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
      optimism: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
    },
    decimals: 6,
  },
  WETH: {
    symbol: "WETH",
    name: "Wrapped Ethereum",
    coingeckoId: "ethereum", // Same as ETH
    addresses: {
      ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      sepolia: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14",
      arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
      arbitrum_sepolia: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73",
      polygon: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
      base: "0x4200000000000000000000000000000000000006",
      optimism: "0x4200000000000000000000000000000000000006",
    },
    decimals: 18,
  },
  ARB: {
    symbol: "ARB",
    name: "Arbitrum",
    coingeckoId: "arbitrum",
    addresses: {
      arbitrum: "0x912CE59144191C1204E64559FE8253a0e49E6548",
      arbitrum_sepolia: "0x912CE59144191C1204E64559FE8253a0e49E6548", // Same on testnet
    },
    decimals: 18,
  },
  MATIC: {
    symbol: "MATIC",
    name: "Polygon",
    coingeckoId: "matic-network",
    addresses: {
      ethereum: "0x7D1AfA7B718fb893dB30A3aBc0Cfc608AaCfeBB0",
      polygon: NATIVE_MATIC_ADDRESS, // Native MATIC (Polygon specific)
    },
    decimals: 18,
  },
};

export class NetworkUtils {
  static getNetworkByChainId(chainId: number): NetworkConfig | null {
    return (
      Object.values(SUPPORTED_NETWORKS).find((n) => n.chainId === chainId) ||
      null
    );
  }

  static getNetworkByKey(networkKey: string): NetworkConfig | null {
    return SUPPORTED_NETWORKS[networkKey] || null;
  }

  static getTokenInfo(symbol: string): TokenInfo | null {
    return TOKEN_MAP[symbol.toUpperCase()] || null;
  }

  static getTokenAddress(symbol: string, networkKey: string): string | null {
    const tokenInfo = this.getTokenInfo(symbol);
    if (!tokenInfo) return null;
    return tokenInfo.addresses[networkKey] || null;
  }

  static determineOptimalNetwork(
    tokenSymbol: string,
    userDeployments: any[]
  ): string | null {
    const tokenInfo = this.getTokenInfo(tokenSymbol);
    if (!tokenInfo) return null;

    // Find networks where both token and user deployments exist
    const availableNetworks = userDeployments
      .map((d) => d.networkKey)
      .filter((networkKey) => tokenInfo.addresses[networkKey]);

    if (availableNetworks.length === 0) return null;

    // Prioritize networks by gas costs (lowest first)
    const networkPriority = [
      "arbitrum",
      "polygon",
      "base",
      "optimism",
      "ethereum",
    ];

    for (const network of networkPriority) {
      if (availableNetworks.includes(network)) {
        return network;
      }
    }

    return availableNetworks[0]; // Fallback to first available
  }

  static isNativeToken(tokenSymbol: string, networkKey: string): boolean {
    const tokenInfo = this.getTokenInfo(tokenSymbol);
    if (!tokenInfo) return false;

    const address = tokenInfo.addresses[networkKey];
    if (!address) return false;
    return isNativeTokenAddress(address);
  }

  static formatTokenAmount(amount: string, decimals: number): bigint {
    const [whole, decimal = ""] = amount.split(".");
    const paddedDecimal = decimal.padEnd(decimals, "0").slice(0, decimals);
    return BigInt(whole + paddedDecimal);
  }

  static parseTokenAmount(amount: bigint, decimals: number): string {
    const divisor = BigInt(10 ** decimals);
    const whole = amount / divisor;
    const remainder = amount % divisor;

    if (remainder === 0n) {
      return whole.toString();
    }

    const decimalStr = remainder.toString().padStart(decimals, "0");
    const trimmedDecimal = decimalStr.replace(/0+$/, "");

    return trimmedDecimal ? `${whole}.${trimmedDecimal}` : whole.toString();
  }
}

export default NetworkUtils;
