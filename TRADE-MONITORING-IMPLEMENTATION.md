# 🚀 Complete Trade Monitoring & Exit System Implementation

## 📋 Overview

I've implemented a comprehensive trade monitoring and exit system for your AI trading bot that addresses the exact requirements you mentioned:

✅ **Persistent Trade Storage**: Trades are now stored in MongoDB for monitoring  
✅ **Automated Exit Monitoring**: TP1, TP2, SL, and Max Exit Time monitoring  
✅ **Automated Exit Execution**: When conditions are met, trades are automatically exited  
✅ **Trade History & P&L Tracking**: Complete trade history with profit/loss calculation  
✅ **Real-time Monitoring**: Continuous price monitoring every 30 seconds  
✅ **API Endpoints**: Full API access to monitor and control trades

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE TRADE MONITORING SYSTEM                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                 │
│  1. SIGNAL PROCESSING         2. TRADE EXECUTION         3. TRADE MONITORING   │
│  ┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐ │
│  │ ApiSignalProcessor  │────▶│ TradeExecutionService│────▶│ TradeMonitoringService│ │
│  │ • Receives signals  │     │ • Executes swaps    │     │ • Monitors exits    │ │
│  │ • Validates data    │     │ • Stores in MongoDB │     │ • Triggers exits    │ │
│  └─────────────────────┘     └─────────────────────┘     └─────────────────────┘ │
│           │                           │                           │             │
│           ▼                           ▼                           ▼             │
│  ┌─────────────────────────────────────────────────────────────────────────────┐ │
│  │                          MONGODB STORAGE                                   │ │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────────────────────┐ │ │
│  │  │ trading-signals │ │ safes           │ │ executed-trades (NEW)           │ │ │
│  │  │ • Signal data   │ │ • User safes    │ │ • Active trades                 │ │ │
│  │  │ • TP/SL/Max time│ │ • Deployments   │ │ • Exit conditions               │ │ │
│  │  └─────────────────┘ └─────────────────┘ │ • Trade history & P&L           │ │ │
│  │                                          └─────────────────────────────────┘ │ │
│  └─────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                 │
│  4. EXIT MONITORING           5. PRICE MONITORING       6. API ENDPOINTS       │
│  ┌─────────────────────┐     ┌─────────────────────┐     ┌─────────────────────┐ │
│  │ • Every 30 seconds  │     │ PriceMonitoringService│     │ • /api/trades/*     │ │
│  │ • Check TP/SL/Time  │     │ • CoinGecko API     │     │ • Monitor status    │ │
│  │ • Auto exit trades  │     │ • Real-time prices  │     │ • Manual exits      │ │
│  └─────────────────────┘     └─────────────────────┘     └─────────────────────┘ │
│                                                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Complete Flow Explanation

### 1. **Trade Execution & Storage**

When a trade is successfully executed:

```typescript
// After successful swap in TradeExecutionService
const monitoringData = {
  tradeId: tradeData.tradeId,
  userId: tradeData.userId,
  safeAddress: tradeData.safeAddress,
  tokenSymbol: tradeData.tokenMentioned,
  signalMessage: tradeData.signalMessage,
  entryPrice: tradeData.currentPrice,
  tp1: tradeData.tp1, // Take Profit 1
  tp2: tradeData.tp2, // Take Profit 2
  sl: tradeData.sl, // Stop Loss
  maxExitTime: tradeData.maxExitTime,
  entryTxHash: result.transactionHash,
  entryAmount: result.amountOut,
};

await this.tradeMonitoringService.addTradeToMonitoring(monitoringData);
```

### 2. **Continuous Monitoring**

The `TradeMonitoringService` monitors every 30 seconds:

```typescript
// Check exit conditions for each active trade
const exitCondition = this.checkExitConditions(trade, currentPrice);

if (exitCondition.triggered) {
  await this.executeTradeExit(trade, exitCondition);
}
```

### 3. **Exit Condition Logic**

For **BUY** positions:

```typescript
// Max Exit Time (highest priority)
if (now >= trade.maxExitTime) return "MAX_EXIT_TIME";

// Stop Loss
if (currentPrice <= trade.sl) return "STOP_LOSS";

// Take Profits
if (currentPrice >= trade.tp2) return "TP2";
if (currentPrice >= trade.tp1) return "TP1";
```

### 4. **Automated Exit Execution**

When exit condition is met:

```typescript
// Execute reverse trade (sell if original was buy)
const exitTradeData = {
  signalMessage: trade.signalMessage === "buy" ? "sell" : "buy",
  entryAmount: trade.entryAmount, // Use full position size
};

await this.tradeExecutionService.executeTrade(exitTradeData, trade.entryAmount);

// Calculate P&L
const profitLoss =
  trade.signalMessage === "buy"
    ? exitValue - entryValue
    : entryValue - exitValue;

// Update database
await this.databaseService.updateTradeStatus(trade._id, "exited", exitData);
```

---

## 📊 MongoDB Collections Schema

### New Collection: `executed-trades`

```javascript
{
  "_id": ObjectId("..."),
  "tradeId": "trade_1640995200000",
  "userId": "abhidavinci",
  "safeAddress": "0x742d35Cc6634C0532925a3b8d02d8C61Aa542De9",
  "networkKey": "arbitrum",
  "tokenSymbol": "ETH",
  "tokenMentioned": "ETH",
  "signalMessage": "buy",
  "entryPrice": 2400.0,
  "tp1": 2500.0,
  "tp2": 2600.0,
  "sl": 2350.0,
  "maxExitTime": ISODate("2025-01-20T15:30:00Z"),
  "entryTxHash": "0x1234...abcd",
  "entryAmount": "0.1",
  "executedAt": ISODate("2025-01-20T14:30:00Z"),
  "status": "active",          // active, exited, failed
  "createdAt": ISODate("2025-01-20T14:30:00Z"),
  "updatedAt": ISODate("2025-01-20T14:30:00Z"),

  // Added when trade is exited
  "exitData": {
    "exitType": "TP1",
    "exitPrice": 2505.0,
    "exitAmount": "0.1",
    "profitLoss": 10.5,
    "exitedAt": ISODate("2025-01-20T16:15:00Z")
  }
}
```

---

## 🔌 New API Endpoints

### 1. **Monitor System Status**

```bash
GET /api/trades/monitoring/status
```

Response:

```json
{
  "success": true,
  "monitoringStatus": {
    "isRunning": true,
    "monitoredTradesCount": 3,
    "monitoringInterval": 30000,
    "lastCheck": "2025-01-20T14:30:00Z",
    "trades": [
      {
        "tradeId": "trade_123",
        "tokenSymbol": "ETH",
        "currentPrice": 2450,
        "entryPrice": 2400,
        "tp1": 2500,
        "sl": 2350,
        "timeRemaining": "2h 15m"
      }
    ]
  }
}
```

### 2. **Get Active Trades**

```bash
GET /api/trades/active
```

Response:

```json
{
  "success": true,
  "activeTrades": [...],
  "count": 3
}
```

### 3. **Get Trade History**

```bash
GET /api/trades/history?userId=abhidavinci&limit=10
```

Response:

```json
{
  "success": true,
  "trades": [...],
  "count": 10
}
```

### 4. **Manual Exit Trade**

```bash
POST /api/trades/{tradeId}/exit
{
  "reason": "Manual exit due to market conditions"
}
```

### 5. **Get Specific Trade Status**

```bash
GET /api/trades/{tradeId}/status
```

---

## 🚀 How to Use the System

### 1. **Start the Enhanced System**

```bash
npm run dev
```

The system will automatically:

- Load active trades from MongoDB on startup
- Start monitoring all active trades
- Begin checking exit conditions every 30 seconds

### 2. **Execute a Trade with Monitoring**

Send a signal via API:

```bash
POST /api/signal/process
{
  "Signal Message": "buy",
  "Token Mentioned": "ETH",
  "TP1": 2500,
  "TP2": 2600,
  "SL": 2350,
  "Current Price": 2400,
  "Max Exit Time": {"$date": "2025-01-20T23:59:59Z"},
  "username": "abhidavinci",
  "safeAddress": "0x742d35Cc6634C0532925a3b8d02d8C61Aa542De9"
}
```

The system will:

1. ✅ Execute the trade
2. ✅ Store it in MongoDB
3. ✅ Start monitoring for exit conditions
4. ✅ Automatically exit when TP/SL/Max time reached

### 3. **Monitor Your Trades**

```bash
# Check system status
curl http://localhost:3000/api/trades/monitoring/status

# View active trades
curl http://localhost:3000/api/trades/active

# Check trade history
curl http://localhost:3000/api/trades/history?userId=abhidavinci
```

### 4. **Manual Exit if Needed**

```bash
curl -X POST http://localhost:3000/api/trades/trade_123/exit \
  -H "Content-Type: application/json" \
  -d '{"reason": "Manual exit"}'
```

---

## 🧪 Test the Complete System

I've created a comprehensive test script:

```bash
npx ts-node src/test-trade-monitoring-flow.ts
```

This test will:

1. Connect to MongoDB
2. Simulate trade execution and storage
3. Start monitoring services
4. Test exit condition logic
5. Display monitoring status

---

## 🔧 Configuration

Add to your `.env`:

```bash
# MongoDB configuration for trades collection
MONGODB_SIGNAL_FLOW_URI=mongodb://localhost:27017/ctxbt-signal-flow
MONGODB_SIGNAL_FLOW_DB=ctxbt-signal-flow
MONGODB_TRADES_COLLECTION=executed-trades
```

---

## 📈 Key Features & Benefits

### ✅ **What's New & Working:**

1. **Persistent Storage**: All executed trades stored in MongoDB
2. **Automatic Monitoring**: Continuous monitoring of TP/SL/Max Exit Time
3. **Automated Exits**: When conditions met, trades automatically exit
4. **P&L Tracking**: Real-time profit/loss calculation
5. **Trade History**: Complete history of all trades
6. **API Access**: Full API to monitor and control trades
7. **Resilient**: System restarts don't lose trade monitoring
8. **Real-time**: 30-second monitoring intervals

### ✅ **Exit Conditions Supported:**

- **Take Profit 1 (TP1)**: Exit when price reaches TP1 level
- **Take Profit 2 (TP2)**: Exit when price reaches TP2 level
- **Stop Loss (SL)**: Exit when price hits stop loss
- **Max Exit Time**: Exit when maximum time is reached
- **Manual Exit**: API endpoint for manual exits

---

## 🎯 Usage Summary

Your trading system now has **complete trade monitoring**:

1. **Execute a trade** → Automatically stored in MongoDB
2. **System monitors** → TP1, TP2, SL, Max Exit Time every 30 seconds
3. **Exit triggered** → Automatically executes exit trade
4. **P&L calculated** → Profit/loss tracked and stored
5. **History maintained** → All trades stored for analysis

The system addresses your exact requirements:

- ✅ Trades are executing and swapping successfully
- ✅ Signal objects with TPs, SL, and Max exit time are used
- ✅ Trade data stored in MongoDB for monitoring
- ✅ Automated exit based on conditions
- ✅ Complete trade history and P&L tracking

You can now monitor all your trades through the API endpoints and have confidence that your positions will be automatically exited when your specified conditions are met!
