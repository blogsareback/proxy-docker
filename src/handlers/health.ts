// GET /health - Health check endpoint
// Returns proxy status and capabilities

import type { Request, Response } from 'express'
import { VERSION, PROVIDER } from '../lib/config.js'
import { validateAuth } from '../lib/auth.js'

export function handleHealth(req: Request, res: Response): void {
  // Only allow GET
  if (req.method !== 'GET') {
    res.status(405).json({
      ok: false,
      error: 'Method not allowed',
    })
    return
  }

  // Validate API key if configured
  const auth = validateAuth(req)
  if (!auth.authenticated) {
    res.status(401).json({
      ok: false,
      error: auth.error,
    })
    return
  }

  // Return health status with capabilities
  res.status(200).json({
    ok: true,
    version: VERSION,
    provider: PROVIDER,
    capabilities: ['fetch', 'parse', 'discover'],
  })
}
