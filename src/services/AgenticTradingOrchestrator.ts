import { EventEmitter } from "events";
import { logger } from "../config/logger";
import ApiSignalProcessor from "./ApiSignalProcessor";
import DatabaseService from "./DatabaseService";
import TradeStateManager from "./TradeStateManager";
import TradeExecutionService from "./TradeExecutionService";
import PriceMonitoringService from "./PriceMonitoringService";
import { ApiSignal, ProcessedSignal } from "./ApiSignalProcessor";

interface AgenticConfig {
  database: any;
  aiAgent: any; // Reference to the AI agent for decision-making
  enabled: boolean;
  debug: boolean;
}

/**
 * Agentic Trading Orchestrator
 *
 * This orchestrator coordinates API-based signal processing with AI decision-making.
 * It integrates with the ApiSignalProcessor to handle signals received via API calls
 * and uses AI to make intelligent trading decisions.
 */
class AgenticTradingOrchestrator extends EventEmitter {
  private logger = logger;
  private config: AgenticConfig;
  private isActive: boolean = false;

  // Core services
  private dbService: DatabaseService;
  private tradeStateManager: TradeStateManager;
  private tradeExecutionService: TradeExecutionService;
  private priceMonitoringService: PriceMonitoringService;
  private apiSignalProcessor: ApiSignalProcessor;
  private aiAgent: any; // The AI agent that makes all decisions

  // AI decision queue
  private pendingDecisions: Map<string, any> = new Map();

  constructor(config: AgenticConfig) {
    super();

    this.config = config;
    this.aiAgent = config.aiAgent;

    this.initializeServices();
    this.setupEventHandlers();
  }

  private initializeServices(): void {
    // Initialize database service
    this.dbService = new DatabaseService(this.config.database);

    // Initialize core services
    this.tradeStateManager = new TradeStateManager();
    this.tradeExecutionService = new TradeExecutionService();
    this.priceMonitoringService = new PriceMonitoringService();

    // Initialize API signal processor
    this.apiSignalProcessor = new ApiSignalProcessor(
      this.dbService,
      this.tradeStateManager,
      this.tradeExecutionService,
      this.priceMonitoringService,
      {
        positionSizeUsd: 1,
        maxDailyTrades: 20,
        enableTrailingStop: true,
        trailingStopRetracement: 2,
        defaultSlippage: 1,
        gasBuffer: 20,
      }
    );

    this.logger.info(
      "🧠 Agentic trading services initialized with API signal processing"
    );
  }

  private setupEventHandlers(): void {
    // Handle signal processing events from API Signal Processor
    this.apiSignalProcessor.on(
      "signalProcessed",
      async (result: ProcessedSignal) => {
        await this.handleSignalProcessed(result);
      }
    );

    this.apiSignalProcessor.on("signalError", async (error: any) => {
      await this.handleSignalError(error);
    });

    // Handle price monitoring events by asking AI what to do
    this.priceMonitoringService.on("tradeExit", async (exitData) => {
      await this.handlePriceAlert(exitData);
    });

    // Process AI decisions every 10 seconds
    setInterval(() => {
      this.processAIDecisionQueue();
    }, 10000);
  }

  async start(): Promise<void> {
    if (this.isActive) {
      this.logger.warn("Agentic trading orchestrator already running");
      return;
    }

    if (!this.config.enabled) {
      this.logger.warn("Agentic trading orchestrator is disabled");
      return;
    }

    try {
      this.logger.info("🚀 Starting agentic trading orchestrator...");

      // Connect to databases
      await this.dbService.connect();

      // Start core services
      await this.priceMonitoringService.start();
      await this.apiSignalProcessor.start();

      this.isActive = true;
      this.logger.info(
        "🧠 Agentic trading orchestrator started - AI is ready for API signals"
      );
      this.emit("started");
    } catch (error) {
      this.logger.error("Failed to start agentic trading orchestrator:", error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isActive) return;

    try {
      // Stop all services
      await this.apiSignalProcessor.stop();
      this.priceMonitoringService.stop();
      await this.dbService.disconnect();

      this.isActive = false;
      this.logger.info("⏹️ Agentic trading orchestrator stopped");
      this.emit("stopped");
    } catch (error) {
      this.logger.error("Error stopping agentic trading orchestrator:", error);
    }
  }

  /**
   * Process a signal through the AI orchestrator
   * This method allows external systems to send signals for AI processing
   */
  async processSignalWithAI(signalData: ApiSignal): Promise<ProcessedSignal> {
    try {
      this.logger.info(
        `🧠 Processing signal through AI orchestrator: ${signalData["Token Mentioned"]} by ${signalData.username}`
      );

      // Ask AI to analyze the signal first
      const aiAnalysis = await this.requestAISignalAnalysis(signalData);

      // If AI approves, process the signal
      if (aiAnalysis.approved) {
        const result =
          await this.apiSignalProcessor.processApiSignal(signalData);

        // Ask AI for post-processing analysis
        await this.requestAIPostProcessingAnalysis(result, signalData);

        return result;
      } else {
        // AI rejected the signal
        this.logger.info(`❌ AI rejected signal: ${aiAnalysis.reason}`);
        return {
          signalId: "rejected",
          tradingPair: {
            userId: signalData.username,
            tradeId: "rejected",
            safeAddress: signalData.safeAddress,
            networkKey: "arbitrum",
            status: "failed",
            error: `AI rejected signal: ${aiAnalysis.reason}`,
          },
          status: "failed",
          error: `AI rejected signal: ${aiAnalysis.reason}`,
        };
      }
    } catch (error) {
      this.logger.error("Error processing signal with AI:", error);
      throw error;
    }
  }

  /**
   * Handle signal processing completion
   */
  private async handleSignalProcessed(result: ProcessedSignal): Promise<void> {
    try {
      this.logger.info(`📊 Signal processed successfully: ${result.signalId}`);

      // Ask AI to analyze the trade result
      await this.requestAITradeAnalysis(result);

      this.emit("signalProcessedWithAI", result);
    } catch (error) {
      this.logger.error("Error handling signal processed:", error);
    }
  }

  /**
   * Handle signal processing errors
   */
  private async handleSignalError(error: any): Promise<void> {
    try {
      this.logger.error(`❌ Signal processing error: ${error.error}`);

      // Ask AI to analyze the error and suggest improvements
      await this.requestAIErrorAnalysis(error);

      this.emit("signalErrorWithAI", error);
    } catch (analysisError) {
      this.logger.error("Error analyzing signal error:", analysisError);
    }
  }

  /**
   * Request AI to analyze a trading signal and make decisions
   */
  private async requestAISignalAnalysis(signalData: ApiSignal): Promise<any> {
    try {
      const analysisPrompt = `
🔍 NEW TRADING SIGNAL ANALYSIS REQUEST

Signal Details:
• Token: ${signalData["Token Mentioned"]}
• Signal: ${signalData["Signal Message"]}
• Current Price: $${signalData["Current Price"]}
• TP1: $${signalData.TP1}
• TP2: $${signalData.TP2}
• SL: $${signalData.SL}
• Max Exit Time: ${signalData["Max Exit Time"]["$date"]}
• User: ${signalData.username}
• Safe Address: ${signalData.safeAddress}

Please analyze this signal and determine:
1. Should this signal be approved for trading?
2. What is the risk assessment?
3. Are the TP/SL levels reasonable?
4. Is the timing appropriate?
5. Any concerns or recommendations?

Provide your analysis and decision (approved: true/false, reason: string).
`;

      const analysis = await this.aiAgent.executeDecision(analysisPrompt);

      // Parse AI response (simplified - in real implementation, would use more sophisticated parsing)
      const approved =
        analysis.toLowerCase().includes("approved: true") ||
        analysis.toLowerCase().includes("approve") ||
        analysis.toLowerCase().includes("execute");

      const reason = approved
        ? "AI approved the signal"
        : "AI analysis suggests caution";

      return { approved, reason, analysis };
    } catch (error) {
      this.logger.error("Error in AI signal analysis:", error);
      return { approved: false, reason: "AI analysis failed", analysis: null };
    }
  }

  /**
   * Request AI post-processing analysis
   */
  private async requestAIPostProcessingAnalysis(
    result: ProcessedSignal,
    signalData: ApiSignal
  ): Promise<void> {
    try {
      const postProcessingPrompt = `
📈 POST-PROCESSING ANALYSIS

Signal: ${signalData["Token Mentioned"]} ${signalData["Signal Message"]}
Result: ${result.status}
Trade ID: ${result.signalId}
User: ${signalData.username}

The signal has been processed. Please analyze:
1. Was the execution successful?
2. Are there any follow-up actions needed?
3. Should we monitor this trade closely?
4. Any risk management adjustments?

Provide your post-processing analysis and recommendations.
`;

      const analysis = await this.aiAgent.executeDecision(postProcessingPrompt);

      // Add to pending decisions for potential follow-up actions
      this.pendingDecisions.set(result.signalId, {
        type: "post-processing",
        analysis,
        result,
        signalData,
        timestamp: new Date(),
      });

      this.logger.info(
        `📊 AI post-processing analysis completed for ${result.signalId}`
      );
    } catch (error) {
      this.logger.error("Error in AI post-processing analysis:", error);
    }
  }

  /**
   * Request AI trade analysis
   */
  private async requestAITradeAnalysis(result: ProcessedSignal): Promise<void> {
    try {
      const tradeAnalysisPrompt = `
💹 TRADE ANALYSIS REQUEST

Trade ID: ${result.signalId}
Status: ${result.status}
User: ${result.tradingPair.userId}
Network: ${result.tradingPair.networkKey}
Safe Address: ${result.tradingPair.safeAddress}

Please analyze this trade execution:
1. Was the trade executed optimally?
2. Are there any immediate concerns?
3. Should we adjust monitoring parameters?
4. Portfolio impact assessment?

Provide your trade analysis and monitoring recommendations.
`;

      const analysis = await this.aiAgent.executeDecision(tradeAnalysisPrompt);

      // Store analysis for future reference
      this.pendingDecisions.set(`${result.signalId}_analysis`, {
        type: "trade-analysis",
        analysis,
        result,
        timestamp: new Date(),
      });

      this.logger.info(`📊 AI trade analysis completed for ${result.signalId}`);
    } catch (error) {
      this.logger.error("Error in AI trade analysis:", error);
    }
  }

  /**
   * Request AI error analysis
   */
  private async requestAIErrorAnalysis(error: any): Promise<void> {
    try {
      const errorAnalysisPrompt = `
🚨 ERROR ANALYSIS REQUEST

Error: ${error.error}
Signal ID: ${error.signalId}
User: ${error.tradingPair?.userId}
Status: ${error.status}

This trade execution failed. Please analyze:
1. What caused the failure?
2. How can we prevent similar errors?
3. Should we adjust our parameters?
4. Are there system improvements needed?

Provide your error analysis and improvement recommendations.
`;

      const analysis = await this.aiAgent.executeDecision(errorAnalysisPrompt);

      // Store analysis for system improvements
      this.pendingDecisions.set(`${error.signalId}_error_analysis`, {
        type: "error-analysis",
        analysis,
        error,
        timestamp: new Date(),
      });

      this.logger.info(`📊 AI error analysis completed for ${error.signalId}`);
    } catch (analysisError) {
      this.logger.error("Error in AI error analysis:", analysisError);
    }
  }

  /**
   * Handle price alerts with AI decision-making
   */
  private async handlePriceAlert(exitData: any): Promise<void> {
    try {
      const alertPrompt = `
🚨 PRICE ALERT ANALYSIS

Trade ID: ${exitData.tradeId}
Current Price: ${exitData.currentPrice}
Alert Type: ${exitData.alertType}
Reason: ${exitData.reason}

A price alert has been triggered. Please analyze:
1. Should we exit this trade?
2. Exit percentage recommendation?
3. Market conditions assessment?
4. Risk management actions?

Provide your price alert analysis and exit recommendations.
`;

      const analysis = await this.aiAgent.executeDecision(alertPrompt);

      // Add to pending decisions for potential trade exit
      this.pendingDecisions.set(exitData.tradeId, {
        type: "price-alert",
        analysis,
        exitData,
        timestamp: new Date(),
      });

      this.logger.info(
        `🚨 AI price alert analysis completed for ${exitData.tradeId}`
      );
    } catch (error) {
      this.logger.error("Error handling price alert:", error);
    }
  }

  /**
   * Process AI decision queue
   */
  private async processAIDecisionQueue(): Promise<void> {
    try {
      for (const [id, decision] of this.pendingDecisions.entries()) {
        // Process decisions older than 30 seconds
        if (Date.now() - decision.timestamp.getTime() > 30000) {
          await this.processAIDecision(id, decision);
          this.pendingDecisions.delete(id);
        }
      }
    } catch (error) {
      this.logger.error("Error processing AI decision queue:", error);
    }
  }

  /**
   * Process individual AI decision
   */
  private async processAIDecision(id: string, decision: any): Promise<void> {
    try {
      switch (decision.type) {
        case "price-alert":
          // Process price alert decision
          if (decision.analysis.toLowerCase().includes("exit")) {
            await this.tradeExecutionService.exitTrade(
              decision.exitData.trade,
              decision.exitData.amount,
              "AI-recommended exit"
            );
          }
          break;

        case "post-processing":
          // Process post-processing decision
          this.logger.info(`Post-processing completed for ${id}`);
          break;

        case "trade-analysis":
          // Process trade analysis
          this.logger.info(`Trade analysis completed for ${id}`);
          break;

        case "error-analysis":
          // Process error analysis
          this.logger.info(`Error analysis completed for ${id}`);
          break;
      }
    } catch (error) {
      this.logger.error(`Error processing AI decision ${id}:`, error);
    }
  }

  /**
   * Get orchestrator status
   */
  getStatus(): any {
    return {
      isActive: this.isActive,
      apiSignalProcessor: this.apiSignalProcessor.getStatus(),
      pendingDecisions: this.pendingDecisions.size,
      aiAgent: {
        initialized: !!this.aiAgent,
        ready: this.isActive,
      },
      lastActivity: new Date(),
    };
  }

  /**
   * Get pending decisions
   */
  getPendingDecisions(): Map<string, any> {
    return new Map(this.pendingDecisions);
  }

  /**
   * Clear pending decisions
   */
  clearPendingDecisions(): void {
    this.pendingDecisions.clear();
    this.logger.info("Pending decisions cleared");
  }
}

export default AgenticTradingOrchestrator;
export { AgenticConfig };
