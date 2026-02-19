"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import fetchWrapper from "@/lib/fetchWrapper";

/**
 * Types for Lyzr Agent Events WebSocket
 * Based on: https://docs.lyzr.ai/agent-apis/agents/agent%20events
 */

/**
 * Raw event payload from Lyzr WebSocket
 */
export interface LyzrAgentEvent {
  feature: string;
  level: "DEBUG" | "INFO" | "ERROR" | "debug" | "info" | "error";
  status: "in_progress" | "completed" | "failed" | "success";
  message: string;
  timestamp: string;
  event_type: string;
  run_id: string;
  trace_id: string;
  session_id: string;
  model?: string;
  provider?: string;
  log_id: string;
  // Agent info
  agent_name?: string;
  agent_id?: string;
  user_id?: string;
  // Manager Agent thinking events use this field for actual reasoning
  thinking?: string;
  context_type?: string;
  iteration?: number;
  tool_name?: string | null;
  // Memory-related fields
  message_count?: number;
  summary_length?: number;
  summary_exists?: boolean;
}

/**
 * State exposed by the useLyzrAgentEvents hook
 */
export interface AgentActivityState {
  isConnected: boolean;
  events: LyzrAgentEvent[];
  thinkingEvents: LyzrAgentEvent[];
  lastThinkingMessage: string | null;
  activeAgentId: string | null;
  activeAgentName: string | null;
  isProcessing: boolean;
}

const WS_BASE_URL = "wss://metrics.studio.lyzr.ai/session";

/**
 * Check if event is a "thinking" event
 * 
 * We want to capture ALL events that contain agent reasoning/thinking:
 * - thinking_log events with thinking field (Manager Agent reasoning)
 * - tool_calling events (decisions about which tools/agents to call)
 * - tool_result events (reasoning about results)
 * - Any event with substantive message content
 */
function isThinkingEvent(event: LyzrAgentEvent): boolean {
  // Check for "thinking" field (Manager Agent reasoning)
  if (event.thinking && event.thinking.trim().length > 3) {
    return true;
  }
  
  // Check for thinking_log event type
  if (event.event_type === "thinking_log") {
    return true;
  }
  
  // Tool calling events (these show agent decision-making)
  if (
    event.event_type === "tool_calling" ||
    event.event_type === "tool_calling_iteration" ||
    event.feature === "tool_calling"
  ) {
    // Only include if has substantive message or thinking
    if (event.message && event.message.trim().length > 3) {
      return true;
    }
  }
  
  // Tool result events with context_type
  if (event.context_type === "tool_result" && event.message && event.message.trim().length > 3) {
    return true;
  }
  
  // Explicit thinking event types
  if (
    event.event_type === "thinking" ||
    event.event_type === "manager_thought" ||
    event.event_type === "agent_reasoning"
  ) {
    return true;
  }
  
  // Feature includes thinking
  if (event.feature?.toLowerCase().includes("thinking")) {
    return true;
  }
  
  return false;
}

/**
 * Hook to subscribe to Lyzr Agent Events via WebSocket
 * 
 * SECURITY: Uses server-side API route to get WebSocket credentials
 * 
 * @param sessionId - The Lyzr session ID (from agent response)
 * @returns Agent activity state and control functions
 */
export function useLyzrAgentEvents(
  sessionId: string | null
): AgentActivityState & {
  reset: () => void;
  setProcessing: (processing: boolean) => void;
} {
  const [isConnected, setIsConnected] = useState(false);
  const [events, setEvents] = useState<LyzrAgentEvent[]>([]);
  const [thinkingEvents, setThinkingEvents] = useState<LyzrAgentEvent[]>([]);
  const [lastThinkingMessage, setLastThinkingMessage] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeAgentName, setActiveAgentName] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const isProcessingRef = useRef(false);
  const maxReconnectAttempts = 5;

  /**
   * Reset all state
   */
  const reset = useCallback(() => {
    console.log("🧹 Resetting agent events state");
    setEvents([]);
    setThinkingEvents([]);
    setLastThinkingMessage(null);
    setActiveAgentId(null);
    setActiveAgentName(null);
    setIsProcessing(false);
    
    // Close existing WebSocket connection
    if (wsRef.current) {
      console.log("🔌 Closing existing WebSocket connection");
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // Clear any pending reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Reset reconnect attempts
    reconnectAttemptsRef.current = 0;
    setIsConnected(false);
  }, []);

  /**
   * Set processing state (called when user sends a message)
   */
  const setProcessingState = useCallback((processing: boolean) => {
    setIsProcessing(processing);
    isProcessingRef.current = processing;
    
    if (!processing) {
      // When done processing, clear active agent
      setActiveAgentId(null);
      setActiveAgentName(null);
    }
  }, []);

  /**
   * Handle incoming WebSocket message
   */
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      const data: LyzrAgentEvent = JSON.parse(event.data);

      // Log event for debugging
      console.log("📨 Lyzr Event:", {
        event_type: data.event_type,
        feature: data.feature,
        status: data.status,
        agent_id: data.agent_id,
        agent_name: data.agent_name,
        message: data.message?.substring(0, 100),
      });

      // Add to events list (keep last 100 events)
      setEvents((prev) => [...prev.slice(-99), data]);

      // Track active agent
      if (data.agent_id) {
        setActiveAgentId(data.agent_id);
      }
      if (data.agent_name) {
        setActiveAgentName(data.agent_name);
      }

      // Check if it's a thinking event
      const isThinking = isThinkingEvent(data);
      if (isThinking) {
        // Use "thinking" field if available, otherwise use "message"
        const thinkingContent = data.thinking || data.message;
        console.log("🧠 Thinking Event:", thinkingContent);
        setThinkingEvents((prev) => [...prev.slice(-19), data]); // Keep last 20
        if (thinkingContent) {
          setLastThinkingMessage(thinkingContent);
        }
      }

      // Also capture thinking_log events with "thinking" field directly
      if (data.thinking && data.thinking.length > 5) {
        setLastThinkingMessage(data.thinking);
      }

      // Check for completion
      if (data.status === "completed" && data.event_type === "llm_generation") {
        setIsProcessing(false);
      }
    } catch (error) {
      console.error("Error parsing WebSocket message:", error, event.data);
    }
  }, []);

  /**
   * Connect to WebSocket
   * 
   * First fetches WebSocket credentials from server-side API,
   * then establishes the WebSocket connection
   */
  const connect = useCallback(async () => {
    if (!sessionId) {
      console.warn("Cannot connect: missing sessionId");
      return;
    }

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    try {
      // Get WebSocket credentials from server (keeps API key secure)
      const response = await fetchWrapper('/api/agent-events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ session_id: sessionId }),
      });

      if (!response.ok) {
        throw new Error('Failed to get WebSocket credentials');
      }

      const { apiKey, wsUrl } = await response.json();

      // Connect to Lyzr WebSocket with API key from server
      const fullWsUrl = `${wsUrl}?x-api-key=${encodeURIComponent(apiKey)}`;
      console.log("🔌 Connecting to Lyzr WebSocket");

      const ws = new WebSocket(fullWsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("✅ Lyzr WebSocket connected successfully");
        setIsConnected(true);
        reconnectAttemptsRef.current = 0;
      };

      ws.onmessage = handleMessage;

      ws.onerror = (error) => {
        console.error("❌ Lyzr WebSocket error:", {
          type: error.type,
          message: error instanceof ErrorEvent ? error.message : "Connection error",
        });
        setIsConnected(false);
      };

      ws.onclose = (event) => {
        console.log("🔴 Lyzr WebSocket closed:", event.code, event.reason);
        setIsConnected(false);
        wsRef.current = null;

        // Attempt reconnect with exponential backoff
        if (isProcessingRef.current && reconnectAttemptsRef.current < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          console.log(`⏳ Reconnecting in ${delay}ms (attempt ${reconnectAttemptsRef.current})`);
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };
    } catch (error) {
      console.error("Error creating WebSocket:", error);
      setIsConnected(false);
    }
  }, [sessionId, handleMessage]);

  /**
   * Effect to manage WebSocket connection
   */
  useEffect(() => {
    // Only connect while processing (prevents idle errors/spam)
    if (!sessionId || !isProcessing) {
      // Ensure we are disconnected in idle state
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      setIsConnected(false);
      return;
    }

    console.log("🔄 Session ID changed, connecting...");

    // Small delay to ensure state is settled
    const timeoutId = setTimeout(() => {
      connect();
    }, 100);
    
    return () => {
      clearTimeout(timeoutId);
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [sessionId, connect, isProcessing]);

  return {
    isConnected,
    events,
    thinkingEvents,
    lastThinkingMessage,
    activeAgentId,
    activeAgentName,
    isProcessing,
    reset,
    setProcessing: setProcessingState,
  };
}
