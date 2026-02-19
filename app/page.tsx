'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { callAIAgent } from '@/lib/aiAgent'
import {
  getSchedule, getScheduleLogs,
  pauseSchedule, resumeSchedule, cronToHuman,
  createSchedule, deleteSchedule
} from '@/lib/scheduler'
import type { Schedule, ExecutionLog } from '@/lib/scheduler'
import { useLyzrAgentEvents } from '@/lib/lyzrAgentEvents'
import { AgentActivityPanel } from '@/components/AgentActivityPanel'
import { IoMdMail, IoMdSettings, IoMdTime, IoMdCheckmarkCircle, IoMdAlert } from 'react-icons/io'
import { MdDashboard, MdTrendingUp, MdTrendingDown, MdSchedule, MdRefresh } from 'react-icons/md'
import { FiPlay, FiPause, FiCheck, FiX, FiPlus, FiSend } from 'react-icons/fi'
import { RiCoinsFill } from 'react-icons/ri'

// --------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------

const MANAGER_AGENT_ID = '6997285ac4e47cc7968fd581'
const INITIAL_SCHEDULE_ID = '69972860399dfadeac37b79a'
const STORAGE_KEY = 'gold_alert_settings'
const SCHEDULE_ID_KEY = 'gold_alert_schedule_id'

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface AlertSettings {
  recipientEmails: string[]
  frequency: 'hourly' | 'daily' | 'weekly'
  triggerTime: string
  timezone: string
  thresholdEnabled: boolean
  thresholdAbove: string
  thresholdBelow: string
  unit: 'ounce' | 'gram'
}

interface PriceData {
  current_price_per_ounce?: string
  current_price_per_gram?: string
  price_change_24h?: string
  price_change_percentage?: string
  daily_high?: string
  daily_low?: string
  weekly_trend?: string
  data_source?: string
  timestamp?: string
}

interface ThresholdEval {
  threshold_configured?: boolean
  threshold_met?: boolean
  threshold_details?: string
}

interface EmailStatus {
  email_sent?: boolean
  recipient_emails?: string
  status_message?: string
}

interface AgentResult {
  price_data?: PriceData
  threshold_evaluation?: ThresholdEval
  email_status?: EmailStatus
  summary?: string
}

interface Notification {
  type: 'success' | 'error'
  message: string
}

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

const DEFAULT_SETTINGS: AlertSettings = {
  recipientEmails: [],
  frequency: 'daily',
  triggerTime: '09:00',
  timezone: 'America/New_York',
  thresholdEnabled: false,
  thresholdAbove: '2500',
  thresholdBelow: '2000',
  unit: 'ounce',
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function parseAgentResult(result: any): AgentResult | null {
  if (!result) return null
  if (typeof result === 'object') return result as AgentResult
  if (typeof result === 'string') {
    try {
      return JSON.parse(result) as AgentResult
    } catch {
      const jsonMatch = result.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]) as AgentResult
        } catch {
          return null
        }
      }
      return null
    }
  }
  return null
}

function loadSettings(): AlertSettings {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function saveSettings(settings: AlertSettings) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

function loadScheduleId(): string {
  if (typeof window === 'undefined') return INITIAL_SCHEDULE_ID
  return localStorage.getItem(SCHEDULE_ID_KEY) || INITIAL_SCHEDULE_ID
}

function saveScheduleId(id: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(SCHEDULE_ID_KEY, id)
}

function buildCron(frequency: string, time: string): string {
  const [hour, minute] = time.split(':')
  const h = hour ?? '9'
  const m = minute ?? '0'
  switch (frequency) {
    case 'hourly': return `${m} * * * *`
    case 'daily': return `${m} ${h} * * *`
    case 'weekly': return `${m} ${h} * * 1`
    default: return `${m} ${h} * * *`
  }
}

function composeAgentMessage(settings: AlertSettings): string {
  const emails = Array.isArray(settings.recipientEmails) && settings.recipientEmails.length > 0
    ? settings.recipientEmails.join(', ')
    : 'no recipients configured'

  let thresholdLine = 'No threshold configured'
  if (settings.thresholdEnabled) {
    const unitLabel = settings.unit === 'gram' ? 'g' : 'oz'
    const parts: string[] = []
    if (settings.thresholdAbove) parts.push(`above $${settings.thresholdAbove}/${unitLabel}`)
    if (settings.thresholdBelow) parts.push(`below $${settings.thresholdBelow}/${unitLabel}`)
    if (parts.length > 0) thresholdLine = `Alert when price goes ${parts.join(' or ')}`
  }

  return `Fetch current gold prices and send an alert email.\nRecipients: ${emails}\nThreshold: ${thresholdLine}\nUnit preference: ${settings.unit}`
}

function formatTs(ts: string | undefined | null): string {
  if (!ts) return '--'
  try {
    return new Date(ts).toLocaleString()
  } catch {
    return ts
  }
}

const SAMPLE_LOGS: ExecutionLog[] = [
  {
    id: 'sample-1',
    schedule_id: 'sample',
    agent_id: MANAGER_AGENT_ID,
    user_id: 'sample',
    session_id: 'sample-session-1',
    executed_at: '2026-02-19T09:00:00Z',
    attempt: 1,
    max_attempts: 3,
    success: true,
    payload_message: 'Fetch current gold prices and send an alert email.',
    response_status: 200,
    response_output: JSON.stringify({
      price_data: { current_price_per_ounce: '$2,847.50', price_change_24h: '+$12.30', price_change_percentage: '+0.43%', daily_high: '$2,855.00', daily_low: '$2,832.10', weekly_trend: 'Bullish', data_source: 'Market API', timestamp: '2026-02-19T09:00:00Z' },
      threshold_evaluation: { threshold_configured: true, threshold_met: true, threshold_details: 'Price above $2,500/oz threshold' },
      email_status: { email_sent: true, recipient_emails: 'trader@example.com', status_message: 'Email sent successfully' },
      summary: 'Gold price is $2,847.50/oz. Alert threshold met. Email sent.'
    }),
    error_message: null,
  },
  {
    id: 'sample-2',
    schedule_id: 'sample',
    agent_id: MANAGER_AGENT_ID,
    user_id: 'sample',
    session_id: 'sample-session-2',
    executed_at: '2026-02-18T09:00:00Z',
    attempt: 1,
    max_attempts: 3,
    success: true,
    payload_message: 'Fetch current gold prices and send an alert email.',
    response_status: 200,
    response_output: JSON.stringify({
      price_data: { current_price_per_ounce: '$2,835.20', price_change_24h: '-$5.80', price_change_percentage: '-0.20%', daily_high: '$2,845.00', daily_low: '$2,828.50', weekly_trend: 'Neutral', data_source: 'Market API', timestamp: '2026-02-18T09:00:00Z' },
      threshold_evaluation: { threshold_configured: true, threshold_met: true, threshold_details: 'Price above $2,500/oz threshold' },
      email_status: { email_sent: true, recipient_emails: 'trader@example.com', status_message: 'Email sent successfully' },
      summary: 'Gold price is $2,835.20/oz. Alert threshold met. Email sent.'
    }),
    error_message: null,
  },
  {
    id: 'sample-3',
    schedule_id: 'sample',
    agent_id: MANAGER_AGENT_ID,
    user_id: 'sample',
    session_id: 'sample-session-3',
    executed_at: '2026-02-17T09:00:00Z',
    attempt: 1,
    max_attempts: 3,
    success: true,
    payload_message: 'Fetch current gold prices and send an alert email.',
    response_status: 200,
    response_output: JSON.stringify({
      price_data: { current_price_per_ounce: '$2,841.00', price_change_24h: '+$18.60', price_change_percentage: '+0.66%', daily_high: '$2,850.00', daily_low: '$2,820.00', weekly_trend: 'Bullish', data_source: 'Market API', timestamp: '2026-02-17T09:00:00Z' },
      threshold_evaluation: { threshold_configured: false, threshold_met: false, threshold_details: 'No threshold configured' },
      email_status: { email_sent: true, recipient_emails: 'trader@example.com', status_message: 'Email sent successfully' },
      summary: 'Gold price is $2,841.00/oz. Email sent to trader@example.com.'
    }),
    error_message: null,
  },
]

const SAMPLE_RESULT: AgentResult = {
  price_data: {
    current_price_per_ounce: '$2,847.50',
    current_price_per_gram: '$91.57',
    price_change_24h: '+$12.30',
    price_change_percentage: '+0.43%',
    daily_high: '$2,855.00',
    daily_low: '$2,832.10',
    weekly_trend: 'Bullish',
    data_source: 'Market Data API',
    timestamp: '2026-02-19T14:30:00Z',
  },
  threshold_evaluation: {
    threshold_configured: true,
    threshold_met: true,
    threshold_details: 'Current price $2,847.50/oz exceeds threshold of $2,500/oz',
  },
  email_status: {
    email_sent: true,
    recipient_emails: 'trader@example.com, analyst@example.com',
    status_message: 'Alert email sent successfully to all recipients',
  },
  summary: 'Gold is currently trading at $2,847.50 per ounce, up $12.30 (+0.43%) in the last 24 hours. The price has exceeded the configured threshold of $2,500/oz. Alert emails have been sent successfully to all 2 recipients.',
}

// --------------------------------------------------------------------------
// Error Boundary
// --------------------------------------------------------------------------

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: '' }
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-[hsl(0,0%,99%)] text-[hsl(30,5%,15%)]">
          <div className="text-center p-8 max-w-md">
            <h2 className="text-xl font-normal mb-2 tracking-widest uppercase">Something went wrong</h2>
            <p className="text-[hsl(30,5%,50%)] mb-4 text-sm">{this.state.error}</p>
            <button onClick={() => this.setState({ hasError: false, error: '' })} className="px-6 py-2 bg-[hsl(40,30%,45%)] text-white tracking-widest uppercase text-xs">
              Try again
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}

// --------------------------------------------------------------------------
// Inline components
// --------------------------------------------------------------------------

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest font-normal ${active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-[hsl(30,8%,92%)] text-[hsl(30,5%,50%)] border border-[hsl(30,10%,88%)]'}`}>
      <span className={`w-1.5 h-1.5 ${active ? 'bg-emerald-500' : 'bg-[hsl(30,5%,50%)]'}`} />
      {active ? 'Active' : 'Paused'}
    </span>
  )
}

function TrendIndicator({ change }: { change: string | undefined }) {
  if (!change) return <span className="text-[hsl(30,5%,50%)]">--</span>
  const isPositive = change.includes('+')
  const isNegative = change.includes('-')
  return (
    <span className={`inline-flex items-center gap-1 ${isPositive ? 'text-emerald-600' : isNegative ? 'text-[hsl(0,50%,45%)]' : 'text-[hsl(30,5%,50%)]'}`}>
      {isPositive ? <MdTrendingUp className="w-4 h-4" /> : isNegative ? <MdTrendingDown className="w-4 h-4" /> : null}
      {change}
    </span>
  )
}

// --------------------------------------------------------------------------
// Dashboard Tab
// --------------------------------------------------------------------------

function DashboardTab({
  schedule,
  scheduleLoading,
  logs,
  logsLoading,
  lastResult,
  checkNowLoading,
  onCheckNow,
  onToggleSchedule,
  onRefreshLogs,
  sampleMode,
  notification,
  onDismissNotification,
}: {
  schedule: Schedule | null
  scheduleLoading: boolean
  logs: ExecutionLog[]
  logsLoading: boolean
  lastResult: AgentResult | null
  checkNowLoading: boolean
  onCheckNow: () => void
  onToggleSchedule: () => void
  onRefreshLogs: () => void
  sampleMode: boolean
  notification: Notification | null
  onDismissNotification: () => void
}) {
  const displayResult = sampleMode && !lastResult ? SAMPLE_RESULT : lastResult
  const displayLogs = sampleMode && logs.length === 0 ? SAMPLE_LOGS : logs
  const priceData = displayResult?.price_data
  const isActive = schedule?.is_active ?? false

  const [showResultModal, setShowResultModal] = useState(false)

  return (
    <div className="space-y-8">
      {/* Notification Banner */}
      {notification && (
        <div className={`p-4 border-b ${notification.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-[hsl(0,50%,45%)] border-red-200'}`}>
          <div className="flex items-center justify-between">
            <span className="tracking-wider text-sm uppercase font-light">{notification.message}</span>
            <button onClick={onDismissNotification} className="ml-4">
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Status Cards Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Current Gold Price */}
        <div className="bg-white border border-[hsl(30,10%,88%)] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Gold Price</span>
            <RiCoinsFill className="w-5 h-5 text-[hsl(40,30%,45%)]" />
          </div>
          <div className="text-3xl font-normal tracking-wide text-[hsl(30,5%,15%)]">
            {priceData?.current_price_per_ounce ?? '--'}
          </div>
          <div className="mt-2 text-sm">
            <TrendIndicator change={priceData?.price_change_percentage} />
          </div>
          {priceData?.timestamp && (
            <div className="mt-2 text-[10px] text-[hsl(30,5%,50%)] tracking-wider uppercase">
              {formatTs(priceData.timestamp)}
            </div>
          )}
        </div>

        {/* Next Scheduled Alert */}
        <div className="bg-white border border-[hsl(30,10%,88%)] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Next Alert</span>
            <MdSchedule className="w-5 h-5 text-[hsl(40,30%,45%)]" />
          </div>
          <div className="text-sm font-normal text-[hsl(30,5%,15%)]">
            {scheduleLoading ? (
              <div className="flex items-center gap-2"><Spinner /> <span className="text-[hsl(30,5%,50%)]">Loading...</span></div>
            ) : schedule?.next_run_time ? (
              formatTs(schedule.next_run_time)
            ) : (
              '--'
            )}
          </div>
          {schedule?.cron_expression && (
            <div className="mt-2 text-[10px] text-[hsl(30,5%,50%)] tracking-wider uppercase">
              {cronToHuman(schedule.cron_expression)}
            </div>
          )}
        </div>

        {/* Alert Status */}
        <div className="bg-white border border-[hsl(30,10%,88%)] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Alert Status</span>
            {isActive ? <IoMdCheckmarkCircle className="w-5 h-5 text-emerald-600" /> : <IoMdAlert className="w-5 h-5 text-[hsl(30,5%,50%)]" />}
          </div>
          <div className="mb-3">
            <StatusBadge active={isActive} />
          </div>
          <button
            onClick={onToggleSchedule}
            disabled={scheduleLoading || !schedule}
            className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-[hsl(40,30%,45%)] hover:text-[hsl(40,30%,35%)] disabled:opacity-40 transition-colors"
          >
            {isActive ? <><FiPause className="w-3 h-3" /> Pause</> : <><FiPlay className="w-3 h-3" /> Resume</>}
          </button>
        </div>

        {/* Total Alerts Sent */}
        <div className="bg-white border border-[hsl(30,10%,88%)] p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Alerts Sent</span>
            <IoMdMail className="w-5 h-5 text-[hsl(40,30%,45%)]" />
          </div>
          <div className="text-3xl font-normal tracking-wide text-[hsl(30,5%,15%)]">
            {displayLogs.filter(l => {
              const parsed = parseAgentResult(l.response_output)
              return parsed?.email_status?.email_sent === true
            }).length}
          </div>
          <div className="mt-2 text-[10px] text-[hsl(30,5%,50%)] tracking-wider uppercase">
            Total deliveries
          </div>
        </div>
      </div>

      {/* Actions Row */}
      <div className="flex flex-wrap items-center gap-4">
        <button
          onClick={onCheckNow}
          disabled={checkNowLoading}
          className="flex items-center gap-2 px-6 py-3 bg-[hsl(40,30%,45%)] text-white text-xs uppercase tracking-widest hover:bg-[hsl(40,30%,40%)] disabled:opacity-50 transition-colors shadow-sm"
        >
          {checkNowLoading ? <Spinner /> : <FiSend className="w-3.5 h-3.5" />}
          {checkNowLoading ? 'Checking...' : 'Check Now'}
        </button>

        <button
          onClick={onRefreshLogs}
          disabled={logsLoading}
          className="flex items-center gap-2 px-5 py-3 bg-white border border-[hsl(30,10%,88%)] text-[hsl(30,5%,15%)] text-xs uppercase tracking-widest hover:bg-[hsl(30,10%,95%)] disabled:opacity-50 transition-colors shadow-sm"
        >
          <MdRefresh className={`w-4 h-4 ${logsLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>

        {displayResult && (
          <button
            onClick={() => setShowResultModal(true)}
            className="flex items-center gap-2 px-5 py-3 bg-white border border-[hsl(30,10%,88%)] text-[hsl(30,5%,15%)] text-xs uppercase tracking-widest hover:bg-[hsl(30,10%,95%)] transition-colors shadow-sm"
          >
            <RiCoinsFill className="w-3.5 h-3.5 text-[hsl(40,30%,45%)]" />
            View Latest Result
          </button>
        )}
      </div>

      {/* Latest Result Detail (inline) */}
      {displayResult && priceData && (
        <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
          <div className="p-6 border-b border-[hsl(30,10%,88%)]">
            <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Latest Price Report</h3>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Price / Ounce</div>
                <div className="text-xl font-normal">{priceData.current_price_per_ounce ?? '--'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Price / Gram</div>
                <div className="text-xl font-normal">{priceData.current_price_per_gram ?? '--'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">24h Change</div>
                <div className="text-xl font-normal"><TrendIndicator change={priceData.price_change_24h} /></div>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Daily High</div>
                <div className="text-sm">{priceData.daily_high ?? '--'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Daily Low</div>
                <div className="text-sm">{priceData.daily_low ?? '--'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Weekly Trend</div>
                <div className="text-sm">{priceData.weekly_trend ?? '--'}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Source</div>
                <div className="text-sm">{priceData.data_source ?? '--'}</div>
              </div>
            </div>

            {/* Threshold Evaluation */}
            {displayResult.threshold_evaluation && (
              <div className="border-t border-[hsl(30,10%,88%)] pt-4 mb-4">
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Threshold Evaluation</div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest border ${displayResult.threshold_evaluation.threshold_configured ? 'bg-[hsl(40,30%,45%)]/10 text-[hsl(40,30%,35%)] border-[hsl(40,30%,45%)]/30' : 'bg-[hsl(30,8%,92%)] text-[hsl(30,5%,50%)] border-[hsl(30,10%,88%)]'}`}>
                    {displayResult.threshold_evaluation.threshold_configured ? 'Configured' : 'Not Configured'}
                  </span>
                  {displayResult.threshold_evaluation.threshold_configured && (
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest border ${displayResult.threshold_evaluation.threshold_met ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[hsl(30,8%,92%)] text-[hsl(30,5%,50%)] border-[hsl(30,10%,88%)]'}`}>
                      {displayResult.threshold_evaluation.threshold_met ? 'Threshold Met' : 'Below Threshold'}
                    </span>
                  )}
                </div>
                {displayResult.threshold_evaluation.threshold_details && (
                  <p className="mt-2 text-sm text-[hsl(30,5%,50%)]">{displayResult.threshold_evaluation.threshold_details}</p>
                )}
              </div>
            )}

            {/* Email Status */}
            {displayResult.email_status && (
              <div className="border-t border-[hsl(30,10%,88%)] pt-4 mb-4">
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Email Status</div>
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-widest border ${displayResult.email_status.email_sent ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[hsl(30,8%,92%)] text-[hsl(30,5%,50%)] border-[hsl(30,10%,88%)]'}`}>
                    {displayResult.email_status.email_sent ? <><FiCheck className="w-3 h-3" /> Sent</> : 'Not Sent'}
                  </span>
                </div>
                {displayResult.email_status.recipient_emails && (
                  <p className="text-sm text-[hsl(30,5%,50%)]">To: {displayResult.email_status.recipient_emails}</p>
                )}
                {displayResult.email_status.status_message && (
                  <p className="text-sm text-[hsl(30,5%,50%)]">{displayResult.email_status.status_message}</p>
                )}
              </div>
            )}

            {/* Summary */}
            {displayResult.summary && (
              <div className="border-t border-[hsl(30,10%,88%)] pt-4">
                <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Summary</div>
                <p className="text-sm leading-relaxed text-[hsl(30,5%,15%)]">{displayResult.summary}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Alert History Table */}
      <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
        <div className="p-6 border-b border-[hsl(30,10%,88%)] flex items-center justify-between">
          <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Alert History</h3>
          <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">{displayLogs.length} entries</span>
        </div>

        {logsLoading ? (
          <div className="p-12 flex items-center justify-center">
            <Spinner />
            <span className="ml-3 text-sm text-[hsl(30,5%,50%)] tracking-wider uppercase">Loading history...</span>
          </div>
        ) : displayLogs.length === 0 ? (
          <div className="p-12 text-center">
            <IoMdTime className="w-10 h-10 mx-auto mb-4 text-[hsl(30,10%,88%)]" />
            <p className="text-sm text-[hsl(30,5%,50%)] tracking-wider">No alert history yet</p>
            <p className="text-xs text-[hsl(30,5%,50%)] mt-1 tracking-wider">Configure your settings and schedule to start receiving alerts</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[hsl(30,10%,88%)]">
                  <th className="text-left p-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Date / Time</th>
                  <th className="text-left p-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Gold Price</th>
                  <th className="text-left p-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Threshold</th>
                  <th className="text-left p-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Sent To</th>
                  <th className="text-left p-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Status</th>
                </tr>
              </thead>
              <tbody>
                {displayLogs.map((log) => {
                  const parsed = parseAgentResult(log.response_output)
                  return (
                    <tr key={log.id} className="border-b border-[hsl(30,10%,88%)] last:border-b-0 hover:bg-[hsl(30,10%,95%)] transition-colors">
                      <td className="p-4 text-sm text-[hsl(30,5%,15%)]">{formatTs(log.executed_at)}</td>
                      <td className="p-4 text-sm font-normal text-[hsl(30,5%,15%)]">{parsed?.price_data?.current_price_per_ounce ?? '--'}</td>
                      <td className="p-4">
                        {parsed?.threshold_evaluation?.threshold_configured ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[10px] uppercase tracking-widest border ${parsed?.threshold_evaluation?.threshold_met ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-[hsl(30,8%,92%)] text-[hsl(30,5%,50%)] border-[hsl(30,10%,88%)]'}`}>
                          {parsed?.threshold_evaluation?.threshold_met ? 'Met' : 'Not Met'}
                          </span>
                        ) : (
                          <span className="text-xs text-[hsl(30,5%,50%)]">--</span>
                        )}
                      </td>
                      <td className="p-4 text-sm text-[hsl(30,5%,50%)]">{parsed?.email_status?.recipient_emails ?? '--'}</td>
                      <td className="p-4">
                        {log.success ? (
                          <span className="inline-flex items-center gap-1 text-emerald-600 text-[10px] uppercase tracking-widest">
                            <FiCheck className="w-3 h-3" /> Delivered
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[hsl(0,50%,45%)] text-[10px] uppercase tracking-widest">
                            <FiX className="w-3 h-3" /> Failed
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Result Modal */}
      {showResultModal && displayResult && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4" onClick={() => setShowResultModal(false)}>
          <div className="bg-white border border-[hsl(30,10%,88%)] shadow-lg max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b border-[hsl(30,10%,88%)] flex items-center justify-between">
              <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)]">Full Price Report</h3>
              <button onClick={() => setShowResultModal(false)} className="text-[hsl(30,5%,50%)] hover:text-[hsl(30,5%,15%)]">
                <FiX className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <pre className="text-xs leading-relaxed whitespace-pre-wrap text-[hsl(30,5%,15%)] font-mono">
                {JSON.stringify(displayResult, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --------------------------------------------------------------------------
// Settings Tab
// --------------------------------------------------------------------------

function SettingsTab({
  settings,
  onSettingsChange,
  onSave,
  saving,
  notification,
  onDismissNotification,
}: {
  settings: AlertSettings
  onSettingsChange: (s: AlertSettings) => void
  onSave: () => void
  saving: boolean
  notification: Notification | null
  onDismissNotification: () => void
}) {
  const [emailInput, setEmailInput] = useState('')

  const addEmail = () => {
    const email = emailInput.trim()
    if (!email) return
    if (email.includes('@') && !settings.recipientEmails.includes(email)) {
      onSettingsChange({ ...settings, recipientEmails: [...settings.recipientEmails, email] })
    }
    setEmailInput('')
  }

  const removeEmail = (email: string) => {
    onSettingsChange({ ...settings, recipientEmails: settings.recipientEmails.filter(e => e !== email) })
  }

  const handleEmailKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addEmail()
    }
  }

  return (
    <div className="space-y-8">
      {/* Notification Banner */}
      {notification && (
        <div className={`p-4 border-b ${notification.type === 'success' ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-red-50 text-[hsl(0,50%,45%)] border-red-200'}`}>
          <div className="flex items-center justify-between">
            <span className="tracking-wider text-sm uppercase font-light">{notification.message}</span>
            <button onClick={onDismissNotification} className="ml-4">
              <FiX className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Recipients */}
      <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
        <div className="p-6 border-b border-[hsl(30,10%,88%)]">
          <div className="flex items-center gap-2">
            <IoMdMail className="w-4 h-4 text-[hsl(40,30%,45%)]" />
            <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Recipients</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="flex gap-3 mb-4">
            <input
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              onKeyDown={handleEmailKeyDown}
              placeholder="Enter email address"
              className="flex-1 px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] placeholder:text-[hsl(30,5%,50%)] focus:outline-none focus:border-[hsl(40,30%,45%)] transition-colors tracking-wider"
            />
            <button
              onClick={addEmail}
              className="flex items-center gap-2 px-5 py-2.5 bg-[hsl(40,30%,45%)] text-white text-xs uppercase tracking-widest hover:bg-[hsl(40,30%,40%)] transition-colors"
            >
              <FiPlus className="w-3 h-3" /> Add
            </button>
          </div>
          {Array.isArray(settings.recipientEmails) && settings.recipientEmails.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {settings.recipientEmails.map((email) => (
                <span key={email} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[hsl(30,10%,95%)] border border-[hsl(30,10%,88%)] text-sm text-[hsl(30,5%,15%)] tracking-wider">
                  {email}
                  <button onClick={() => removeEmail(email)} className="text-[hsl(30,5%,50%)] hover:text-[hsl(0,50%,45%)] transition-colors">
                    <FiX className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[hsl(30,5%,50%)] tracking-wider">No recipients added yet</p>
          )}
        </div>
      </div>

      {/* Schedule */}
      <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
        <div className="p-6 border-b border-[hsl(30,10%,88%)]">
          <div className="flex items-center gap-2">
            <MdSchedule className="w-4 h-4 text-[hsl(40,30%,45%)]" />
            <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Schedule</h3>
          </div>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Frequency</label>
              <select
                value={settings.frequency}
                onChange={(e) => onSettingsChange({ ...settings, frequency: e.target.value as AlertSettings['frequency'] })}
                className="w-full px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] focus:outline-none focus:border-[hsl(40,30%,45%)] tracking-wider appearance-none cursor-pointer"
              >
                <option value="hourly">Hourly</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly (Monday)</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Time</label>
              <input
                type="time"
                value={settings.triggerTime}
                onChange={(e) => onSettingsChange({ ...settings, triggerTime: e.target.value })}
                className="w-full px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] focus:outline-none focus:border-[hsl(40,30%,45%)] tracking-wider"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Timezone</label>
              <select
                value={settings.timezone}
                onChange={(e) => onSettingsChange({ ...settings, timezone: e.target.value })}
                className="w-full px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] focus:outline-none focus:border-[hsl(40,30%,45%)] tracking-wider appearance-none cursor-pointer"
              >
                <option value="America/New_York">Eastern (ET)</option>
                <option value="America/Chicago">Central (CT)</option>
                <option value="America/Denver">Mountain (MT)</option>
                <option value="America/Los_Angeles">Pacific (PT)</option>
                <option value="Europe/London">London (GMT)</option>
                <option value="Europe/Berlin">Berlin (CET)</option>
                <option value="Asia/Tokyo">Tokyo (JST)</option>
                <option value="Asia/Kolkata">Mumbai (IST)</option>
                <option value="UTC">UTC</option>
              </select>
            </div>
          </div>
          <div className="mt-4 text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">
            Cron: <span className="font-mono text-[hsl(30,5%,15%)]">{buildCron(settings.frequency, settings.triggerTime)}</span>
            {' '} ({cronToHuman(buildCron(settings.frequency, settings.triggerTime))})
          </div>
        </div>
      </div>

      {/* Threshold */}
      <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
        <div className="p-6 border-b border-[hsl(30,10%,88%)]">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IoMdAlert className="w-4 h-4 text-[hsl(40,30%,45%)]" />
              <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Price Threshold</h3>
            </div>
            <button
              onClick={() => onSettingsChange({ ...settings, thresholdEnabled: !settings.thresholdEnabled })}
              className={`relative inline-flex h-6 w-11 items-center transition-colors ${settings.thresholdEnabled ? 'bg-[hsl(40,30%,45%)]' : 'bg-[hsl(30,10%,88%)]'}`}
            >
              <span className={`inline-block h-4 w-4 transform bg-white transition-transform shadow-sm ${settings.thresholdEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
        </div>
        {settings.thresholdEnabled && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Alert Above ($)</label>
                <input
                  type="number"
                  value={settings.thresholdAbove}
                  onChange={(e) => onSettingsChange({ ...settings, thresholdAbove: e.target.value })}
                  placeholder="2500"
                  className="w-full px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] focus:outline-none focus:border-[hsl(40,30%,45%)] tracking-wider"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Alert Below ($)</label>
                <input
                  type="number"
                  value={settings.thresholdBelow}
                  onChange={(e) => onSettingsChange({ ...settings, thresholdBelow: e.target.value })}
                  placeholder="2000"
                  className="w-full px-4 py-2.5 border border-[hsl(30,10%,88%)] bg-[hsl(0,0%,99%)] text-sm text-[hsl(30,5%,15%)] focus:outline-none focus:border-[hsl(40,30%,45%)] tracking-wider"
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-2">Unit</label>
                <div className="flex">
                  <button
                    onClick={() => onSettingsChange({ ...settings, unit: 'ounce' })}
                    className={`flex-1 px-4 py-2.5 text-xs uppercase tracking-widest border transition-colors ${settings.unit === 'ounce' ? 'bg-[hsl(40,30%,45%)] text-white border-[hsl(40,30%,45%)]' : 'bg-[hsl(0,0%,99%)] text-[hsl(30,5%,15%)] border-[hsl(30,10%,88%)]'}`}
                  >
                    Ounce
                  </button>
                  <button
                    onClick={() => onSettingsChange({ ...settings, unit: 'gram' })}
                    className={`flex-1 px-4 py-2.5 text-xs uppercase tracking-widest border border-l-0 transition-colors ${settings.unit === 'gram' ? 'bg-[hsl(40,30%,45%)] text-white border-[hsl(40,30%,45%)]' : 'bg-[hsl(0,0%,99%)] text-[hsl(30,5%,15%)] border-[hsl(30,10%,88%)]'}`}
                  >
                    Gram
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Save Button */}
      <div className="flex items-center gap-4">
        <button
          onClick={onSave}
          disabled={saving}
          className="flex items-center gap-2 px-8 py-3 bg-[hsl(40,30%,45%)] text-white text-xs uppercase tracking-widest hover:bg-[hsl(40,30%,40%)] disabled:opacity-50 transition-colors shadow-sm"
        >
          {saving ? <Spinner /> : <FiCheck className="w-3.5 h-3.5" />}
          {saving ? 'Saving...' : 'Save Configuration'}
        </button>
      </div>

      {/* Active Configuration Summary */}
      <div className="bg-[hsl(30,10%,95%)] border border-[hsl(30,10%,88%)]">
        <div className="p-6 border-b border-[hsl(30,10%,88%)]">
          <h3 className="text-xs uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Active Configuration Summary</h3>
        </div>
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Recipients</div>
              <div className="text-sm text-[hsl(30,5%,15%)]">
                {Array.isArray(settings.recipientEmails) && settings.recipientEmails.length > 0
                  ? settings.recipientEmails.join(', ')
                  : 'None configured'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Schedule</div>
              <div className="text-sm text-[hsl(30,5%,15%)]">
                {cronToHuman(buildCron(settings.frequency, settings.triggerTime))} ({settings.timezone})
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Threshold</div>
              <div className="text-sm text-[hsl(30,5%,15%)]">
                {settings.thresholdEnabled
                  ? `Above $${settings.thresholdAbove} / Below $${settings.thresholdBelow} per ${settings.unit}`
                  : 'Disabled'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] mb-1">Unit Preference</div>
              <div className="text-sm text-[hsl(30,5%,15%)] capitalize">{settings.unit}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Agent Info Section
// --------------------------------------------------------------------------

function AgentInfoSection({ activeAgentId }: { activeAgentId: string | null }) {
  const agents = [
    { id: '6997285ac4e47cc7968fd581', name: 'Gold Alert Manager', purpose: 'Orchestrates price lookup and email dispatch' },
    { id: '6997283325cb8c28e05427a8', name: 'Gold Price Research Agent', purpose: 'Fetches real-time gold market data' },
    { id: '69972845953ca8351f0efdf3', name: 'Email Alert Agent', purpose: 'Composes and sends alert emails' },
  ]

  return (
    <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
      <div className="p-4 border-b border-[hsl(30,10%,88%)]">
        <h3 className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Agents</h3>
      </div>
      <div className="divide-y divide-[hsl(30,10%,88%)]">
        {agents.map((agent) => (
          <div key={agent.id} className="px-4 py-3 flex items-center gap-3">
            <span className={`w-1.5 h-1.5 flex-shrink-0 ${activeAgentId === agent.id ? 'bg-emerald-500 animate-pulse' : 'bg-[hsl(30,10%,88%)]'}`} />
            <div className="min-w-0">
              <div className="text-xs font-normal text-[hsl(30,5%,15%)] tracking-wider">{agent.name}</div>
              <div className="text-[10px] text-[hsl(30,5%,50%)] tracking-wider truncate">{agent.purpose}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------------
// Main Page
// --------------------------------------------------------------------------

export default function Page() {
  // State
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard')
  const [settings, setSettings] = useState<AlertSettings>(DEFAULT_SETTINGS)
  const [schedule, setSchedule] = useState<Schedule | null>(null)
  const [scheduleLoading, setScheduleLoading] = useState(false)
  const [logs, setLogs] = useState<ExecutionLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [lastResult, setLastResult] = useState<AgentResult | null>(null)
  const [checkNowLoading, setCheckNowLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notification, setNotification] = useState<Notification | null>(null)
  const [sampleMode, setSampleMode] = useState(false)
  const [scheduleId, setScheduleId] = useState(INITIAL_SCHEDULE_ID)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)

  // Agent activity monitoring
  const agentActivity = useLyzrAgentEvents(sessionId)

  // Load settings + schedule on mount
  useEffect(() => {
    const loaded = loadSettings()
    setSettings(loaded)
    const storedScheduleId = loadScheduleId()
    setScheduleId(storedScheduleId)
  }, [])

  // Fetch schedule data
  const fetchScheduleData = useCallback(async () => {
    setScheduleLoading(true)
    try {
      const res = await getSchedule(scheduleId)
      if (res.success && res.schedule) {
        setSchedule(res.schedule)
      }
    } catch {
      // Silently fail - schedule may not exist yet
    }
    setScheduleLoading(false)
  }, [scheduleId])

  const fetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const res = await getScheduleLogs(scheduleId, { limit: 20 })
      if (res.success && Array.isArray(res.executions)) {
        setLogs(res.executions)
      }
    } catch {
      // Silently fail
    }
    setLogsLoading(false)
  }, [scheduleId])

  useEffect(() => {
    fetchScheduleData()
    fetchLogs()
  }, [fetchScheduleData, fetchLogs])

  // Dismiss notification after 5 seconds
  useEffect(() => {
    if (notification) {
      const timer = setTimeout(() => setNotification(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [notification])

  // Toggle schedule active/paused
  const handleToggleSchedule = async () => {
    if (!schedule) return
    setScheduleLoading(true)
    try {
      if (schedule.is_active) {
        await pauseSchedule(scheduleId)
      } else {
        await resumeSchedule(scheduleId)
      }
      // Always refresh schedule list to sync UI
      const res = await getSchedule(scheduleId)
      if (res.success && res.schedule) {
        setSchedule(res.schedule)
      }
      setNotification({ type: 'success', message: schedule.is_active ? 'Schedule paused' : 'Schedule resumed' })
    } catch {
      setNotification({ type: 'error', message: 'Failed to update schedule status' })
    }
    setScheduleLoading(false)
  }

  // Check Now
  const handleCheckNow = async () => {
    setCheckNowLoading(true)
    setActiveAgentId(MANAGER_AGENT_ID)
    agentActivity.setProcessing(true)

    try {
      const message = composeAgentMessage(settings)
      const result = await callAIAgent(message, MANAGER_AGENT_ID)

      if (result?.session_id) {
        setSessionId(result.session_id)
      }

      if (result?.success) {
        const parsed = parseAgentResult(result?.response?.result)
        if (parsed) {
          setLastResult(parsed)
          setNotification({ type: 'success', message: 'Gold price check completed successfully' })
        } else {
          setNotification({ type: 'success', message: 'Agent responded. Check results below.' })
        }
      } else {
        setNotification({ type: 'error', message: result?.error ?? 'Failed to check gold price' })
      }
    } catch {
      setNotification({ type: 'error', message: 'Network error while checking gold price' })
    }

    setCheckNowLoading(false)
    setActiveAgentId(null)
    agentActivity.setProcessing(false)
  }

  // Save settings
  const handleSaveSettings = async () => {
    setSaving(true)
    try {
      // Save to localStorage
      saveSettings(settings)

      // Build new cron
      const newCron = buildCron(settings.frequency, settings.triggerTime)
      const message = composeAgentMessage(settings)

      // Delete old schedule and create new one
      try {
        await deleteSchedule(scheduleId)
      } catch {
        // If delete fails (schedule doesn't exist), continue
      }

      const createRes = await createSchedule({
        agent_id: MANAGER_AGENT_ID,
        cron_expression: newCron,
        message,
        timezone: settings.timezone,
      })

      if (createRes.success && createRes.schedule) {
        const newId = createRes.schedule.id
        setScheduleId(newId)
        saveScheduleId(newId)
        setSchedule(createRes.schedule)
        setNotification({ type: 'success', message: 'Configuration saved and schedule updated' })
      } else {
        setNotification({ type: 'error', message: createRes.error ?? 'Failed to update schedule' })
      }
    } catch {
      setNotification({ type: 'error', message: 'Error saving configuration' })
    }
    setSaving(false)
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[hsl(0,0%,99%)] text-[hsl(30,5%,15%)]">
        {/* Header */}
        <header className="border-b border-[hsl(30,10%,88%)] bg-white">
          <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <RiCoinsFill className="w-7 h-7 text-[hsl(40,30%,45%)]" />
              <div>
                <h1 className="text-xl font-normal tracking-widest uppercase text-[hsl(30,5%,15%)]">Gold Price Alerts</h1>
                <p className="text-[10px] tracking-widest uppercase text-[hsl(30,5%,50%)] mt-0.5">Automated Market Monitoring</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {/* Sample Data Toggle */}
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">Sample Data</span>
                <button
                  onClick={() => setSampleMode(!sampleMode)}
                  className={`relative inline-flex h-5 w-9 items-center transition-colors ${sampleMode ? 'bg-[hsl(40,30%,45%)]' : 'bg-[hsl(30,10%,88%)]'}`}
                >
                  <span className={`inline-block h-3 w-3 transform bg-white transition-transform shadow-sm ${sampleMode ? 'translate-x-5' : 'translate-x-1'}`} />
                </button>
              </label>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="max-w-6xl mx-auto px-6">
            <nav className="flex gap-8">
              <button
                onClick={() => setActiveTab('dashboard')}
                className={`flex items-center gap-2 pb-4 text-xs uppercase tracking-widest transition-colors border-b-2 ${activeTab === 'dashboard' ? 'border-[hsl(40,30%,45%)] text-[hsl(40,30%,45%)]' : 'border-transparent text-[hsl(30,5%,50%)] hover:text-[hsl(30,5%,15%)]'}`}
              >
                <MdDashboard className="w-4 h-4" />
                Dashboard
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`flex items-center gap-2 pb-4 text-xs uppercase tracking-widest transition-colors border-b-2 ${activeTab === 'settings' ? 'border-[hsl(40,30%,45%)] text-[hsl(40,30%,45%)]' : 'border-transparent text-[hsl(30,5%,50%)] hover:text-[hsl(30,5%,15%)]'}`}
              >
                <IoMdSettings className="w-4 h-4" />
                Settings
              </button>
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-6xl mx-auto px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
            {/* Primary Content */}
            <div className="lg:col-span-3">
              {activeTab === 'dashboard' ? (
                <DashboardTab
                  schedule={schedule}
                  scheduleLoading={scheduleLoading}
                  logs={logs}
                  logsLoading={logsLoading}
                  lastResult={lastResult}
                  checkNowLoading={checkNowLoading}
                  onCheckNow={handleCheckNow}
                  onToggleSchedule={handleToggleSchedule}
                  onRefreshLogs={fetchLogs}
                  sampleMode={sampleMode}
                  notification={notification}
                  onDismissNotification={() => setNotification(null)}
                />
              ) : (
                <SettingsTab
                  settings={settings}
                  onSettingsChange={setSettings}
                  onSave={handleSaveSettings}
                  saving={saving}
                  notification={notification}
                  onDismissNotification={() => setNotification(null)}
                />
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Schedule Card */}
              <div className="bg-white border border-[hsl(30,10%,88%)] shadow-sm">
                <div className="p-4 border-b border-[hsl(30,10%,88%)]">
                  <h3 className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] font-normal">Schedule</h3>
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">Status</span>
                    <StatusBadge active={schedule?.is_active ?? false} />
                  </div>
                  {schedule?.cron_expression && (
                    <div>
                      <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] block mb-1">Frequency</span>
                      <span className="text-xs text-[hsl(30,5%,15%)] tracking-wider">{cronToHuman(schedule.cron_expression)}</span>
                    </div>
                  )}
                  {schedule?.next_run_time && (
                    <div>
                      <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] block mb-1">Next Run</span>
                      <span className="text-xs text-[hsl(30,5%,15%)] tracking-wider">{formatTs(schedule.next_run_time)}</span>
                    </div>
                  )}
                  {schedule?.last_run_at && (
                    <div>
                      <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)] block mb-1">Last Run</span>
                      <span className="text-xs text-[hsl(30,5%,15%)] tracking-wider">{formatTs(schedule.last_run_at)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Agent Info */}
              <AgentInfoSection activeAgentId={activeAgentId} />

              {/* Agent Activity Panel */}
              <AgentActivityPanel
                isConnected={agentActivity.isConnected}
                events={agentActivity.events}
                thinkingEvents={agentActivity.thinkingEvents}
                lastThinkingMessage={agentActivity.lastThinkingMessage}
                activeAgentId={agentActivity.activeAgentId}
                activeAgentName={agentActivity.activeAgentName}
                isProcessing={agentActivity.isProcessing}
              />
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t border-[hsl(30,10%,88%)] bg-white mt-12">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">Gold Price Alert System</span>
            <span className="text-[10px] uppercase tracking-widest text-[hsl(30,5%,50%)]">Powered by Lyzr</span>
          </div>
        </footer>
      </div>
    </ErrorBoundary>
  )
}
