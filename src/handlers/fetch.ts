// POST /fetch - Fetch RSS/Atom feed with CORS bypass
// Supports conditional GET via If-None-Match and If-Modified-Since headers

import type { Request, Response } from 'express'
import {
  DEFAULT_FETCH_TIMEOUT,
  MAX_TIMEOUT,
  MAX_RESPONSE_SIZE,
  HEADERS_TO_EXTRACT,
  ALLOWED_FORWARD_HEADERS,
  ErrorCodes,
} from '../lib/config.js'
import { validateAuth } from '../lib/auth.js'
import { validateUrl } from '../lib/ssrf.js'

interface FetchRequest {
  url: string
  headers?: Record<string, string>
  timeout?: number
}

interface FetchSuccessResponse {
  success: true
  status: number
  headers: Record<string, string>
  body: string | null
}

interface FetchErrorResponse {
  success: false
  error: {
    code: string
    message: string
    status?: number | null
  }
}

type FetchResponse = FetchSuccessResponse | FetchErrorResponse

function extractHeaders(
  responseHeaders: Headers,
  headersToExtract: string[]
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const header of headersToExtract) {
    const value = responseHeaders.get(header)
    if (value !== null) {
      result[header] = value
    }
  }
  return result
}

function filterForwardHeaders(
  clientHeaders: Record<string, string> | undefined
): Record<string, string> {
  if (!clientHeaders) return {}

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(clientHeaders)) {
    if (ALLOWED_FORWARD_HEADERS.includes(key.toLowerCase())) {
      result[key] = value
    }
  }
  return result
}

export async function handleFetch(
  req: Request,
  res: Response
): Promise<void> {
  // Only allow POST
  if (req.method !== 'POST') {
    res.status(405).json({
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed',
      },
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

  // Parse request body
  const body = req.body as FetchRequest

  // Validate required fields
  if (!body.url || typeof body.url !== 'string') {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.INVALID_URL,
        message: 'Missing required field: url',
      },
    })
    return
  }

  // Validate URL for SSRF
  const urlValidation = validateUrl(body.url)
  if (!urlValidation.valid) {
    res.status(200).json({
      success: false,
      error: urlValidation.error,
    } as FetchErrorResponse)
    return
  }

  // Calculate timeout
  const timeout = Math.min(body.timeout || DEFAULT_FETCH_TIMEOUT, MAX_TIMEOUT)

  // Build request headers
  const forwardHeaders = filterForwardHeaders(body.headers)
  const requestHeaders: HeadersInit = {
    'User-Agent': 'BlogsAreBack/1.0 (CORS Proxy)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
    ...forwardHeaders,
  }

  // Fetch the feed
  let response: globalThis.Response
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    response = await fetch(body.url, {
      method: 'GET',
      headers: requestHeaders,
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeoutId)
  } catch (error) {
    const isTimeout =
      error instanceof Error &&
      (error.name === 'AbortError' || error.message.includes('timeout'))

    res.status(200).json({
      success: false,
      error: {
        code: isTimeout ? ErrorCodes.TIMEOUT : ErrorCodes.FETCH_FAILED,
        message: isTimeout
          ? 'Request timed out'
          : error instanceof Error
            ? error.message
            : 'Network error during fetch',
        status: null,
      },
    } as FetchErrorResponse)
    return
  }

  // Handle 304 Not Modified
  if (response.status === 304) {
    const responseData: FetchSuccessResponse = {
      success: true,
      status: 304,
      headers: extractHeaders(response.headers, HEADERS_TO_EXTRACT),
      body: null,
    }
    res.status(200).json(responseData)
    return
  }

  // Check content length before reading body
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.CONTENT_TOO_LARGE,
        message: `Response exceeds maximum size of ${MAX_RESPONSE_SIZE / 1024 / 1024}MB`,
        status: response.status,
      },
    } as FetchErrorResponse)
    return
  }

  // Read response body with size limit
  let responseBody: string
  try {
    const arrayBuffer = await response.arrayBuffer()

    if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
      res.status(200).json({
        success: false,
        error: {
          code: ErrorCodes.CONTENT_TOO_LARGE,
          message: `Response exceeds maximum size of ${MAX_RESPONSE_SIZE / 1024 / 1024}MB`,
          status: response.status,
        },
      } as FetchErrorResponse)
      return
    }

    responseBody = new TextDecoder().decode(arrayBuffer)
  } catch (error) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.FETCH_FAILED,
        message:
          error instanceof Error ? error.message : 'Failed to read response body',
        status: response.status,
      },
    } as FetchErrorResponse)
    return
  }

  // Return successful response
  const responseData: FetchSuccessResponse = {
    success: true,
    status: response.status,
    headers: extractHeaders(response.headers, HEADERS_TO_EXTRACT),
    body: responseBody,
  }

  res.status(200).json(responseData)
}
