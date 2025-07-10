import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import morgan from "morgan";
import dotenv from "dotenv";
import { createServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { MongoClient, Db } from "mongodb";
import { createClient } from "redis";

// Import our AI Trading Agent
import AITradingAgent from "./agent";
// Import API Signal Processor
import ApiSignalProcessor from "./services/ApiSignalProcessor";
import DatabaseService from "./services/DatabaseService";
import TradeStateManager from "./services/TradeStateManager";
import TradeExecutionService from "./services/TradeExecutionService";
import PriceMonitoringService from "./services/PriceMonitoringService";
import { ApiSignal } from "./services/ApiSignalProcessor";

// Load environment variables
dotenv.config();

// Types
interface ServerConfig {
  port: number;
  nodeEnv: string;
  corsOrigin: string;
  rateLimit: number;
}

interface DatabaseConfig {
  mongoUri: string;
  redisUrl: string;
  redisEnabled: boolean;
}

class AITradingServer {
  private app: express.Application;
  private server: any;
  private io: SocketIOServer;
  private redis: any;
  private mongoClient!: MongoClient;
  private mongoDB!: Db;
  private tradingAgent!: AITradingAgent;
  private apiSignalProcessor!: ApiSignalProcessor;
  private dbService!: DatabaseService;
  private config: ServerConfig;
  private dbConfig: DatabaseConfig;
  private isShuttingDown: boolean = false;

  constructor() {
    this.app = express();
    this.server = createServer(this.app);
    this.io = new SocketIOServer(this.server, {
      cors: {
        origin: process.env["CORS_ORIGIN"] || "http://localhost:3000",
        methods: ["GET", "POST"],
      },
    });

    this.config = {
      port: parseInt(process.env["PORT"] || "3001"),
      nodeEnv: process.env["NODE_ENV"] || "development",
      corsOrigin: process.env["CORS_ORIGIN"] || "http://localhost:3000",
      rateLimit: parseInt(process.env["API_RATE_LIMIT"] || "100"),
    };

    this.dbConfig = {
      mongoUri:
        process.env["MONGODB_URI"] ||
        "mongodb://localhost:27017/ai-trading-agent",
      redisUrl: process.env["REDIS_URL"] || "redis://localhost:6379",
      redisEnabled: process.env["REDIS_ENABLED"] !== "false",
    };

    this.initializeMiddleware();
    this.initializeRoutes();
    this.initializeDatabases();
    this.initializeSocketIO();
    this.initializeTradingAgent();
    this.initializeApiSignalProcessor();
    this.setupGracefulShutdown();
  }

  private initializeMiddleware(): void {
    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: false, // Disable for Socket.IO
      })
    );

    // CORS configuration
    this.app.use(
      cors({
        origin: this.config.corsOrigin,
        credentials: true,
      })
    );

    // Rate limiting
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: this.config.rateLimit, // Limit each IP to requests per windowMs
      message: "Too many requests from this IP, please try again later.",
      standardHeaders: true,
      legacyHeaders: false,
    });
    this.app.use("/api/", limiter);

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Compression
    this.app.use(compression());

    // Logging
    if (this.config.nodeEnv !== "test") {
      this.app.use(morgan("combined"));
    }
  }

  private initializeRoutes(): void {
    // Health check endpoint
    this.app.get("/health", (req, res) => {
      res.json({
        status: "healthy",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        agent: {
          initialized: !!this.tradingAgent,
          status: "ready",
        },
        database: {
          mongo: this.mongoClient ? "connected" : "disconnected",
          redis: this.dbConfig.redisEnabled
            ? this.redis?.isReady
              ? "connected"
              : "disconnected"
            : "disabled",
        },
      });
    });

    // Agent control endpoints
    this.app.post("/api/agent/analyze", async (req, res) => {
      try {
        const { userId, prompt } = req.body;

        if (!prompt) {
          return res.status(400).json({ error: "Prompt is required" });
        }

        const analysis = await this.tradingAgent.executeDecision(prompt);

        // Emit to connected clients
        this.io.emit("agent-analysis", {
          userId,
          analysis,
          timestamp: new Date(),
        });

        res.json({
          success: true,
          analysis,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Agent analysis error:", error);
        res.status(500).json({
          error: "Failed to execute agent analysis",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.post("/api/agent/trade", async (req, res) => {
      try {
        const { instruction } = req.body;

        if (!instruction) {
          return res
            .status(400)
            .json({ error: "Trading instruction is required" });
        }

        const result = await this.tradingAgent.manualTrade(instruction);

        // Emit to connected clients
        this.io.emit("trade-executed", { result, timestamp: new Date() });

        res.json({
          success: true,
          result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Manual trade error:", error);
        res.status(500).json({
          error: "Failed to execute trade",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.post("/api/agent/portfolio/:userId", async (req, res) => {
      try {
        const { userId } = req.params;

        const portfolio = await this.tradingAgent.analyzePortfolio(userId);

        res.json({
          success: true,
          portfolio,
          userId,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Portfolio analysis error:", error);
        res.status(500).json({
          error: "Failed to analyze portfolio",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Agentic Trading Endpoints - AI makes intelligent decisions
    this.app.post("/api/agentic/start", async (req, res) => {
      try {
        const { enabled = true, debug = false } = req.body;

        const result = await this.tradingAgent.executeDecision(
          `Start agentic trading system with enabled=${enabled} and debug=${debug}. This will activate AI-powered signal analysis and intelligent trading decisions.`
        );

        // Emit to connected clients
        this.io.emit("agentic-status", {
          status: "started",
          result,
          timestamp: new Date(),
        });

        res.json({
          success: true,
          result,
          config: { enabled, debug },
          message:
            "Agentic trading system started - AI is now making intelligent trading decisions",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Agentic trading start error:", error);
        res.status(500).json({
          error: "Failed to start agentic trading",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.post("/api/agentic/stop", async (req, res) => {
      try {
        const result = await this.tradingAgent.executeDecision(
          "Stop agentic trading system. This will pause AI decision-making and signal analysis."
        );

        // Emit to connected clients
        this.io.emit("agentic-status", {
          status: "stopped",
          result,
          timestamp: new Date(),
        });

        res.json({
          success: true,
          result,
          message: "Agentic trading system stopped",
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Agentic trading stop error:", error);
        res.status(500).json({
          error: "Failed to stop agentic trading",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.get("/api/agentic/status", async (req, res) => {
      try {
        const result = await this.tradingAgent.executeDecision(
          "Get agentic trading system status including pending signals, active trades, and AI decision-making status"
        );

        res.json({
          success: true,
          status: result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Agentic status error:", error);
        res.status(500).json({
          error: "Failed to get agentic trading status",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.get("/api/agentic/pending-signals", async (req, res) => {
      try {
        const result = await this.tradingAgent.executeDecision(
          "Get all pending signals waiting for AI analysis and decision-making. Use the getPendingSignals tool."
        );

        res.json({
          success: true,
          pendingSignals: result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Pending signals error:", error);
        res.status(500).json({
          error: "Failed to get pending signals",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.post("/api/agentic/trade/:tradeId/exit", async (req, res) => {
      try {
        const { tradeId } = req.params;
        const { exitPercentage = 100, reason = "Manual API call" } = req.body;

        const result = await this.tradingAgent.executeDecision(
          `Execute trade exit for trade ${tradeId} with ${exitPercentage}% exit and reason: ${reason}. Use AI analysis to determine optimal execution.`
        );

        // Emit to connected clients
        this.io.emit("trade-exited", {
          tradeId,
          exitPercentage,
          reason,
          result,
          timestamp: new Date(),
        });

        res.json({
          success: true,
          result,
          tradeId,
          exitPercentage,
          reason,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("AI trade exit error:", error);
        res.status(500).json({
          error: "Failed to execute AI-powered trade exit",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    this.app.get(
      "/api/agentic/trading-context/:tokenSymbol",
      async (req, res) => {
        try {
          const { tokenSymbol } = req.params;

          const result = await this.tradingAgent.executeDecision(
            `Get comprehensive trading context for ${tokenSymbol} including current price, market conditions, and position analysis. Use the getTradingContext tool.`
          );

          res.json({
            success: true,
            context: result,
            tokenSymbol,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error("Trading context error:", error);
          res.status(500).json({
            error: "Failed to get trading context",
            message: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }
    );

    // NEW: API Signal Processing Endpoint
    this.app.post("/api/signal/process", async (req, res) => {
      try {
        const signalData: ApiSignal = req.body;

        // Validate required fields
        if (!signalData) {
          return res.status(400).json({
            error: "Signal data is required",
            expectedFormat: {
              "Signal Message": "buy or sell",
              "Token Mentioned": "TOKEN_SYMBOL",
              TP1: "number",
              TP2: "number",
              SL: "number",
              "Current Price": "number",
              "Max Exit Time": { $date: "ISO_DATE_STRING" },
              username: "user_id",
              safeAddress: "0x...",
            },
          });
        }

        // Process the signal
        const result =
          await this.apiSignalProcessor.processApiSignal(signalData);

        // Emit to connected clients
        this.io.emit("signal-processed", {
          signalId: result.signalId,
          result,
          timestamp: new Date(),
        });

        res.json({
          success: true,
          signalId: result.signalId,
          status: result.status,
          result,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Signal processing error:", error);
        res.status(500).json({
          error: "Failed to process signal",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // Get signal processor status
    this.app.get("/api/signal/status", (req, res) => {
      try {
        const status = this.apiSignalProcessor.getStatus();
        res.json({
          success: true,
          status,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        console.error("Error getting signal processor status:", error);
        res.status(500).json({
          error: "Failed to get status",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
    });

    // 404 handler
    this.app.use("*", (req, res) => {
      res.status(404).json({
        error: "Endpoint not found",
        path: req.originalUrl,
      });
    });

    // Global error handler
    this.app.use(
      (
        error: any,
        req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        console.error("Global error handler:", error);

        if (res.headersSent) {
          return next(error);
        }

        res.status(500).json({
          error: "Internal server error",
          message:
            this.config.nodeEnv === "development"
              ? error.message
              : "Something went wrong",
        });
      }
    );
  }

  private async initializeDatabases(): Promise<void> {
    try {
      // MongoDB connection
      this.mongoClient = new MongoClient(this.dbConfig.mongoUri);
      await this.mongoClient.connect();

      // Extract database name from URI or use default
      const dbName =
        new URL(this.dbConfig.mongoUri).pathname.split("/")[1] ||
        "ai-trading-agent";
      this.mongoDB = this.mongoClient.db(dbName);

      console.log("✅ MongoDB connected successfully");

      // Redis connection (conditional)
      if (this.dbConfig.redisEnabled) {
        this.redis = createClient({ url: this.dbConfig.redisUrl });

        this.redis.on("error", (err: Error) => {
          console.error("❌ Redis connection error:", err);
        });

        this.redis.on("connect", () => {
          console.log("✅ Redis connected successfully");
        });

        await this.redis.connect();
      } else {
        console.log("ℹ️ Redis is disabled - skipping Redis initialization");
        this.redis = null;
      }
    } catch (error) {
      console.error("❌ Database initialization error:", error);
      process.exit(1);
    }
  }

  private initializeSocketIO(): void {
    this.io.on("connection", (socket) => {
      console.log(`🔌 Client connected: ${socket.id}`);

      socket.on("join-user-room", (userId: string) => {
        socket.join(`user-${userId}`);
        console.log(`👤 User ${userId} joined their room`);
      });

      socket.on("request-market-analysis", async () => {
        try {
          const analysis = await this.tradingAgent.executeDecision(
            "Provide a quick market overview with current trends and trading opportunities"
          );
          socket.emit("market-analysis", { analysis, timestamp: new Date() });
        } catch (error) {
          socket.emit("error", { message: "Failed to get market analysis" });
        }
      });

      socket.on("disconnect", () => {
        console.log(`❌ Client disconnected: ${socket.id}`);
      });
    });
  }

  private initializeTradingAgent(): void {
    try {
      this.tradingAgent = new AITradingAgent();
      console.log("🤖 AI Trading Agent initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize AI Trading Agent:", error);
      process.exit(1);
    }
  }

  private initializeApiSignalProcessor(): void {
    try {
      // Initialize database service
      this.dbService = new DatabaseService({
        signalFlowUri: this.dbConfig.mongoUri,
        signalFlowDb: "ai-trading-agent",
        signalFlowCollection: "trading-signals",
        safeDeploymentUri:
          process.env["SAFE_DEPLOYMENT_URI"] || this.dbConfig.mongoUri,
        safeDeploymentDb:
          process.env["SAFE_DEPLOYMENT_DB"] || "safe-deployment-serive",
        safeCollection: process.env["SAFE_COLLECTION"] || "safes",
      });

      // Initialize core services
      const tradeStateManager = new TradeStateManager();
      const tradeExecutionService = new TradeExecutionService();
      const priceMonitoringService = new PriceMonitoringService();

      // Initialize API signal processor
      this.apiSignalProcessor = new ApiSignalProcessor(
        this.dbService,
        tradeStateManager,
        tradeExecutionService,
        priceMonitoringService,
        {
          positionSizeUsd: parseInt(
            process.env["DEFAULT_POSITION_SIZE_USD"] || "100"
          ),
          maxDailyTrades: parseInt(process.env["MAX_DAILY_TRADES"] || "20"),
          enableTrailingStop: process.env["ENABLE_TRAILING_STOP"] === "true",
          trailingStopRetracement: parseFloat(
            process.env["TRAILING_STOP_RETRACEMENT"] || "2"
          ),
          defaultSlippage: parseFloat(process.env["DEFAULT_SLIPPAGE"] || "1"),
          gasBuffer: parseInt(process.env["GAS_BUFFER"] || "20"),
        }
      );

      console.log("✅ API Signal Processor initialized successfully");
    } catch (error) {
      console.error("❌ Failed to initialize API Signal Processor:", error);
      process.exit(1);
    }
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

      if (this.isShuttingDown) {
        console.log("⚠️ Shutdown already in progress...");
        return;
      }

      this.isShuttingDown = true;

      // Stop agentic trading
      if (this.tradingAgent) {
        try {
          await this.tradingAgent.executeDecision(
            "Stop agentic trading system for graceful shutdown"
          );
        } catch (error) {
          console.error("⚠️ Error stopping agentic trading:", error);
        }
      }

      // Stop API signal processor
      if (this.apiSignalProcessor) {
        try {
          await this.apiSignalProcessor.stop();
        } catch (error) {
          console.error("⚠️ Error stopping API signal processor:", error);
        }
      }

      // Close server
      this.server.close(() => {
        console.log("✅ HTTP server closed");

        // Close database connections
        const closePromises = [this.mongoClient.close()];
        if (this.dbConfig.redisEnabled && this.redis) {
          closePromises.push(this.redis.disconnect());
        }

        Promise.all(closePromises)
          .then(() => {
            console.log("✅ Database connections closed");
            console.log("🏁 Graceful shutdown complete");
            process.exit(0);
          })
          .catch((error) => {
            console.error("❌ Error during shutdown:", error);
            process.exit(1);
          });
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error("⚠️ Forced shutdown after timeout");
        process.exit(1);
      }, 30000);
    };

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
    process.on("SIGINT", () => gracefulShutdown("SIGINT"));
    process.on("SIGUSR2", () => gracefulShutdown("SIGUSR2")); // nodemon restart

    process.on("uncaughtException", (error) => {
      console.error("❌ Uncaught Exception:", error);
      gracefulShutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason, promise) => {
      console.error("❌ Unhandled Rejection at:", promise, "reason:", reason);
      gracefulShutdown("unhandledRejection");
    });
  }

  public start(): void {
    this.server.listen(this.config.port, async () => {
      console.log(`
🚀 AI Trading Agent Server Started
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌐 Server: http://localhost:${this.config.port}
🔌 Socket.IO: Connected
🤖 AI Agent: Ready
🎯 Environment: ${this.config.nodeEnv}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
      `);

      // Start API signal processor
      try {
        await this.dbService.connect();
        await this.apiSignalProcessor.start();
        console.log("✅ API Signal Processor started successfully");
      } catch (error) {
        console.error("❌ Failed to start API Signal Processor:", error);
      }
    });
  }
}

// Start the server
const server = new AITradingServer();
server.start();

export default AITradingServer;
