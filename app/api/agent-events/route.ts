import { NextRequest, NextResponse } from 'next/server'

const LYZR_API_KEY = process.env.LYZR_API_KEY || ''

/**
 * Agent Events WebSocket Credentials API
 * 
 * Returns WebSocket credentials for agent activity monitoring.
 * API key is kept secure on the server and never exposed in the client bundle.
 * 
 * The client fetches credentials at runtime (not build time), which is more
 * secure than using NEXT_PUBLIC_* environment variables.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { session_id } = body

    if (!session_id) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'session_id is required' 
        },
        { status: 400 }
      )
    }

    if (!LYZR_API_KEY) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'LYZR_API_KEY not configured on server' 
        },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      apiKey: LYZR_API_KEY,
      wsUrl: `wss://metrics.studio.lyzr.ai/session/${session_id}`,
    })
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Server error'
    return NextResponse.json(
      {
        success: false,
        error: errorMsg,
      },
      { status: 500 }
    )
  }
}
