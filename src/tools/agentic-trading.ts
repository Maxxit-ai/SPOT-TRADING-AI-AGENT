import { z } from "zod";

// Global reference to the agentic orchestrator (set by agent.ts)
let agenticOrchestrator: any = null;

export function setAgenticOrchestrator(orchestrator: any) {
  agenticOrchestrator = orchestrator;
}

/**
 * AI Tool: Execute Signal Trades
 * Allows AI to decide which users to trade for and with what position sizes
 */
export async function executeSignalTrades({
  signalId,
  approvedUsers,
  positionSizeUsd,
  reasoning,
}: {
  signalId: string;
  approvedUsers: string[];
  positionSizeUsd: number;
  reasoning: string;
}): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    const result = await agenticOrchestrator.executeSignalForSubscribers(
      signalId,
      approvedUsers,
      positionSizeUsd
    );

    return `✅ AI DECISION EXECUTED: Signal trades approved

📊 Results:
• Signal ID: ${signalId}
• Approved Users: ${approvedUsers.join(", ")}
• Position Size: $${positionSizeUsd} per user
• AI Reasoning: ${reasoning}

📈 Execution Summary:
• Users Processed: ${result.processedUsers}
• Successful Trades: ${result.successfulTrades}
• Failed Trades: ${result.processedUsers - result.successfulTrades}

🎯 All approved trades have been queued for execution with your specified parameters.`;
  } catch (error) {
    return `❌ Failed to execute signal trades: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const executeSignalTradesMetadata = {
  name: "executeSignalTrades",
  description:
    "Execute trades for approved users based on AI analysis of a trading signal",
  schema: z.object({
    signalId: z.string().describe("The signal ID to execute trades for"),
    approvedUsers: z
      .array(z.string())
      .describe("List of usernames approved for trading"),
    positionSizeUsd: z
      .number()
      .describe(
        "Position size in USD for each user (AI-determined based on risk)"
      ),
    reasoning: z.string().describe("AI's reasoning for approving these trades"),
  }),
};

/**
 * AI Tool: Reject Signal
 * Allows AI to reject a trading signal with reasoning
 */
export async function rejectSignal({
  signalId,
  reason,
}: {
  signalId: string;
  reason: string;
}): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    await agenticOrchestrator.rejectSignal(signalId, reason);

    return `🚫 AI DECISION: Signal Rejected

• Signal ID: ${signalId}
• AI Reasoning: ${reason}

The signal has been removed from the pending queue and no trades will be executed.`;
  } catch (error) {
    return `❌ Failed to reject signal: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const rejectSignalMetadata = {
  name: "rejectSignal",
  description: "Reject a trading signal based on AI analysis",
  schema: z.object({
    signalId: z.string().describe("The signal ID to reject"),
    reason: z.string().describe("AI's reasoning for rejecting this signal"),
  }),
};

/**
 * AI Tool: Execute Trade Exit
 * Allows AI to decide when and how to exit trades
 */
export async function executeTradeExit({
  tradeId,
  exitPercentage = 100,
  reason,
}: {
  tradeId: string;
  exitPercentage?: number;
  reason: string;
}): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    await agenticOrchestrator.executeTradeExit(tradeId, exitPercentage, reason);

    return `🚪 AI DECISION: Trade Exit Executed

• Trade ID: ${tradeId}
• Exit Percentage: ${exitPercentage}%
• AI Reasoning: ${reason}

The trade exit has been queued for execution. The position will be ${exitPercentage === 100 ? "fully closed" : `partially closed (${exitPercentage}%)`}.`;
  } catch (error) {
    return `❌ Failed to execute trade exit: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const executeTradeExitMetadata = {
  name: "executeTradeExit",
  description: "Execute trade exit based on AI decision and market analysis",
  schema: z.object({
    tradeId: z.string().describe("The trade ID to exit"),
    exitPercentage: z
      .number()
      .optional()
      .describe("Percentage of position to exit (1-100, default 100)"),
    reason: z.string().describe("AI's reasoning for exiting this trade"),
  }),
};

/**
 * AI Tool: Modify Trade Strategy
 * Allows AI to modify exit conditions for existing trades
 */
export async function modifyTradeStrategy({
  tradeId,
  newStopLoss,
  newTp1,
  newTp2,
  enableTrailingStop,
  reasoning,
}: {
  tradeId: string;
  newStopLoss?: number;
  newTp1?: number;
  newTp2?: number;
  enableTrailingStop?: boolean;
  reasoning: string;
}): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    // Get the trade state manager from orchestrator to modify strategy
    const tradeStateManager = agenticOrchestrator.tradeStateManager;
    const trade = tradeStateManager.getTrade(tradeId);

    if (!trade) {
      return `❌ Trade ${tradeId} not found`;
    }

    // Update trade parameters
    if (newStopLoss) trade.stopLoss = newStopLoss;
    if (newTp1) trade.targets.tp1 = newTp1;
    if (newTp2) trade.targets.tp2 = newTp2;

    // Update price monitoring with new parameters
    const priceMonitoringService = agenticOrchestrator.priceMonitoringService;
    priceMonitoringService.removeTradeMonitoring(tradeId);
    priceMonitoringService.addTradeMonitoring({
      tradeId,
      tokenId: trade.tokenSymbol,
      entryPrice: trade.entryPrice,
      tp1: trade.targets.tp1,
      tp2: trade.targets.tp2,
      stopLoss: trade.stopLoss,
      maxExitTime: trade.maxExitTime,
      trailingStopEnabled: enableTrailingStop ?? true,
      trailingStopRetracement: 2,
    });

    return `🔧 AI DECISION: Trade Strategy Modified

• Trade ID: ${tradeId}
• AI Reasoning: ${reasoning}

Updated Parameters:
${newStopLoss ? `• Stop Loss: $${newStopLoss}` : ""}
${newTp1 ? `• TP1: $${newTp1}` : ""}
${newTp2 ? `• TP2: $${newTp2}` : ""}
${enableTrailingStop !== undefined ? `• Trailing Stop: ${enableTrailingStop ? "Enabled" : "Disabled"}` : ""}

The trade monitoring has been updated with the new strategy parameters.`;
  } catch (error) {
    return `❌ Failed to modify trade strategy: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const modifyTradeStrategyMetadata = {
  name: "modifyTradeStrategy",
  description:
    "Modify exit strategy for an existing trade based on AI analysis",
  schema: z.object({
    tradeId: z.string().describe("The trade ID to modify"),
    newStopLoss: z.number().optional().describe("New stop loss price"),
    newTp1: z.number().optional().describe("New TP1 target price"),
    newTp2: z.number().optional().describe("New TP2 target price"),
    enableTrailingStop: z
      .boolean()
      .optional()
      .describe("Enable or disable trailing stop"),
    reasoning: z
      .string()
      .describe("AI's reasoning for modifying this strategy"),
  }),
};

/**
 * AI Tool: Get Pending Signals
 * Allows AI to see what signals are waiting for analysis
 */
export async function getPendingSignals(): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    const status = agenticOrchestrator.getSystemStatus();

    return `📋 PENDING SIGNALS STATUS

• Pending Signals: ${status.pendingSignals}
• Active Trades: ${status.activeTrades}
• Monitored Trades: ${status.monitoredTrades}
• System Mode: ${status.mode}

${
  status.pendingSignals > 0
    ? `🔔 There are ${status.pendingSignals} signals waiting for your analysis. Use your market analysis tools to evaluate them.`
    : "✅ No signals pending. System is monitoring existing positions."
}`;
  } catch (error) {
    return `❌ Failed to get pending signals: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const getPendingSignalsMetadata = {
  name: "getPendingSignals",
  description:
    "Get information about signals waiting for AI analysis and decision",
  schema: z.object({}),
};

/**
 * AI Tool: Get Trading Context
 * Provides market context for AI decision making
 */
export async function getTradingContext({
  tokenSymbol,
}: {
  tokenSymbol: string;
}): Promise<string> {
  try {
    if (!agenticOrchestrator) {
      return "❌ Agentic orchestrator not available";
    }

    // Get current price from price monitoring service
    const priceMonitoringService = agenticOrchestrator.priceMonitoringService;
    const currentPrice =
      await priceMonitoringService.getCurrentPrice(tokenSymbol);
    const priceData = priceMonitoringService.getCachedPrice(tokenSymbol);

    // Get existing positions for this token
    const tradeStateManager = agenticOrchestrator.tradeStateManager;
    const activeTrades = tradeStateManager.getActiveTrades();
    const tokenTrades = activeTrades.filter(
      (trade: any) => trade.tokenSymbol === tokenSymbol
    );

    return `📊 TRADING CONTEXT FOR ${tokenSymbol}

💰 Price Information:
• Current Price: $${currentPrice || "N/A"}
• 24h Change: ${priceData?.change24h ? `${priceData.change24h.toFixed(2)}%` : "N/A"}
• 24h Volume: $${priceData?.volume24h ? priceData.volume24h.toLocaleString() : "N/A"}
• Last Update: ${priceData?.timestamp || "N/A"}

📈 Active Positions:
• Total ${tokenSymbol} Trades: ${tokenTrades.length}
${tokenTrades
  .slice(0, 3)
  .map(
    (trade: any) =>
      `• ${trade.userId}: ${trade.status} (Entry: $${trade.entryPrice})`
  )
  .join("\n")}

Use this context along with your market analysis tools to make informed trading decisions.`;
  } catch (error) {
    return `❌ Failed to get trading context: ${error instanceof Error ? error.message : "Unknown error"}`;
  }
}

export const getTradingContextMetadata = {
  name: "getTradingContext",
  description:
    "Get current market context and position information for a token to aid in trading decisions",
  schema: z.object({
    tokenSymbol: z
      .string()
      .describe("Token symbol to get context for (e.g., 'ETH', 'BTC')"),
  }),
};
