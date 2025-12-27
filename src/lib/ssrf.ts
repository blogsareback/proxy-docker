// SSRF Protection - validates URLs to prevent Server-Side Request Forgery

import { ErrorCodes } from './config.js'

// Private IPv4 ranges
const PRIVATE_IPV4_RANGES = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./, // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8 (loopback)
  /^169\.254\./,                    // 169.254.0.0/16 (link-local)
  /^0\./,                           // 0.0.0.0/8
]

// Blocked hostnames
const BLOCKED_HOSTNAMES = [
  'localhost',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
  'metadata.azure.com',
  '[::1]', // IPv6 loopback
]

// Blocked hostname patterns
const BLOCKED_HOSTNAME_PATTERNS = [
  /\.local$/i,
  /\.internal$/i,
  /\.localhost$/i,
]

export interface UrlValidationResult {
  valid: boolean
  error?: {
    code: string
    message: string
  }
  url?: URL
}

function isPrivateIPv4(ip: string): boolean {
  return PRIVATE_IPV4_RANGES.some((pattern) => pattern.test(ip))
}

function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase()
  // ::1 loopback
  if (normalized === '::1' || normalized === '[::1]') return true
  // fc00::/7 (unique local)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true
  // fe80::/10 (link-local)
  if (normalized.startsWith('fe80')) return true
  return false
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase()

  // Direct match
  if (BLOCKED_HOSTNAMES.includes(lower)) return true

  // Pattern match
  if (BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(lower))) return true

  return false
}

function looksLikeIP(hostname: string): boolean {
  // IPv4
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  // IPv6 (with or without brackets)
  if (hostname.includes(':') || hostname.startsWith('[')) return true
  return false
}

export function validateUrl(urlString: string): UrlValidationResult {
  // Parse the URL
  let url: URL
  try {
    url = new URL(urlString)
  } catch {
    return {
      valid: false,
      error: {
        code: ErrorCodes.INVALID_URL,
        message: 'URL is malformed',
      },
    }
  }

  // Protocol check
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return {
      valid: false,
      error: {
        code: ErrorCodes.INVALID_URL,
        message: 'URL must use HTTP or HTTPS protocol',
      },
    }
  }

  const hostname = url.hostname.toLowerCase()

  // Check blocked hostnames
  if (isBlockedHostname(hostname)) {
    return {
      valid: false,
      error: {
        code: ErrorCodes.BLOCKED_URL,
        message: 'URL points to a blocked host',
      },
    }
  }

  // If hostname looks like an IP, validate it
  if (looksLikeIP(hostname)) {
    const cleanIP = hostname.replace(/^\[|\]$/g, '') // Remove IPv6 brackets

    if (isPrivateIPv4(cleanIP)) {
      return {
        valid: false,
        error: {
          code: ErrorCodes.BLOCKED_URL,
          message: 'URL points to a private IP address',
        },
      }
    }

    if (isPrivateIPv6(cleanIP)) {
      return {
        valid: false,
        error: {
          code: ErrorCodes.BLOCKED_URL,
          message: 'URL points to a private IPv6 address',
        },
      }
    }
  }

  return { valid: true, url }
}
