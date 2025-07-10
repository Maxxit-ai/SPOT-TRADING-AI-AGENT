# 🤖 Autonomous AI Trading Agent - Complete Implementation Guide

## 🎯 Overview

This autonomous AI trading agent automatically executes token trades for multiple users based on trading signals stored in MongoDB. The system watches for new signals via Change Streams and executes trades using Safe smart wallets across multiple networks.

## 🏗️ Architecture

```
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   MongoDB Change    │    │ Autonomous Trading  │    │  Safe Wallets      │
│   Streams Watcher   │◄──►│   Orchestrator     │◄──►│  (Multi-chain)     │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│  Trading Signals    │    │  Price Monitoring   │    │  Trade Execution    │
│  • Signal Data      │    │  • CoinGecko API    │    │  • DEX Integration  │
│  • Subscribers      │    │  • Exit Conditions  │    │  • Gas Optimization │
│  • Target Prices    │    │  • Trailing Stops   │    │  • Multi-network    │
└─────────────────────┘    └─────────────────────┘    └─────────────────────┘
```

## 🔧 Core Components

### 1. **DatabaseService** (`src/services/DatabaseService.ts`)

- Manages connections to both signal flow and Safe deployment databases
- Creates MongoDB Change Streams for real-time signal watching
- Queries user Safe deployments across networks

### 2. **TradingSignalWatcher** (`src/services/TradingSignalWatcher.ts`)

- Main orchestrator that watches for new trading signals
- Processes subscriber lists and creates trades
- Manages execution queue with priority handling

### 3. **TradeExecutionService** (`src/services/TradeExecutionService.ts`)

- Handles Safe-based token swaps using Safe SDK
- Integrates with DEX aggregators for optimal pricing
- Manages Safe instances across multiple networks

### 4. **PriceMonitoringService** (`src/services/PriceMonitoringService.ts`)

- Continuously monitors token prices using CoinGecko API
- Tracks exit conditions (TP1, TP2, Stop Loss, Trailing Stop)
- Emits events when exit conditions are met

### 5. **TradeStateManager** (`src/services/TradeStateManager.ts`)

- Manages trade lifecycle and state transitions
- Tracks P&L, performance metrics, and trade history
- Handles trade queuing and execution planning

### 6. **NetworkUtils** (`src/utils/NetworkUtils.ts`)

- Network configuration and token mapping utilities
- Determines optimal networks for token trading
- Handles token amount formatting and parsing

## 🚀 Getting Started

### 1. Environment Setup

```bash
# Copy environment configuration
cp env.example .env

# Update MongoDB configuration
MONGODB_URI=
SIGNAL_FLOW_DB=ctxbt-signal-flow
SIGNAL_FLOW_COLLECTION=trading-signals
SAFE_DEPLOYMENT_DB=safe-deployment-service
SAFE_COLLECTION=safes

# Configure autonomous trading
AUTONOMOUS_TRADING_ENABLED=true
DEFAULT_POSITION_SIZE_USD=100
ENABLE_TRAILING_STOP=true
TRAILING_STOP_RETRACEMENT=2
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Start the Agent

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start

# CLI mode
npm run agent
```

## 📡 API Endpoints

### Enhanced Autonomous Trading

#### Start Autonomous Trading

```bash
POST /api/autonomous/start
Content-Type: application/json

{
  "positionSizeUsd": 100,
  "enableTrailingStop": true
}
```

#### Stop Autonomous Trading

```bash
POST /api/autonomous/stop
```

#### Get System Status

```bash
GET /api/autonomous/status
```

#### Get User Portfolio

```bash
GET /api/autonomous/portfolio/:userId
```

#### Manual Trade Exit

```bash
POST /api/autonomous/trade/:tradeId/exit
Content-Type: application/json

{
  "reason": "MANUAL"
}
```

#### Emergency Stop

```bash
POST /api/autonomous/emergency-stop
```

## 🔄 Trading Signal Flow

### 1. Signal Structure

```javascript
{
  "_id": "685de952f4feaa0849e3eb7a",
  "tweet_id": "1938171587313770646",
  "twitterHandle": "LSTraderCrypto",
  "coin": "ethereum",
  "signal_data": {
    "token": "ETH (ethereum)",
    "signal": "Buy",
    "currentPrice": 2419.5662913663004,
    "targets": [2600, 2650],
    "stopLoss": 2350,
    "timeline": "Short-term (next 3 days)",
    "maxExitTime": "2025-06-30T23:59:59Z",
    "tokenMentioned": "ETH",
    "tokenId": "ethereum"
  },
  "subscribers": [
    {
      "username": "abhidavinci",
      "sent": false
    }
  ]
}
```

### 2. Processing Pipeline

1. **Signal Detection**: MongoDB Change Stream detects new signal
2. **Subscriber Processing**: For each subscriber:
   - Query user's Safe deployments
   - Determine optimal network for token
   - Create trade entry in state manager
   - Queue trade for execution
3. **Trade Execution**:
   - Check token balance
   - Execute swap via Safe SDK
   - Update trade state to "entered"
   - Start price monitoring
4. **Exit Monitoring**:
   - Monitor price for exit conditions
   - Execute exit swaps when conditions met
   - Update trade state and calculate P&L

## 💡 AI Agent Integration

### Chat Commands

The AI agent now includes autonomous trading capabilities:

```bash
# Start autonomous trading
"Start autonomous trading with $200 position size"

# Check status
"What's the status of autonomous trading?"

# Get portfolio for a user
"Show me portfolio summary for user abhidavinci"

# Manual trade exit
"Exit trade abc123 manually"

# Emergency stop
"Emergency stop all trading activities"
```

### LangChain Tools

The agent includes these new tools:

- `startAutonomousTrading`: Start the autonomous system
- `stopAutonomousTrading`: Stop autonomous trading
- `getAutonomousStatus`: Get system status
- `getUserPortfolioSummary`: Get user portfolio
- `manualTradeExit`: Exit specific trades
- `emergencyStopAll`: Emergency stop all activities

## 🔐 Security Features

### Safe Wallet Integration

- **1-of-2 Multisig**: User + AI Agent ownership
- **Autonomous Execution**: Agent can trade independently
- **User Override**: Users maintain full control

### Risk Management

- **Position Limits**: Maximum position sizes per trade
- **Daily Limits**: Maximum trades per user per day
- **Stop Losses**: Automatic loss prevention
- **Emergency Stop**: Immediate halt of all activities

## 📊 Exit Conditions

### 1. **Take Profit (TP1/TP2)**

```javascript
if (currentPrice >= tp1) {
  exitCondition = "TP1";
} else if (currentPrice >= tp2) {
  exitCondition = "TP2";
}
```

### 2. **Stop Loss**

```javascript
if (currentPrice <= stopLoss) {
  exitCondition = "STOP_LOSS";
}
```

### 3. **Trailing Stop**

```javascript
if (currentPrice >= tp2) {
  const trailingStopPrice = trailingHigh * (1 - retracement / 100);
  if (currentPrice <= trailingStopPrice) {
    exitCondition = "TRAILING_STOP";
  }
}
```

### 4. **Max Exit Time**

```javascript
if (now >= maxExitTime) {
  exitCondition = "MAX_EXIT_TIME";
}
```

## 🌐 Multi-Network Support

### Supported Networks

- **Arbitrum** (Primary) - Low fees, fast execution
- **Polygon** - Ultra-low fees
- **Base** - Coinbase L2
- **Optimism** - Ethereum L2
- **Ethereum** - Mainnet (higher fees)
- **Sepolia** - Testnet

### Network Selection

The system automatically selects the optimal network based on:

1. Token availability on the network
2. User's Safe deployments
3. Gas cost optimization
4. Network priority (lowest fees first)

## 📈 Performance Monitoring

### Metrics Tracked

- **Total P&L**: Cumulative profit/loss
- **Win Rate**: Percentage of profitable trades
- **Average Holding Time**: Time between entry and exit
- **Active Trades**: Currently open positions
- **Trade Volume**: Total value traded

### Real-time Updates

- WebSocket notifications for trade events
- Price monitoring every 30 seconds
- Execution queue processing every 5 seconds
- Portfolio updates in real-time

## 🛠️ Configuration

### Trading Configuration

```typescript
interface TradingConfig {
  positionSizeUsd: number; // Default position size
  maxDailyTrades: number; // Max trades per user per day
  enableTrailingStop: boolean; // Enable trailing stops
  trailingStopRetracement: number; // Trailing stop percentage
  defaultSlippage: number; // Default slippage tolerance
  gasBuffer: number; // Extra gas percentage
}
```

### Database Configuration

```typescript
interface DatabaseConfig {
  signalFlowUri: string; // MongoDB URI for signals
  signalFlowDb: string; // Signal database name
  signalFlowCollection: string; // Signal collection name
  safeDeploymentUri: string; // MongoDB URI for Safes
  safeDeploymentDb: string; // Safe database name
  safeCollection: string; // Safe collection name
}
```

## 🚨 Emergency Procedures

### Emergency Stop

1. Stops signal watching immediately
2. Queues exit for all active trades
3. Prevents new trade execution
4. Maintains existing Safe permissions

### Manual Intervention

- Individual trade exits via API
- Portfolio monitoring continues
- User retains full Safe control
- Trade history preserved

## 🔍 Debugging

### Log Files

- `autonomous-trading.log`: Main orchestrator logs
- `trading-signal-watcher.log`: Signal processing logs
- `trade-execution.log`: Trade execution logs
- `price-monitoring.log`: Price monitoring logs
- `trade-state.log`: Trade state management logs
- `database.log`: Database operations logs

### Debug Mode

Set `NODE_ENV=development` for detailed logging and debug information.

## 🎯 Production Deployment

### 1. Environment Setup

```bash
# Production environment
NODE_ENV=production
AUTONOMOUS_TRADING_ENABLED=true

# Security
JWT_SECRET=your-production-jwt-secret
ENCRYPTION_KEY=your-production-encryption-key

# Monitoring
LOG_LEVEL=info
LOG_TO_FILE=true
```

### 2. Process Management

```bash
# Using PM2
pm2 start npm --name "ai-trading-agent" -- start
pm2 startup
pm2 save
```

### 3. Health Monitoring

```bash
# Health check endpoint
curl http://localhost:3001/health

# Autonomous status
curl http://localhost:3001/api/autonomous/status
```

## 🤝 Contributing

### Adding New Features

1. Follow the existing service architecture
2. Implement proper error handling and logging
3. Add comprehensive tests
4. Update documentation

### Code Structure

- Services: `/src/services/`
- Utils: `/src/utils/`
- Tools: `/src/tools/`
- Main Agent: `/src/agent.ts`
- Server: `/src/server.ts`

## 📜 License

MIT License - See LICENSE file for details.

---

**⚠️ Important Note**: This is an autonomous trading system that handles real funds. Always test thoroughly in a development environment before deploying to production. Ensure proper risk management and user consent before enabling autonomous trading features.
