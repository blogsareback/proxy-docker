// POST /parse - Extract article content using Mozilla Readability
// Fetches a URL and returns cleaned, readable content

import type { Request, Response } from 'express'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'
import {
  DEFAULT_PARSE_TIMEOUT,
  MAX_TIMEOUT,
  MAX_HTML_SIZE,
  ErrorCodes,
} from '../lib/config.js'
import { validateAuth } from '../lib/auth.js'
import { validateUrl } from '../lib/ssrf.js'
import { sanitizeHtml, resolveUrl } from '../lib/sanitize.js'

interface ParseRequest {
  url: string
  format?: 'html' | 'text' | 'both'
  timeout?: number
}

interface ParseSuccessResponse {
  success: true
  title: string | null
  byline: string | null
  siteName: string | null
  excerpt: string | null
  length: number
  htmlContent?: string // Preferred field name (matches extension)
  content?: string // Alias for backwards compatibility
  textContent?: string
  image: string | null
}

interface ParseErrorResponse {
  success: false
  error: {
    code: string
    message: string
  }
}

// Type for linkedom document
type LinkedomDocument = {
  querySelector: (selector: string) => Element | null
  querySelectorAll: (selector: string) => ArrayLike<Element>
}

function extractOgImage(document: LinkedomDocument, baseUrl: string): string | null {
  // Try og:image first
  const ogImage = document.querySelector('meta[property="og:image"]')
  if (ogImage) {
    const content = ogImage.getAttribute('content')
    if (content) return resolveUrl(content, baseUrl)
  }

  // Try twitter:image
  const twitterImage = document.querySelector('meta[name="twitter:image"]')
  if (twitterImage) {
    const content = twitterImage.getAttribute('content')
    if (content) return resolveUrl(content, baseUrl)
  }

  // Try first article image
  const articleImage = document.querySelector('article img[src]')
  if (articleImage) {
    const src = articleImage.getAttribute('src')
    if (src) return resolveUrl(src, baseUrl)
  }

  return null
}

function extractSiteName(document: LinkedomDocument): string | null {
  // Try og:site_name
  const ogSiteName = document.querySelector('meta[property="og:site_name"]')
  if (ogSiteName) {
    const content = ogSiteName.getAttribute('content')
    if (content) return content
  }

  // Try application-name
  const appName = document.querySelector('meta[name="application-name"]')
  if (appName) {
    const content = appName.getAttribute('content')
    if (content) return content
  }

  return null
}

export async function handleParse(
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
  const body = req.body as ParseRequest

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
    } as ParseErrorResponse)
    return
  }

  // Determine format
  const format = body.format || 'both'
  if (!['html', 'text', 'both'].includes(format)) {
    res.status(400).json({
      success: false,
      error: {
        code: ErrorCodes.INVALID_URL,
        message: 'Invalid format: must be "html", "text", or "both"',
      },
    })
    return
  }

  // Calculate timeout
  const timeout = Math.min(body.timeout || DEFAULT_PARSE_TIMEOUT, MAX_TIMEOUT)

  // Fetch the page
  let html: string
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(body.url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; BlogsAreBack/1.0; +https://blogsareback.com)',
        Accept: 'text/html, application/xhtml+xml, */*',
      },
      signal: controller.signal,
      redirect: 'follow',
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      res.status(200).json({
        success: false,
        error: {
          code: ErrorCodes.FETCH_FAILED,
          message: `HTTP ${response.status}: ${response.statusText}`,
        },
      } as ParseErrorResponse)
      return
    }

    // Check content length
    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_HTML_SIZE) {
      res.status(200).json({
        success: false,
        error: {
          code: ErrorCodes.CONTENT_TOO_LARGE,
          message: `HTML exceeds maximum size of ${MAX_HTML_SIZE / 1024 / 1024}MB`,
        },
      } as ParseErrorResponse)
      return
    }

    const arrayBuffer = await response.arrayBuffer()
    if (arrayBuffer.byteLength > MAX_HTML_SIZE) {
      res.status(200).json({
        success: false,
        error: {
          code: ErrorCodes.CONTENT_TOO_LARGE,
          message: `HTML exceeds maximum size of ${MAX_HTML_SIZE / 1024 / 1024}MB`,
        },
      } as ParseErrorResponse)
      return
    }

    html = new TextDecoder().decode(arrayBuffer)
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
      },
    } as ParseErrorResponse)
    return
  }

  // Parse HTML with linkedom
  let doc: LinkedomDocument
  try {
    const result = parseHTML(html)
    doc = result.document as unknown as LinkedomDocument
  } catch (error) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.PARSE_FAILED,
        message:
          error instanceof Error ? error.message : 'Failed to parse HTML',
      },
    } as ParseErrorResponse)
    return
  }

  // Extract metadata before Readability modifies the document
  const image = extractOgImage(doc, body.url)
  const siteName = extractSiteName(doc)

  // Run Readability
  let article: ReturnType<Readability<string>['parse']>
  try {
    const reader = new Readability(doc as unknown as Document, {
      charThreshold: 0, // Don't skip short articles
    })
    article = reader.parse()
  } catch (error) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.PARSE_FAILED,
        message:
          error instanceof Error
            ? error.message
            : 'Readability failed to parse content',
      },
    } as ParseErrorResponse)
    return
  }

  if (!article) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.PARSE_FAILED,
        message: 'Could not extract article content',
      },
    } as ParseErrorResponse)
    return
  }

  // Build response based on format
  const response: ParseSuccessResponse = {
    success: true,
    title: article.title || null,
    byline: article.byline || null,
    siteName: article.siteName || siteName,
    excerpt: article.excerpt || null,
    length: article.length || 0,
    image,
  }

  if (format === 'html' || format === 'both') {
    // Sanitize HTML: strip dangerous elements/attributes, resolve relative URLs
    const sanitizedHtml = sanitizeHtml(article.content || '', body.url)
    response.htmlContent = sanitizedHtml // Preferred field name (matches extension)
    response.content = sanitizedHtml // Alias for backwards compatibility
  }

  if (format === 'text' || format === 'both') {
    response.textContent = article.textContent || ''
  }

  res.status(200).json(response)
}
