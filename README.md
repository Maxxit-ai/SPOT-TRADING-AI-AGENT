# 🤖 AI Agent API Signal Trader

**AI Trading Agent with API-based Signal Processing for Safe Automation**

This project provides an AI-powered trading agent that processes trading signals through API calls instead of database polling. The system integrates with Safe multisig wallets for secure trade execution and uses AI decision-making for intelligent signal analysis.

## 🚀 Key Features

### 🔄 API-Based Signal Processing

- **Direct API Integration**: Receive and process trading signals via REST API
- **Real-time Processing**: Instant signal processing without database delays
- **Flexible Signal Format**: Support for customizable signal structures
- **AI-Powered Analysis**: Every signal is analyzed by AI before execution

### 🛡️ Safe Integration

- **Multisig Security**: All trades executed through Safe multisig wallets
- **User Control**: 1-of-2 multisig setup (User + AI Agent)
- **Network Support**: Multi-chain deployment across Arbitrum, Polygon, Base, and Ethereum
- **Gas Optimization**: Intelligent gas management and cost optimization

### 🧠 AI Decision Making

- **Signal Analysis**: AI evaluates every signal before execution
- **Risk Assessment**: Intelligent risk management and position sizing
- **Market Context**: Real-time market analysis and trend evaluation
- **Trade Monitoring**: AI-powered trade exit and risk management

## 📋 New Signal Format

The API now accepts signals in this format:

```json
{
  "Signal Message": "buy",
  "Token Mentioned": "VIRTUAL",
  "TP1": 1.475,
  "TP2": 1.5,
  "SL": 1.46,
  "Current Price": 1.47,
  "Max Exit Time": { "$date": "2025-07-10T11:20:29.000Z" },
  "username": "abhidavinci",
  "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    API Signal Trader Architecture               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │   API Endpoint      │
                    │  /api/signal/process │
                    └─────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │ ApiSignalProcessor  │
                    │ • Validation        │
                    │ • Processing        │
                    │ • Error Handling    │
                    └─────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │ AI Analysis Engine  │
                    │ • Signal Evaluation │
                    │ • Risk Assessment   │
                    │ • Market Context    │
                    └─────────────────────┘
                                │
                                ▼
                    ┌─────────────────────┐
                    │ Trade Execution     │
                    │ • Safe Integration  │
                    │ • Multi-chain       │
                    │ • Gas Optimization  │
                    └─────────────────────┘
```

## 🔧 Installation

### Prerequisites

- Node.js 18+
- MongoDB for user data storage
- Redis for caching and queues
- Safe wallet deployment

### Setup

1. **Clone and Install**

   ```bash
   git clone <repository-url>
   cd ai-agent-api-signal-trader
   npm install
   ```

2. **Environment Configuration**

   ```bash
   cp env.example .env
   # Edit .env with your configuration
   ```

3. **Database Setup**

   ```bash
   # Start MongoDB and Redis
   mongod
   redis-server
   ```

4. **Development Server**
   ```bash
   npm run dev
   ```

## 🔌 API Endpoints

### Signal Processing

#### `POST /api/signal/process`

Process a trading signal through the AI agent.

**Request:**

```json
{
  "Signal Message": "buy",
  "Token Mentioned": "VIRTUAL",
  "TP1": 1.475,
  "TP2": 1.5,
  "SL": 1.46,
  "Current Price": 1.47,
  "Max Exit Time": { "$date": "2025-07-10T11:20:29.000Z" },
  "username": "abhidavinci",
  "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response:**

```json
{
  "success": true,
  "signalId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "success",
  "result": {
    "signalId": "550e8400-e29b-41d4-a716-446655440000",
    "tradingPair": {
      "userId": "abhidavinci",
      "tradeId": "550e8400-e29b-41d4-a716-446655440000_abhidavinci",
      "safeAddress": "0x1234567890abcdef1234567890abcdef12345678",
      "networkKey": "arbitrum",
      "status": "success"
    },
    "status": "success"
  },
  "timestamp": "2025-01-27T10:30:00.000Z"
}
```

### Status Monitoring

#### `GET /api/signal/status`

Get the current status of the signal processor.

**Response:**

```json
{
  "success": true,
  "status": {
    "isActive": true,
    "processingQueue": 0,
    "activeTrades": 3,
    "monitoredTrades": 5,
    "lastProcessed": "2025-01-27T10:30:00.000Z"
  },
  "timestamp": "2025-01-27T10:30:00.000Z"
}
```

### Health Check

#### `GET /health`

Server health and status check.

**Response:**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-27T10:30:00.000Z",
  "uptime": 3600,
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

## 🔄 Migration from Database Polling

### Key Changes

1. **Signal Source**:
   - **Before**: MongoDB change streams monitoring `trading-signals` collection
   - **After**: Direct API calls to `/api/signal/process`

2. **Signal Format**:
   - **Before**: Database documents with `subscribers` array
   - **After**: Direct signal objects with `username` and `safeAddress`

3. **Processing Flow**:
   - **Before**: Database → Change Stream → Signal Processing
   - **After**: API → Signal Validation → AI Analysis → Trade Execution

4. **User Association**:
   - **Before**: Multiple subscribers per signal
   - **After**: One signal per user, direct association

### Migration Benefits

- **Reduced Latency**: Direct API processing eliminates database polling delays
- **Better Scalability**: API-based architecture scales better than change streams
- **Simplified Architecture**: Direct signal processing without complex database monitoring
- **Enhanced Security**: Direct user-to-safe mapping without intermediate storage

## 🔧 Configuration

### Environment Variables

```bash
# AI Configuration
OPENAI_API_KEY=sk-your-openai-api-key
AGENT_PRIVATE_KEY=0x-your-agent-private-key
AGENT_ADDRESS=0x-your-agent-address

# Database Configuration
MONGODB_URI=mongodb://localhost:27017/ai-trading-agent
REDIS_URL=redis://localhost:6379
REDIS_ENABLED=true  # Set to false to disable Redis

# Safe Configuration
SAFE_DEPLOYMENT_URI=mongodb://localhost:27017/safe-deployment-service
SAFE_DEPLOYMENT_DB=safe-deployment-service
SAFE_COLLECTION=safes

# Trading Configuration
DEFAULT_POSITION_SIZE_USD=100
MAX_DAILY_TRADES=20
DEFAULT_SLIPPAGE=1
RISK_PER_TRADE=2
STOP_LOSS_THRESHOLD=5
```

### Trading Parameters

```javascript
{
  positionSizeUsd: 100,        // Default position size in USD
  maxDailyTrades: 20,          // Maximum trades per day
  enableTrailingStop: true,    // Enable trailing stop loss
  trailingStopRetracement: 2,  // Trailing stop percentage
  defaultSlippage: 1,          // Default slippage percentage
  gasBuffer: 20                // Gas buffer percentage
}
```

### Redis Configuration

Redis is used for caching and queues but can be disabled if not needed:

- **Enabled (`REDIS_ENABLED=true`)**: Full Redis functionality with caching and queue management
- **Disabled (`REDIS_ENABLED=false`)**: Redis is skipped, system runs without caching/queues
- **Default**: Redis is enabled unless explicitly set to `false`

When Redis is disabled, the system will:

- Skip Redis connection during initialization
- Show "disabled" status in health checks
- Skip Redis disconnection during shutdown
- Continue functioning without caching capabilities

## 📊 Monitoring & Analytics

### Real-time Monitoring

The system provides real-time monitoring through:

- **WebSocket Events**: Live updates for signal processing
- **API Status Endpoints**: Current system status and metrics
- **Logging**: Comprehensive logging for debugging and analysis

### Key Metrics

- **Signal Processing Rate**: Signals processed per minute
- **Success Rate**: Percentage of successful trade executions
- **AI Approval Rate**: Percentage of signals approved by AI
- **Average Processing Time**: Time from signal receipt to execution

## 🛡️ Security Features

### Signal Validation

- **Schema Validation**: Strict validation of signal format
- **User Verification**: Validation of user and safe address mapping
- **Price Validation**: Sanity checks on price and target levels
- **Rate Limiting**: Protection against spam and abuse

### Safe Integration

- **Multisig Security**: All trades require user or AI agent approval
- **Network Validation**: Verification of safe deployment on target network
- **Gas Estimation**: Pre-execution gas cost estimation
- **Transaction Simulation**: Dry-run execution before actual trade

## 🔍 Testing

### Signal Processing Test

```bash
curl -X POST http://localhost:3001/api/signal/process \
  -H "Content-Type: application/json" \
  -d '{
    "Signal Message": "buy",
    "Token Mentioned": "VIRTUAL",
    "TP1": 1.475,
    "TP2": 1.5,
    "SL": 1.46,
    "Current Price": 1.47,
    "Max Exit Time": {"$date": "2025-07-10T11:20:29.000Z"},
    "username": "abhidavinci",
    "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
  }'
```

### Status Check

```bash
curl http://localhost:3001/api/signal/status
```

## 🚀 Production Deployment

### Docker Configuration

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
EXPOSE 3001
CMD ["npm", "start"]
```

### Environment Setup

1. **Database Connections**: Ensure MongoDB and Redis are accessible
2. **Safe Deployment**: Verify Safe wallet deployments
3. **Network Configuration**: Configure RPC endpoints for all networks
4. **AI Integration**: Ensure OpenAI API key has sufficient credits

## 📈 Performance Optimization

### API Response Times

- **Signal Processing**: < 2 seconds average
- **AI Analysis**: < 5 seconds average
- **Trade Execution**: < 10 seconds average

### Scalability

- **Concurrent Signals**: Handles 100+ concurrent signal processing
- **Database Connections**: Connection pooling for optimal performance
- **Memory Usage**: Efficient memory management with garbage collection

## 🆘 Troubleshooting

### Common Issues

1. **Signal Processing Failures**
   - Check signal format validation
   - Verify user and safe address mapping
   - Ensure AI agent is initialized

2. **Database Connection Issues**
   - Verify MongoDB and Redis connectivity
   - Check connection strings in environment variables
   - Ensure database services are running

3. **Trade Execution Failures**
   - Verify safe deployment status
   - Check network RPC endpoints
   - Ensure sufficient gas funds

### Debug Mode

Enable debug logging by setting:

```bash
NODE_ENV=development
DEBUG=true
```

## 📚 API Documentation

### WebSocket Events

The system emits real-time events via WebSocket:

```javascript
// Connect to WebSocket
const socket = io("http://localhost:3001");

// Listen for signal processing events
socket.on("signal-processed", (data) => {
  console.log("Signal processed:", data);
});

// Listen for trade execution events
socket.on("trade-executed", (data) => {
  console.log("Trade executed:", data);
});
```

### Integration Examples

#### JavaScript/Node.js

```javascript
const axios = require("axios");

async function processSignal(signalData) {
  try {
    const response = await axios.post(
      "http://localhost:3001/api/signal/process",
      signalData
    );
    return response.data;
  } catch (error) {
    console.error("Signal processing error:", error.response.data);
    throw error;
  }
}
```

#### Python

```python
import requests
import json

def process_signal(signal_data):
    try:
        response = requests.post(
            'http://localhost:3001/api/signal/process',
            json=signal_data
        )
        return response.json()
    except requests.exceptions.RequestException as e:
        print(f"Signal processing error: {e}")
        raise
```

## 🎯 Future Enhancements

### Planned Features

1. **Batch Signal Processing**: Process multiple signals in a single API call
2. **Advanced AI Models**: Integration with more sophisticated AI models
3. **Custom Signal Formats**: Support for user-defined signal formats
4. **Advanced Analytics**: Enhanced trading performance analytics
5. **Mobile App**: Mobile application for signal monitoring

### Performance Improvements

1. **Redis Caching**: Enhanced caching for frequently accessed data
2. **Database Optimization**: Query optimization and indexing
3. **Parallel Processing**: Concurrent signal processing for better throughput
4. **Load Balancing**: Multiple instance deployment for high availability

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 📞 Support

For support and questions:

- Create an issue in the GitHub repository
- Check the troubleshooting section
- Review the API documentation

---

**Ready to start API-based signal trading with AI! 🚀**
