import { ChatOpenAI } from "@langchain/openai";
import { MemorySaver } from "@langchain/langgraph";
import { HumanMessage } from "@langchain/core/messages";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import dotenv from "dotenv";

// Import our trading and Safe tools
import {
  getEthBalance,
  getEthBalanceMetadata,
  deploySafeForTrading,
  deploySafeForTradingMetadata,
  executeTokenSwap,
  executeTokenSwapMetadata,
  getSafeInfo,
  getSafeInfoMetadata,
} from "./tools/safe";

import {
  getTokenPrice,
  getTokenPriceMetadata,
  getMarketData,
  getMarketDataMetadata,
  analyzeMarketTrends,
  analyzeMarketTrendsMetadata,
} from "./tools/market";

import {
  calculateTradeSize,
  calculateTradeSizeMetadata,
  assessRisk,
  assessRiskMetadata,
  optimizeGas,
  optimizeGasMetadata,
} from "./tools/trading";

import {
  monitorPositions,
  monitorPositionsMetadata,
  checkProfitLoss,
  checkProfitLossMetadata,
  rebalancePortfolio,
  rebalancePortfolioMetadata,
} from "./tools/portfolio";

// Import agentic trading system
import AgenticTradingOrchestrator from "./services/AgenticTradingOrchestrator";
import {
  executeSignalTrades,
  rejectSignal,
  executeTradeExit,
  modifyTradeStrategy,
  getPendingSignals,
  getTradingContext,
  setAgenticOrchestrator,
  executeSignalTradesMetadata,
  rejectSignalMetadata,
  executeTradeExitMetadata,
  modifyTradeStrategyMetadata,
  getPendingSignalsMetadata,
  getTradingContextMetadata,
} from "./tools/agentic-trading";

// Load environment variables
dotenv.config();

/**
 * Enhanced AI Trading Agent with Autonomous Trading Capabilities
 *
 * This agent can:
 * - Analyze market conditions
 * - Deploy Safe wallets for users
 * - Execute token swaps
 * - Manage trading positions
 * - Assess and manage risk
 * - Optimize gas costs
 * - AUTONOMOUS TRADING: Watch MongoDB for signals and execute trades automatically
 */
class AITradingAgent {
  private agent: any;
  private checkpointer: MemorySaver;
  private isRunning: boolean = false;
  private sessionId: string;
  private agenticOrchestrator: AgenticTradingOrchestrator | null = null;

  constructor() {
    this.checkpointer = new MemorySaver();
    this.sessionId = Math.random().toString(36).substring(7);
    this.initializeAgent();
    this.initializeAgenticTrading();
  }

  private initializeAgent() {
    // Add new agentic trading tools - these allow AI to make intelligent decisions
    const agenticTools = [
      tool(executeSignalTrades, executeSignalTradesMetadata),
      tool(rejectSignal, rejectSignalMetadata),
      tool(executeTradeExit, executeTradeExitMetadata),
      tool(modifyTradeStrategy, modifyTradeStrategyMetadata),
      tool(getPendingSignals, getPendingSignalsMetadata),
      tool(getTradingContext, getTradingContextMetadata),

      // Control tools for the agentic system
      tool(this.startAgenticTrading.bind(this), {
        name: "startAgenticTrading",
        description:
          "Start the agentic trading system where AI analyzes signals and makes intelligent trading decisions",
        schema: {
          type: "object",
          properties: {
            enabled: {
              type: "boolean",
              description: "Whether to enable agentic trading",
              default: true,
            },
            debug: {
              type: "boolean",
              description: "Enable debug mode for detailed logging",
              default: false,
            },
          },
          required: [],
        },
      }),

      tool(this.stopAgenticTrading.bind(this), {
        name: "stopAgenticTrading",
        description: "Stop the agentic trading system",
        schema: {
          type: "object",
          properties: {},
          required: [],
        },
      }),

      tool(this.getAgenticStatus.bind(this), {
        name: "getAgenticStatus",
        description:
          "Get the status of the agentic trading system including pending signals and AI decisions",
        schema: {
          type: "object",
          properties: {},
          required: [],
        },
      }),
    ];

    // Define all available tools for the trading agent
    const agentTools = [
      // Safe Management Tools
      tool(getEthBalance, getEthBalanceMetadata),
      tool(deploySafeForTrading, deploySafeForTradingMetadata),
      tool(executeTokenSwap, executeTokenSwapMetadata),
      tool(getSafeInfo, getSafeInfoMetadata),

      // Market Analysis Tools
      tool(getTokenPrice, getTokenPriceMetadata),
      tool(getMarketData, getMarketDataMetadata),
      tool(analyzeMarketTrends, analyzeMarketTrendsMetadata),

      // Trading Strategy Tools
      tool(calculateTradeSize, calculateTradeSizeMetadata),
      tool(assessRisk, assessRiskMetadata),
      tool(optimizeGas, optimizeGasMetadata),

      // Portfolio Management Tools
      tool(monitorPositions, monitorPositionsMetadata),
      tool(checkProfitLoss, checkProfitLossMetadata),
      tool(rebalancePortfolio, rebalancePortfolioMetadata),

      // New Agentic Trading Tools
      ...agenticTools,
    ];

    // Initialize the AI model
    const agentModel = new ChatOpenAI({
      model: "o3-mini",
      openAIApiKey: process.env["OPENAI_API_KEY"],
    });

    // Create the React agent with tools
    this.agent = createReactAgent({
      llm: agentModel,
      tools: agentTools,
      checkpointSaver: this.checkpointer,
    });

    console.log(
      "🧠 Enhanced AI Trading Agent initialized with",
      agentTools.length,
      "tools (including agentic trading with AI decision-making)"
    );
  }

  private initializeAgenticTrading(): void {
    const agenticConfig = {
      database: {
        signalFlowUri: process.env["MONGODB_URI"]!,
        signalFlowDb: "ctxbt-signal-flow",
        signalFlowCollection: "trading-signals",
        safeDeploymentUri: process.env["MONGODB_URI"]!,
        safeDeploymentDb: "safe-deployment-service",
        safeCollection: "safes",
      },
      aiAgent: this, // Reference to this AI agent for decision-making
      enabled: false, // Disabled by default
      debug: process.env["NODE_ENV"] === "development",
    };

    this.agenticOrchestrator = new AgenticTradingOrchestrator(agenticConfig);

    // Set the orchestrator reference for the agentic tools
    setAgenticOrchestrator(this.agenticOrchestrator);

    // Set up event handlers for agentic trading
    this.agenticOrchestrator.on("started", () => {
      console.log(
        "🧠 Agentic trading started - AI is now making trading decisions"
      );
    });

    this.agenticOrchestrator.on("stopped", () => {
      console.log("⏹️ Agentic trading stopped");
    });

    this.agenticOrchestrator.on("signalRejected", ({ signalId, reason }) => {
      console.log(`🚫 AI rejected signal ${signalId}: ${reason}`);
    });

    console.log(
      "🧠 Agentic trading orchestrator initialized with AI decision-making"
    );
  }

  // New agentic trading tool implementations
  private async startAgenticTrading({
    enabled = true,
    debug = false,
  }: any): Promise<string> {
    try {
      if (!this.agenticOrchestrator) {
        return "❌ Agentic trading orchestrator not initialized";
      }

      if (enabled) {
        await this.agenticOrchestrator.start();

        return `🧠 Agentic trading started successfully!
        
🤖 AI-Powered Trading System Features:
• Signal Analysis: AI evaluates each trading signal before execution
• Risk Assessment: Intelligent position sizing based on market conditions
• Dynamic Exit Strategies: AI modifies TP/SL based on market momentum
• Portfolio Management: Continuous AI oversight of all positions
• Real-time Decisions: AI makes intelligent choices at every step

🎯 The AI agent will now:
1. 📡 Monitor MongoDB for new trading signals
2. 🧠 Analyze each signal using market data and risk assessment
3. 🎯 Make intelligent decisions about which trades to execute
4. 💰 Determine optimal position sizes for each user
5. ⚡ Choose the best network and timing for execution
6. 📊 Continuously monitor and adjust exit strategies
7. 🛡️ Apply risk management and portfolio optimization

Your trading is now powered by intelligent AI decision-making!`;
      } else {
        return "⏸️ Agentic trading disabled";
      }
    } catch (error) {
      return `❌ Failed to start agentic trading: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  private async stopAgenticTrading(): Promise<string> {
    try {
      if (!this.agenticOrchestrator) {
        return "❌ Agentic trading orchestrator not initialized";
      }

      await this.agenticOrchestrator.stop();

      return `⏹️ Agentic trading stopped successfully!
      
🧠 AI trading system has been halted:
• Signal monitoring stopped
• AI decision-making paused
• Price monitoring stopped
• New signal analysis suspended
• Existing positions remain active and monitored

Use the individual trading tools or restart agentic trading to resume AI-powered operations.`;
    } catch (error) {
      return `❌ Failed to stop agentic trading: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  private async getAgenticStatus(): Promise<string> {
    try {
      if (!this.agenticOrchestrator) {
        return "❌ Agentic trading orchestrator not initialized";
      }

      const status = this.agenticOrchestrator.getStatus();

      let report = `🧠 Agentic Trading System Status\n\n`;

      // System status
      report += `🤖 AI Decision Engine:\n`;
      report += `• Status: ${status.isWatching ? "🟢 Active" : "🔴 Inactive"}\n`;
      report += `• Mode: ${status.mode}\n`;
      report += `• Pending Signals: ${status.pendingSignals} (awaiting AI analysis)\n`;
      report += `\n`;

      // Trading statistics
      report += `📈 Trading Statistics:\n`;
      report += `• Active Trades: ${status.activeTrades}\n`;
      report += `• Monitored Trades: ${status.monitoredTrades}\n`;
      report += `\n`;

      if (status.pendingSignals > 0) {
        report += `⏳ Pending AI Analysis:\n`;
        report += `• ${status.pendingSignals} signal(s) awaiting AI decision\n`;
        report += `• Use getPendingSignals tool for detailed analysis\n`;
        report += `\n`;
      }

      report += `🎯 System Capabilities:\n`;
      report += `• Intelligent signal analysis and filtering\n`;
      report += `• Risk-adjusted position sizing\n`;
      report += `• Dynamic exit strategy optimization\n`;
      report += `• Real-time portfolio rebalancing\n`;
      report += `• Multi-network execution optimization\n`;

      return report;
    } catch (error) {
      return `❌ Failed to get agentic status: ${error instanceof Error ? error.message : "Unknown error"}`;
    }
  }

  /**
   * Execute a trading decision or query
   */
  async executeDecision(prompt: string): Promise<string> {
    try {
      const result = await this.agent.invoke(
        {
          messages: [new HumanMessage(prompt)],
        },
        { configurable: { thread_id: this.sessionId } }
      );

      const response = result.messages[result.messages.length - 1].content;
      console.log("🎯 Agent Decision:", response);
      return response;
    } catch (error) {
      console.error("❌ Agent execution error:", error);
      throw error;
    }
  }

  /**
   * Manual trading decision - can still be used with agentic system
   */
  async manualTrade(instruction: string): Promise<string> {
    return await this.executeDecision(
      `Execute manual trading instruction: ${instruction}
       Analyze the request, assess risks, and execute if profitable and safe.
       Provide detailed reasoning for the decision.`
    );
  }

  /**
   * Portfolio analysis - can still be used with agentic system
   */
  async analyzePortfolio(userId: string): Promise<string> {
    return await this.executeDecision(
      `Provide a comprehensive portfolio analysis for user ${userId}.
       Include current positions, P&L, risk assessment, and recommendations.
       Suggest rebalancing opportunities and potential new strategies.`
    );
  }
}

// Main execution function
const main = async () => {
  console.log("🚀 Initializing AI Trading Agent...");

  const agent = new AITradingAgent();

  // Example usage - You can customize this based on your needs
  const command = process.argv[2];
  const userId = process.argv[3] || "demo-user";

  switch (command) {
    case "analyze":
      const analysis = await agent.analyzePortfolio(userId);
      console.log("\n📊 Portfolio Analysis:");
      console.log(analysis);
      break;

    case "trade":
      const instruction = process.argv.slice(4).join(" ");
      if (!instruction) {
        console.log("Please provide trading instruction");
        process.exit(1);
      }
      const result = await agent.manualTrade(instruction);
      console.log("\n💱 Trading Result:");
      console.log(result);
      break;

    case "auto":
      const strategies = process.argv.slice(4);
      await agent.startAutonomousTrading(userId, strategies);
      break;

    default:
      // Interactive mode - ask for market analysis
      const marketReport = await agent.executeDecision(
        "Provide a comprehensive market analysis for crypto trading. " +
          "Include major token prices, trends, and trading opportunities. " +
          "Assess overall market sentiment and risk levels."
      );
      console.log("\n🌐 Market Analysis:");
      console.log(marketReport);
  }
};

// Export for use as module
export default AITradingAgent;

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}
