// CORS utilities for handling cross-origin requests

import type { Request, Response, NextFunction } from 'express'

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS || '*'

export function getCorsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Access-Control-Max-Age': '86400',
  }
}

export function setCorsHeaders(res: Response): void {
  const headers = getCorsHeaders()
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value)
  }
}

// Express middleware for CORS
export function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  setCorsHeaders(res)

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }

  next()
}
