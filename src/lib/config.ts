// Configuration constants for the proxy

export const VERSION = '2.0.0'
export const PROVIDER = 'node-docker'

// Size limits in bytes
export const MAX_RESPONSE_SIZE = parseInt(process.env.MAX_RESPONSE_SIZE_MB || '10', 10) * 1024 * 1024
export const MAX_HTML_SIZE = parseInt(process.env.MAX_HTML_SIZE_MB || '5', 10) * 1024 * 1024
export const MAX_REQUEST_BODY = 64 * 1024 // 64 KB

// Timeout limits in milliseconds
export const DEFAULT_FETCH_TIMEOUT = parseInt(process.env.DEFAULT_TIMEOUT_MS || '10000', 10)
export const DEFAULT_PARSE_TIMEOUT = 15000
export const DEFAULT_DISCOVER_TIMEOUT = 20000
export const MAX_TIMEOUT = parseInt(process.env.MAX_TIMEOUT_MS || '30000', 10)
export const MAX_DISCOVER_TIMEOUT = 45000

// Server port
export const PORT = parseInt(process.env.PORT || '3000', 10)

// Error codes matching the API spec
export const ErrorCodes = {
  INVALID_URL: 'INVALID_URL',
  BLOCKED_URL: 'BLOCKED_URL',
  FETCH_FAILED: 'FETCH_FAILED',
  TIMEOUT: 'TIMEOUT',
  CONTENT_TOO_LARGE: 'CONTENT_TOO_LARGE',
  PARSE_FAILED: 'PARSE_FAILED',
  UNSUPPORTED: 'UNSUPPORTED',
  DISCOVERY_FAILED: 'DISCOVERY_FAILED',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

// Headers to extract from fetch responses
export const HEADERS_TO_EXTRACT = [
  'content-type',
  'etag',
  'last-modified',
  'cache-control',
  'content-length',
]

// Headers that can be forwarded from client requests
export const ALLOWED_FORWARD_HEADERS = ['if-none-match', 'if-modified-since']

// Common feed paths to probe when no feeds found in HTML
export const COMMON_FEED_PATHS = [
  '/feed',
  '/rss',
  '/atom.xml',
  '/feed.xml',
  '/rss.xml',
  '/index.xml',
  '/feeds/posts/default',
  '/blog/feed',
  '/feed/rss',
  '/feed/atom',
]
