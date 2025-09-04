// Re-export NetworkConfig and related utilities from NetworkUtils
export {
  NetworkConfig,
  TokenInfo,
  SUPPORTED_NETWORKS,
  TOKEN_MAP,
} from "../utils/NetworkUtils";
import { NetworkUtils } from "../utils/NetworkUtils";
import { NetworkConfig } from "../utils/NetworkUtils";
// Additional network configuration for the trading system
export const TRADING_NETWORK_CONFIGS = {
  // Gas price settings for different networks
  gasSettings: {
    ethereum: {
      maxFeePerGas: "50000000000", // 50 gwei
      maxPriorityFeePerGas: "2000000000", // 2 gwei
    },
    arbitrum: {
      maxFeePerGas: "1000000000", // 1 gwei
      maxPriorityFeePerGas: "100000000", // 0.1 gwei
    },
    polygon: {
      maxFeePerGas: "100000000000", // 100 gwei
      maxPriorityFeePerGas: "30000000000", // 30 gwei
    },
    base: {
      maxFeePerGas: "2000000000", // 2 gwei
      maxPriorityFeePerGas: "100000000", // 0.1 gwei
    },
    optimism: {
      maxFeePerGas: "2000000000", // 2 gwei
      maxPriorityFeePerGas: "100000000", // 0.1 gwei
    },
    sepolia: {
      maxFeePerGas: "20000000000", // 20 gwei
      maxPriorityFeePerGas: "1000000000", // 1 gwei
    },
  },

  // Preferred networks for different trading scenarios
  preferences: {
    // Networks preferred for large trades (high liquidity)
    highVolume: ["ethereum", "arbitrum", "polygon"],
    // Networks preferred for small trades (low gas costs)
    lowCost: ["arbitrum", "base", "optimism", "polygon"],
    // Testing networks
    testnet: ["sepolia", "arbitrum_sepolia"],
  },
};

// Helper function to get network config by chain ID
export const getNetworkConfigByChainId = (
  chainId: number
): NetworkConfig | null => {
  return NetworkUtils.getNetworkByChainId(chainId);
};

// Helper function to get gas settings for a network
export const getGasSettings = (networkKey: string) => {
  return (
    TRADING_NETWORK_CONFIGS.gasSettings[
      networkKey as keyof typeof TRADING_NETWORK_CONFIGS.gasSettings
    ] || {
      maxFeePerGas: "20000000000", // 20 gwei default
      maxPriorityFeePerGas: "1000000000", // 1 gwei default
    }
  );
};
