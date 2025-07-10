# 📖 Usage Examples

This document provides practical examples of how to use the AI Agent API Signal Trader.

## 🚀 Basic Signal Processing

### Simple Buy Signal

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

### Sell Signal

```bash
curl -X POST http://localhost:3001/api/signal/process \
  -H "Content-Type: application/json" \
  -d '{
    "Signal Message": "sell",
    "Token Mentioned": "ETH",
    "TP1": 2800,
    "TP2": 2750,
    "SL": 2950,
    "Current Price": 2900,
    "Max Exit Time": {"$date": "2025-07-10T15:30:00.000Z"},
    "username": "trader123",
    "safeAddress": "0xabcdef1234567890abcdef1234567890abcdef12"
  }'
```

## 🔍 Status Monitoring

### Check System Status

```bash
curl http://localhost:3001/api/signal/status
```

### Health Check

```bash
curl http://localhost:3001/health
```

**Response with Redis enabled:**
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

**Response with Redis disabled (`REDIS_ENABLED=false`):**
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
    "redis": "disabled"
  }
}
```

## 🌐 WebSocket Integration

### JavaScript Example

```javascript
const io = require('socket.io-client');

// Connect to the server
const socket = io('http://localhost:3001');

// Listen for signal processing events
socket.on('signal-processed', (data) => {
  console.log('Signal processed:', data);
});

// Listen for trade execution events
socket.on('trade-executed', (data) => {
  console.log('Trade executed:', data);
});

// Listen for AI analysis events
socket.on('ai-analysis', (data) => {
  console.log('AI analysis:', data);
});
```

### Python WebSocket Example

```python
import socketio

# Create a Socket.IO client
sio = socketio.Client()

@sio.on('signal-processed')
def on_signal_processed(data):
    print('Signal processed:', data)

@sio.on('trade-executed')
def on_trade_executed(data):
    print('Trade executed:', data)

# Connect to the server
sio.connect('http://localhost:3001')
```

## 📊 Advanced Usage

### Batch Processing Script

```javascript
const axios = require('axios');

const signals = [
  {
    "Signal Message": "buy",
    "Token Mentioned": "VIRTUAL",
    "TP1": 1.475,
    "TP2": 1.5,
    "SL": 1.46,
    "Current Price": 1.47,
    "Max Exit Time": {"$date": "2025-07-10T11:20:29.000Z"},
    "username": "user1",
    "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
  },
  {
    "Signal Message": "sell",
    "Token Mentioned": "ETH",
    "TP1": 2800,
    "TP2": 2750,
    "SL": 2950,
    "Current Price": 2900,
    "Max Exit Time": {"$date": "2025-07-10T15:30:00.000Z"},
    "username": "user2",
    "safeAddress": "0xabcdef1234567890abcdef1234567890abcdef12"
  }
];

async function processBatchSignals() {
  const results = [];
  
  for (const signal of signals) {
    try {
      const response = await axios.post('http://localhost:3001/api/signal/process', signal);
      results.push(response.data);
      console.log(`✅ Signal processed: ${response.data.signalId}`);
    } catch (error) {
      console.error(`❌ Error processing signal:`, error.response?.data || error.message);
    }
  }
  
  return results;
}

processBatchSignals().then(results => {
  console.log('Batch processing complete:', results.length, 'signals processed');
});
```

## 🔧 Error Handling

### Robust Signal Processing

```javascript
const axios = require('axios');

async function processSignalWithRetry(signalData, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await axios.post('http://localhost:3001/api/signal/process', signalData);
      return response.data;
    } catch (error) {
      console.error(`Attempt ${attempt} failed:`, error.response?.data || error.message);
      
      if (attempt === maxRetries) {
        throw new Error(`Signal processing failed after ${maxRetries} attempts`);
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
}
```

## 🎯 Integration Examples

### Express.js Integration

```javascript
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.post('/trading-webhook', async (req, res) => {
  try {
    const signalData = req.body;
    
    // Process the signal
    const result = await axios.post('http://localhost:3001/api/signal/process', signalData);
    
    res.json({
      success: true,
      message: 'Signal processed successfully',
      signalId: result.data.signalId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Signal processing failed',
      error: error.response?.data || error.message
    });
  }
});

app.listen(3000, () => {
  console.log('Trading webhook server running on port 3000');
});
```

### Discord Bot Integration

```javascript
const { Client, GatewayIntentBits } = require('discord.js');
const axios = require('axios');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  
  // Parse trading signal from message
  if (message.content.startsWith('!signal')) {
    try {
      const signalData = parseSignalFromMessage(message.content);
      
      const response = await axios.post('http://localhost:3001/api/signal/process', signalData);
      
      message.reply(`✅ Signal processed successfully! ID: ${response.data.signalId}`);
    } catch (error) {
      message.reply(`❌ Error processing signal: ${error.message}`);
    }
  }
});

function parseSignalFromMessage(content) {
  // Parse signal format: !signal BUY VIRTUAL 1.47 1.475 1.5 1.46 username safeAddress
  const parts = content.split(' ');
  
  return {
    "Signal Message": parts[2].toLowerCase(),
    "Token Mentioned": parts[3],
    "Current Price": parseFloat(parts[4]),
    "TP1": parseFloat(parts[5]),
    "TP2": parseFloat(parts[6]),
    "SL": parseFloat(parts[7]),
    "Max Exit Time": {"$date": new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()},
    "username": parts[8],
    "safeAddress": parts[9]
  };
}

client.login('YOUR_BOT_TOKEN');
```

## 📈 Monitoring Dashboard

### Real-time Dashboard

```html
<!DOCTYPE html>
<html>
<head>
    <title>Trading Signal Dashboard</title>
    <script src="https://cdn.socket.io/4.0.0/socket.io.min.js"></script>
</head>
<body>
    <h1>Trading Signal Dashboard</h1>
    <div id="status"></div>
    <div id="signals"></div>
    
    <script>
        const socket = io('http://localhost:3001');
        
        socket.on('signal-processed', (data) => {
            const signalsDiv = document.getElementById('signals');
            const signalElement = document.createElement('div');
            signalElement.innerHTML = `
                <h3>Signal ${data.signalId}</h3>
                <p>Status: ${data.result.status}</p>
                <p>User: ${data.result.tradingPair.userId}</p>
                <p>Network: ${data.result.tradingPair.networkKey}</p>
                <p>Time: ${data.timestamp}</p>
                <hr>
            `;
            signalsDiv.appendChild(signalElement);
        });
        
        // Update status every 5 seconds
        setInterval(async () => {
            try {
                const response = await fetch('http://localhost:3001/api/signal/status');
                const data = await response.json();
                document.getElementById('status').innerHTML = `
                    <h2>System Status</h2>
                    <p>Active: ${data.status.isActive}</p>
                    <p>Processing Queue: ${data.status.processingQueue}</p>
                    <p>Active Trades: ${data.status.activeTrades}</p>
                    <p>Monitored Trades: ${data.status.monitoredTrades}</p>
                `;
            } catch (error) {
                console.error('Error fetching status:', error);
            }
        }, 5000);
    </script>
</body>
</html>
```

## 🧪 Testing Scenarios

### Test Signal Processing

```bash
# Test valid signal
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
    "username": "testuser",
    "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
  }'

# Test invalid signal (missing required fields)
curl -X POST http://localhost:3001/api/signal/process \
  -H "Content-Type: application/json" \
  -d '{
    "Signal Message": "buy",
    "Token Mentioned": "VIRTUAL"
  }'
```

### Load Testing

```javascript
const axios = require('axios');

async function loadTest(concurrency = 10, totalRequests = 100) {
  const signalTemplate = {
    "Signal Message": "buy",
    "Token Mentioned": "VIRTUAL",
    "TP1": 1.475,
    "TP2": 1.5,
    "SL": 1.46,
    "Current Price": 1.47,
    "Max Exit Time": {"$date": "2025-07-10T11:20:29.000Z"},
    "username": "testuser",
    "safeAddress": "0x1234567890abcdef1234567890abcdef12345678"
  };
  
  const requests = [];
  const results = [];
  
  for (let i = 0; i < totalRequests; i++) {
    const signal = { ...signalTemplate, username: `testuser${i}` };
    
    if (requests.length >= concurrency) {
      const batch = await Promise.allSettled(requests);
      results.push(...batch);
      requests.length = 0;
    }
    
    requests.push(axios.post('http://localhost:3001/api/signal/process', signal));
  }
  
  // Process remaining requests
  if (requests.length > 0) {
    const batch = await Promise.allSettled(requests);
    results.push(...batch);
  }
  
  const successful = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  
  console.log(`Load test results: ${successful} successful, ${failed} failed`);
}

loadTest(5, 50);
```

## 🔧 Configuration Examples

### Custom Trading Configuration

```javascript
// Update API signal processor configuration
const customConfig = {
  positionSizeUsd: 200,
  maxDailyTrades: 50,
  enableTrailingStop: true,
  trailingStopRetracement: 3,
  defaultSlippage: 0.5,
  gasBuffer: 30
};

// This would be set in environment variables or server configuration
```

### Environment-specific Configuration

```bash
# Development
NODE_ENV=development
DEBUG=true
DEFAULT_POSITION_SIZE_USD=50
REDIS_ENABLED=true

# Production
NODE_ENV=production
DEBUG=false
DEFAULT_POSITION_SIZE_USD=200
MAX_DAILY_TRADES=100
REDIS_ENABLED=true

# Minimal setup (without Redis)
NODE_ENV=development
REDIS_ENABLED=false
DEFAULT_POSITION_SIZE_USD=100
```

---

These examples demonstrate the flexibility and power of the API-based signal processing system. Start with the basic examples and gradually implement more advanced features as needed. 