"use client";

import { Bot, Brain, Zap, MessageSquare, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { useRef, useEffect, useState } from "react";
import type { AgentActivityState, LyzrAgentEvent } from "@/lib/lyzrAgentEvents";
import { cn } from "@/lib/utils";

interface AgentActivityPanelProps extends AgentActivityState {
  className?: string;
}

// Format event time
function formatEventTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', { 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  } catch {
    return "";
  }
}

// Get icon for event type
function getEventIcon(event: LyzrAgentEvent) {
  if (
    event.event_type === "thinking" ||
    event.feature?.includes("thinking")
  ) {
    return Brain;
  }
  if (event.event_type === "llm_generation") {
    return MessageSquare;
  }
  if (event.event_type === "tool_calling") {
    return Activity;
  }
  return Zap;
}

// Get color class for event
function getEventColor(event: LyzrAgentEvent) {
  if (event.status === "completed") {
    return "text-green-600 bg-green-50 border-green-200";
  }
  if (event.status === "failed") {
    return "text-red-600 bg-red-50 border-red-200";
  }
  if (event.event_type === "thinking") {
    return "text-purple-600 bg-purple-50 border-purple-200";
  }
  return "text-blue-600 bg-blue-50 border-blue-200";
}

/**
 * Agent Activity Panel Component
 * 
 * Displays real-time agent activity including:
 * - Current agent thinking
 * - Event feed
 * - Agent status
 */
export function AgentActivityPanel({
  isConnected,
  events,
  thinkingEvents,
  lastThinkingMessage,
  activeAgentId,
  activeAgentName,
  isProcessing,
  className,
}: AgentActivityPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showThinking, setShowThinking] = useState(true);
  
  const safeEvents = Array.isArray(events) ? events : [];

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current && isExpanded) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [safeEvents, isExpanded]);

  // Get recent events (last 20)
  const recentEvents = safeEvents.slice(-20);

  // Set to true to show the Agent Activity panel again
  const showPanel = false;

  if (!showPanel) return null;

  return (
    <div className={cn("flex flex-col h-full bg-white border rounded-lg shadow-sm", className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-blue-600" />
          <h2 className="text-base font-semibold text-gray-900">Agent Activity</h2>
        </div>
        {isConnected && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-gray-600">Live</span>
          </div>
        )}
      </div>

      {/* Current Agent & Thinking */}
      {isProcessing && (
        <div className="p-4 border-b bg-gradient-to-r from-purple-50 to-pink-50">
          {/* Active Agent */}
          {activeAgentName && (
            <div className="mb-3 flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-purple-500 animate-pulse" />
              <span className="text-sm font-medium text-gray-900">
                {activeAgentName}
              </span>
            </div>
          )}

          {/* Thinking Toggle */}
          <button
            onClick={() => setShowThinking(!showThinking)}
            className="flex items-center justify-between w-full text-left mb-2"
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-purple-600" />
              <span className="text-sm font-medium text-gray-700">
                Agent Thinking
              </span>
            </div>
            {showThinking ? (
              <ChevronUp className="h-4 w-4 text-gray-400" />
            ) : (
              <ChevronDown className="h-4 w-4 text-gray-400" />
            )}
          </button>

          {/* Thinking Message */}
          {showThinking && lastThinkingMessage && (
            <div className="p-3 rounded-lg bg-white border border-purple-200 shadow-sm">
              <p className="text-sm text-gray-700 whitespace-pre-wrap">
                {lastThinkingMessage}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Activity Feed */}
      <div className="flex-1 flex flex-col min-h-0">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center justify-between w-full text-left p-4 hover:bg-gray-50"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-gray-600" />
            <span className="text-sm font-medium text-gray-700">
              Event Feed
            </span>
            <span className="text-xs text-gray-500">
              ({recentEvents.length})
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="h-4 w-4 text-gray-400" />
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )}
        </button>

        {isExpanded && (
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 pt-0 space-y-2"
          >
            {recentEvents.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Zap className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p className="text-xs">
                  {isProcessing
                    ? "Waiting for events..."
                    : "Send a message to see agent activity"}
                </p>
              </div>
            ) : (
              recentEvents.map((event, index) => {
                const Icon = getEventIcon(event);
                const colorClass = getEventColor(event);

                return (
                  <div
                    key={`${event.log_id}-${index}`}
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border",
                      colorClass
                    )}
                  >
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold truncate">
                          {event.feature || event.event_type}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                            event.status === "completed"
                              ? "bg-green-100 text-green-700"
                              : event.status === "failed"
                              ? "bg-red-100 text-red-700"
                              : "bg-blue-100 text-blue-700"
                          )}
                        >
                          {event.status}
                        </span>
                      </div>
                      {event.message && (
                        <p className="text-xs mt-1 line-clamp-2">
                          {event.message}
                        </p>
                      )}
                      {event.tool_name && (
                        <p className="text-xs mt-1 font-medium">
                          Tool: {event.tool_name}
                        </p>
                      )}
                      <span className="text-[10px] text-gray-500 mt-1 block">
                        {formatEventTime(event.timestamp)}
                      </span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Footer Status */}
      <div className="p-3 border-t bg-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-600">
          <span>
            {isProcessing ? "Processing..." : "Ready"}
          </span>
          <span>
            {recentEvents.length} events
          </span>
        </div>
      </div>
    </div>
  );
}
