# 🧠 Agentic Trading System - Development Guide

This guide covers setting up and developing the **Agentic Trading System** that uses AI decision-making for intelligent token trading using Safe smart accounts.

## 📋 Table of Contents

- [Prerequisites](#prerequisites)
- [System Architecture](#system-architecture)
- [Development Setup](#development-setup)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Running the System](#running-the-system)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [API Documentation](#api-documentation)
- [Debugging](#debugging)
- [Contributing](#contributing)

## 🔧 Prerequisites

### Required Software

- **Node.js** >= 18.0.0
- **npm** >= 8.0.0
- **MongoDB** >= 5.0
- **Redis** >= 6.0
- **Git**
- **TypeScript** >= 4.9.0

### Required Services

- **MongoDB Atlas** or local MongoDB instance
- **CoinGecko API** access (free tier available)
- **Safe Global Protocol Kit** dependencies
- **OpenAI API** access for AI agent

### Development Tools (Recommended)

- **VS Code** with TypeScript extension
- **MongoDB Compass** for database management
- **Postman** or **Insomnia** for API testing
- **Docker** for containerized development (optional)

## 🏗️ System Architecture

### Core Components

```
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│   AI Agent      │    │  Agentic Trading    │    │   Safe Wallets      │
│  (LangChain)    │◄──►│   Orchestrator      │◄──►│   (Multi-chain)     │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
         ▲                        ▲                        ▲
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────┐    ┌─────────────────────┐    ┌─────────────────────┐
│  Market Data    │    │   MongoDB           │    │  Trade Execution    │
│  & Analysis     │    │  Signal Streams     │    │  Service (DEX)      │
└─────────────────┘    └─────────────────────┘    └─────────────────────┘
```

### Data Flow

1. **Signal Detection**: MongoDB Change Streams detect new trading signals
2. **AI Analysis**: LangChain agent analyzes signal with market context
3. **Decision Making**: AI decides to approve/reject with position sizing
4. **Safe Execution**: Executes trades through users' Safe wallets
5. **Monitoring**: Continuous price monitoring and AI-driven exit strategies

## 🚀 Development Setup

### 1. Clone Repository

```bash
git clone <repository-url>
cd Demo/agent-backend
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Environment Setup

```bash
cp env.example .env
```

### 4. Configure Environment Variables

Edit `.env` file with your settings:

```env
# Server Configuration
PORT=3006
NODE_ENV=development
CORS_ORIGIN=http://localhost:3000

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/ai-trading-agent
REDIS_URL=redis://localhost:6379

# MongoDB Databases
MONGODB_SIGNAL_FLOW_URI=mongodb://localhost:27017/ctxbt-signal-flow
MONGODB_SIGNAL_FLOW_DB=ctxbt-signal-flow
MONGODB_SIGNAL_FLOW_COLLECTION=trading-signals

MONGODB_SAFE_DEPLOYMENT_URI=mongodb://localhost:27017/safe-deployment-service
MONGODB_SAFE_DEPLOYMENT_DB=safe-deployment-service
MONGODB_SAFE_COLLECTION=safes

# AI Configuration
OPENAI_API_KEY=your_openai_api_key_here

# Trading Configuration
AGENT_PRIVATE_KEY=your_ethereum_private_key_here

# API Configuration
API_RATE_LIMIT=100

# Agentic Trading Configuration
AGENTIC_ENABLED=true
AGENTIC_DEBUG=true
AGENTIC_POSITION_SIZE_USD=100
AGENTIC_MAX_DAILY_TRADES=20
AGENTIC_ENABLE_TRAILING_STOP=true
AGENTIC_TRAILING_STOP_RETRACEMENT=2
AGENTIC_DEFAULT_SLIPPAGE=1
AGENTIC_GAS_BUFFER=20

# External APIs
COINGECKO_API_KEY=your_coingecko_api_key
```

## 💾 Database Setup

### MongoDB Collections Structure

#### 1. Trading Signals Collection (`ctxbt-signal-flow.trading-signals`)

```javascript
{
  "_id": ObjectId("..."),
  "signal_data": {
    "tokenMentioned": "ETH",
    "tokenId": "ethereum",
    "currentPrice": 2419.56,
    "signal": "BUY",
    "targets": [2600, 2650],
    "stopLoss": 2350,
    "timeline": "1-3 days",
    "maxExitTime": "2025-06-30T23:59:59Z",
    "twitterHandle": "@cryptotrader",
    "tweet_id": "1234567890",
    "tradeTip": "Strong support at $2400"
  },
  "subscribers": [
    {"username": "user1", "sent": false},
    {"username": "user2", "sent": false}
  ],
  "generatedAt": ISODate("2024-01-15T10:30:00Z")
}
```

#### 2. Safe Deployments Collection (`safe-deployment-service.safes`)

```javascript
{
  "_id": ObjectId("..."),
  "userInfo": {
    "userId": "user1",
    "email": "user1@example.com"
  },
  "status": "active",
  "deployments": {
    "ethereum": {
      "address": "0x1234567890abcdef...",
      "isActive": true,
      "deploymentStatus": "deployed",
      "networkKey": "ethereum"
    },
    "arbitrum": {
      "address": "0xabcdef1234567890...",
      "isActive": true,
      "deploymentStatus": "deployed",
      "networkKey": "arbitrum"
    }
  }
}
```

### Database Initialization

#### Local MongoDB Setup

```bash
# Install MongoDB locally
brew install mongodb/brew/mongodb-community  # macOS
# or follow installation guide for your OS

# Start MongoDB
brew services start mongodb/brew/mongodb-community

# Connect and create databases
mongosh
> use ctxbt-signal-flow
> db.createCollection("trading-signals")
> use safe-deployment-service
> db.createCollection("safes")
```

#### Sample Data Insertion

```javascript
// Insert test signal
use ctxbt-signal-flow
db['trading-signals'].insertOne({
  "signal_data": {
    "tokenMentioned": "ETH",
    "tokenId": "ethereum",
    "currentPrice": 2419.56,
    "signal": "BUY",
    "targets": [2600, 2650],
    "stopLoss": 2350,
    "timeline": "1-3 days",
    "maxExitTime": "2025-06-30T23:59:59Z",
    "twitterHandle": "@test",
    "tradeTip": "Test signal"
  },
  "subscribers": [{"username": "testuser", "sent": false}],
  "generatedAt": new Date()
});

// Insert test Safe deployment
use safe-deployment-service
db.safes.insertOne({
  "userInfo": {
    "userId": "testuser",
    "email": "test@example.com"
  },
  "status": "active",
  "deployments": {
    "arbitrum": {
      "address": "0x742d35Cc6634C0532925a3b8d02d8C61Aa542De9",
      "isActive": true,
      "deploymentStatus": "deployed",
      "networkKey": "arbitrum"
    }
  }
});
```

## 🏃‍♂️ Running the System

### Development Mode

```bash
# Start with TypeScript compilation and hot reload
npm run dev

# Or start with nodemon
npm start
```

### Production Build

```bash
# Build TypeScript
npm run build

# Start production server
npm run prod
```

### Available Scripts

```bash
npm run dev        # Start development server with hot reload
npm run build      # Compile TypeScript to JavaScript
npm run start      # Start development with nodemon
npm run prod       # Start production server
npm run test       # Run test suite
npm run lint       # Run ESLint
npm run format     # Format code with Prettier
```

## 🔄 Development Workflow

### 1. Starting Development

```bash
# Start MongoDB and Redis
brew services start mongodb-community
brew services start redis

# Start the development server
npm run dev
```

### 2. Verify System Status

```bash
curl http://localhost:3006/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "uptime": 123.456,
  "agent": {
    "initialized": true,
    "status": "ready"
  },
  "database": {
    "mongo": "connected",
    "redis": "connected"
  }
}
```

### 3. Start Agentic Trading

```bash
curl -X POST http://localhost:3006/api/agentic/start \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "debug": true}'
```

### 4. Test Signal Processing

Insert a test signal into MongoDB and watch the AI analyze it:

```javascript
// MongoDB shell
use ctxbt-signal-flow
db['trading-signals'].insertOne({
  "signal_data": {
    "tokenMentioned": "ETH",
    "currentPrice": 2400,
    "targets": [2500, 2600],
    "stopLoss": 2300
  },
  "subscribers": [{"username": "testuser", "sent": false}]
});
```

Watch the logs for AI analysis and decision making.

## 🧪 Testing

### Unit Tests

```bash
npm run test
```

### Integration Tests

```bash
npm run test:integration
```

### API Testing with curl

#### Check Agentic Status

```bash
curl http://localhost:3006/api/agentic/status
```

#### Get Pending Signals

```bash
curl http://localhost:3006/api/agentic/pending-signals
```

#### Get Trading Context

```bash
curl http://localhost:3006/api/agentic/trading-context/ETH
```

#### Manual Trade Exit

```bash
curl -X POST http://localhost:3006/api/agentic/trade/TRADE_ID/exit \
  -H "Content-Type: application/json" \
  -d '{"exitPercentage": 50, "reason": "Manual test exit"}'
```

## 📚 API Documentation

### Core Endpoints

#### Health Check

- **GET** `/health`
- Returns system status and database connections

#### Agent Control

- **POST** `/api/agent/analyze` - Execute AI analysis
- **POST** `/api/agent/trade` - Manual trading instruction
- **POST** `/api/agent/portfolio/:userId` - Portfolio analysis

#### Agentic Trading

- **POST** `/api/agentic/start` - Start AI decision engine
- **POST** `/api/agentic/stop` - Stop AI system
- **GET** `/api/agentic/status` - Get system status
- **GET** `/api/agentic/pending-signals` - Get pending signals
- **POST** `/api/agentic/trade/:tradeId/exit` - AI-powered trade exit
- **GET** `/api/agentic/trading-context/:tokenSymbol` - Get market context

### WebSocket Events

- `agentic-status` - System status updates
- `trade-exited` - Trade exit notifications
- `agent-analysis` - AI analysis results

## 🐛 Debugging

### Log Files

```bash
tail -f agentic-trading.log        # Main agentic system logs
tail -f price-monitoring.log       # Price monitoring logs
tail -f trade-execution.log        # Trade execution logs
tail -f trading-signal-watcher.log # Signal processing logs
tail -f database.log               # Database operations
tail -f trade-state.log            # Trade state management
```

### Debug Environment Variables

```env
NODE_ENV=development
AGENTIC_DEBUG=true
LOG_LEVEL=debug
```

### Common Issues

#### MongoDB Connection Issues

```bash
# Check MongoDB status
brew services list | grep mongodb

# View MongoDB logs
tail -f /usr/local/var/log/mongodb/mongo.log
```

#### Redis Connection Issues

```bash
# Check Redis status
redis-cli ping

# View Redis logs
tail -f /usr/local/var/log/redis.log
```

#### AI Agent Not Responding

1. Check OpenAI API key in `.env`
2. Verify API rate limits
3. Check agent initialization in logs

#### Safe Wallet Integration Issues

1. Verify `AGENT_PRIVATE_KEY` is set
2. Check network configurations in `NetworkUtils.ts`
3. Ensure Safe deployments exist in database

### Debug Checklist

- [ ] Environment variables properly set
- [ ] MongoDB and Redis running and connected
- [ ] OpenAI API key valid and has credits
- [ ] Test data exists in databases
- [ ] Network connections working
- [ ] Log files showing expected activity

## 🤝 Contributing

### Code Style

- Use TypeScript strict mode
- Follow ESLint and Prettier configurations
- Write comprehensive JSDoc comments
- Use semantic commit messages

### Pull Request Process

1. Create feature branch from `main`
2. Implement changes with tests
3. Update documentation if needed
4. Ensure all tests pass
5. Submit PR with clear description

### Development Standards

- **Error Handling**: Always use try-catch blocks
- **Logging**: Use structured logging with winston
- **Type Safety**: Leverage TypeScript features
- **Security**: Never commit private keys or secrets
- **Performance**: Profile database queries and API calls

## 🔗 Related Documentation

- [Production Deployment Guide](./PRODUCTION.md)
- [Architecture Overview](./AUTONOMOUS-TRADING-GUIDE.md)
- [API Reference](./API.md)
- [Safe Protocol Documentation](https://docs.safe.global/)
