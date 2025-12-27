// API Key authentication utilities

import type { Request } from 'express'

const API_KEY = process.env.BAB_API_KEY

// Constant-time string comparison to prevent timing attacks
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do the comparison to maintain constant time
    let result = 0
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0)
    }
    return false
  }

  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

export interface AuthResult {
  authenticated: boolean
  error?: string
}

export function validateAuth(req: Request): AuthResult {
  // If no API key is configured, allow all requests
  if (!API_KEY) {
    return { authenticated: true }
  }

  const providedKey = req.headers['x-api-key']

  if (!providedKey) {
    return {
      authenticated: false,
      error: 'Invalid or missing API key',
    }
  }

  // Handle array case (shouldn't happen but TypeScript)
  const keyString = Array.isArray(providedKey) ? providedKey[0] : providedKey

  if (!constantTimeCompare(keyString, API_KEY)) {
    return {
      authenticated: false,
      error: 'Invalid or missing API key',
    }
  }

  return { authenticated: true }
}
