const { ethers } = require('ethers');

// Configuration
const SAFE_ADDRESS = process.env.DEBUG_SAFE_ADDRESS || '0x7fb6a9fC1edfEE2Fe186f9E7B237fE16Ec36c7b8';

// Network configurations
const NETWORKS = [
    {
        name: 'Arbitrum',
        chainId: 42161,
        rpcUrl: 'https://arb1.arbitrum.io/rpc',
    },
    {
        name: 'Sepolia',
        chainId: 11155111,
        rpcUrl: 'https://ethereum-sepolia-rpc.publicnode.com',
    },
    {
        name: 'Arbitrum Sepolia',
        chainId: 421614,
        rpcUrl: 'https://sepolia-rollup.arbitrum.io/rpc',
    },
    {
        name: 'Base Sepolia',
        chainId: 84532,
        rpcUrl: 'https://sepolia.base.org',
    },
    {
        name: 'Polygon',
        chainId: 137,
        rpcUrl: 'https://polygon-rpc.com',
    },
    {
        name: 'Base',
        chainId: 8453,
        rpcUrl: 'https://mainnet.base.org',
    },
    {
        name: 'Optimism',
        chainId: 10,
        rpcUrl: 'https://mainnet.optimism.io',
    },
];

async function debugSafeNetworkDeployment() {
    console.log('🔍 Debugging Safe Network Deployment');
    console.log('📍 Safe Address:', SAFE_ADDRESS);
    console.log('');

    for (const network of NETWORKS) {
        try {
            console.log(`🌐 Checking ${network.name} (chainId: ${network.chainId})`);

            const provider = new ethers.JsonRpcProvider(network.rpcUrl);

            // Check if address has contract code
            const code = await provider.getCode(SAFE_ADDRESS);
            const hasCode = code && code !== '0x';

            if (hasCode) {
                console.log(`   ✅ Safe EXISTS on ${network.name}`);
                console.log(`   📄 Contract code length: ${code.length} characters`);

                // Try to get some basic info
                try {
                    const balance = await provider.getBalance(SAFE_ADDRESS);
                    console.log(`   💰 Balance: ${ethers.formatEther(balance)} ETH`);
                } catch (error) {
                    console.log(`   ⚠️  Could not fetch balance: ${error.message}`);
                }

                // Try to interact with Safe contract
                try {
                    const safeContract = new ethers.Contract(
                        SAFE_ADDRESS,
                        [
                            'function getOwners() external view returns (address[])',
                            'function getThreshold() external view returns (uint256)',
                            'function VERSION() external view returns (string)',
                        ],
                        provider
                    );

                    const owners = await safeContract.getOwners();
                    const threshold = await safeContract.getThreshold();

                    console.log(`   👥 Owners (${owners.length}):`, owners);
                    console.log(`   🎯 Threshold: ${threshold.toString()}`);

                    try {
                        const version = await safeContract.VERSION();
                        console.log(`   📦 Version: ${version}`);
                    } catch (versionError) {
                        console.log(`   📦 Version: Could not determine (${versionError.message})`);
                    }

                } catch (contractError) {
                    console.log(`   ⚠️  Could not read Safe contract: ${contractError.message}`);
                }

            } else {
                console.log(`   ❌ Safe NOT FOUND on ${network.name}`);
            }

            console.log('');

        } catch (error) {
            console.log(`   💥 Error checking ${network.name}: ${error.message}`);
            console.log('');
        }
    }

    console.log('🏁 Debug complete!');
    console.log('');
    console.log('💡 Tips:');
    console.log('   - If Safe exists on multiple networks, ensure you\'re using the correct one');
    console.log('   - If Safe doesn\'t exist anywhere, it may need to be deployed');
    console.log('   - Check your .env file for correct AGENT_PRIVATE_KEY and network URLs');
    console.log('   - Verify the Safe address is correct');
}

// Add command line argument support
if (process.argv.length > 2) {
    const providedAddress = process.argv[2];
    if (providedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        process.env.DEBUG_SAFE_ADDRESS = providedAddress;
        console.log(`Using provided Safe address: ${providedAddress}`);
    } else {
        console.log('❌ Invalid Safe address format. Please provide a valid Ethereum address.');
        process.exit(1);
    }
}

// Run the debug script
debugSafeNetworkDeployment().catch((error) => {
    console.error('💥 Debug script failed:', error);
    process.exit(1);
}); 