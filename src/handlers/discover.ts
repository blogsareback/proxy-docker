// POST /discover - Discover RSS/Atom feeds from a URL and extract blog metadata
// Consolidates blog discovery, feed parsing, and metadata extraction into a single request

import type { Request, Response } from 'express'
import Parser from 'rss-parser'
import { parseHTML } from 'linkedom'
import {
  DEFAULT_DISCOVER_TIMEOUT,
  MAX_DISCOVER_TIMEOUT,
  MAX_HTML_SIZE,
  COMMON_FEED_PATHS,
  ErrorCodes,
} from '../lib/config.js'
import { validateAuth } from '../lib/auth.js'
import { validateUrl } from '../lib/ssrf.js'
import { resolveUrl } from '../lib/sanitize.js'

// ============================================================================
// Types
// ============================================================================

interface DiscoverRequest {
  url: string
  timeout?: number
}

interface FeedInfo {
  url: string
  title: string | null
  type: 'rss' | 'atom' | 'unknown'
}

interface FeedMetadata {
  title: string
  description: string | null
  link: string
  language: string | null
  last_build_date: string | null
}

interface Images {
  site_icon: string | null
  og_image: string | null
}

interface ContentAnalysis {
  has_full_content: boolean
  average_content_length: number
  sample_size: number
}

interface RecentPost {
  title: string
  link: string
  pub_date: string | null
}

interface PlatformSuggestion {
  platform: string
  url: string
  label: string
}

interface DiscoverSuccessResponse {
  success: true
  input_type: 'homepage' | 'article' | 'feed' | 'username'
  normalized_url: string
  feeds: FeedInfo[]
  recommended_feed: string | null
  metadata: FeedMetadata | null
  images: Images
  content_analysis: ContentAnalysis | null
  recent_posts: RecentPost[] | null
  message?: string
}

interface DiscoverPlatformHintResponse {
  success: true
  platform_hint: true
  input: string
  suggestions: PlatformSuggestion[]
}

interface DiscoverErrorResponse {
  success: false
  error: {
    code: string
    message: string
    details?: string
  }
}

type DiscoverResponse = DiscoverSuccessResponse | DiscoverPlatformHintResponse | DiscoverErrorResponse

// ============================================================================
// Helper Functions
// ============================================================================

// Type for linkedom document
type LinkedomDocument = {
  querySelector: (selector: string) => Element | null
  querySelectorAll: (selector: string) => ArrayLike<Element>
}

/**
 * Detect if input looks like a username (no dots, no protocol)
 */
function isUsernameInput(input: string): boolean {
  // Username: alphanumeric + hyphens/underscores, no dots, no protocol
  return /^@?[a-zA-Z0-9_-]+$/.test(input) && !input.includes('.')
}

/**
 * Normalize URL: add https:// if no protocol
 */
function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed
  }
  return `https://${trimmed}`
}

/**
 * Detect input type based on URL patterns
 */
function detectInputType(url: URL): 'homepage' | 'article' | 'feed' {
  const path = url.pathname.toLowerCase()

  // Feed URL patterns
  if (
    path.endsWith('.xml') ||
    path.endsWith('.rss') ||
    path.endsWith('.atom') ||
    path.includes('/feed') ||
    path.includes('/rss') ||
    path.includes('/atom')
  ) {
    return 'feed'
  }

  // Article URL patterns
  if (
    path.match(/\/\d{4}\//) || // /2024/
    path.includes('/post/') ||
    path.includes('/posts/') ||
    path.includes('/article/') ||
    path.includes('/articles/') ||
    path.includes('/blog/') && path.split('/').length > 3
  ) {
    return 'article'
  }

  return 'homepage'
}

/**
 * Extract homepage URL from article URL
 */
function extractHomepageUrl(url: URL): string {
  // Try to find common article path patterns and strip them
  const path = url.pathname

  // Match patterns like /YYYY/MM/DD/slug, /post/slug, /posts/slug
  const articlePatterns = [
    /^(.*?)\/\d{4}\/\d{2}\/.*$/,
    /^(.*?)\/\d{4}\/.*$/,
    /^(.*?)\/posts?\/.*$/,
    /^(.*?)\/articles?\/.*$/,
    /^(.*?)\/blog\/[^/]+$/,
  ]

  for (const pattern of articlePatterns) {
    const match = path.match(pattern)
    if (match) {
      const basePath = match[1] || ''
      return `${url.origin}${basePath || '/'}`
    }
  }

  return url.origin
}

/**
 * Fetch with timeout
 */
async function fetchWithTimeout(
  url: string,
  timeout: number,
  options: RequestInit = {}
): Promise<globalThis.Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      redirect: 'follow',
    })
    return response
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Discover feeds from HTML link tags
 */
function discoverFeedsFromHtml(document: LinkedomDocument, baseUrl: string): FeedInfo[] {
  const feeds: FeedInfo[] = []

  // Look for <link rel="alternate" type="application/rss+xml|application/atom+xml">
  const linkElements = Array.from(document.querySelectorAll('link[rel="alternate"]')) as Element[]

  for (const link of linkElements) {
    const type = link.getAttribute('type')?.toLowerCase()
    const href = link.getAttribute('href')
    const title = link.getAttribute('title')

    if (!href) continue

    let feedType: 'rss' | 'atom' | 'unknown' = 'unknown'
    if (type?.includes('rss')) {
      feedType = 'rss'
    } else if (type?.includes('atom')) {
      feedType = 'atom'
    } else if (!type?.includes('rss') && !type?.includes('atom')) {
      // Skip non-feed alternate links (e.g., canonical, alternate language)
      continue
    }

    const absoluteUrl = resolveUrl(href, baseUrl)
    feeds.push({
      url: absoluteUrl,
      title: title || null,
      type: feedType,
    })
  }

  return feeds
}

/**
 * Extract favicon from HTML
 */
function extractFavicon(document: LinkedomDocument, baseUrl: string): string | null {
  // Try various favicon selectors in order of preference
  const selectors = [
    'link[rel="icon"][type="image/png"]',
    'link[rel="apple-touch-icon"]',
    'link[rel="icon"]',
    'link[rel="shortcut icon"]',
  ]

  for (const selector of selectors) {
    const link = document.querySelector(selector)
    if (link) {
      const href = link.getAttribute('href')
      if (href) {
        return resolveUrl(href, baseUrl)
      }
    }
  }

  // Default to /favicon.ico
  try {
    const url = new URL(baseUrl)
    return `${url.origin}/favicon.ico`
  } catch {
    return null
  }
}

/**
 * Extract og:image from HTML
 */
function extractOgImage(document: LinkedomDocument, baseUrl: string): string | null {
  const ogImage = document.querySelector('meta[property="og:image"]')
  if (ogImage) {
    const content = ogImage.getAttribute('content')
    if (content) return resolveUrl(content, baseUrl)
  }

  const twitterImage = document.querySelector('meta[name="twitter:image"]')
  if (twitterImage) {
    const content = twitterImage.getAttribute('content')
    if (content) return resolveUrl(content, baseUrl)
  }

  return null
}

/**
 * Probe common feed paths to find feeds
 */
async function probeFeedPaths(
  origin: string,
  timeout: number
): Promise<FeedInfo[]> {
  const feeds: FeedInfo[] = []

  // Probe in batches of 3 for better performance
  const batchSize = 3
  for (let i = 0; i < COMMON_FEED_PATHS.length; i += batchSize) {
    const batch = COMMON_FEED_PATHS.slice(i, i + batchSize)

    const results = await Promise.allSettled(
      batch.map(async (path) => {
        const url = `${origin}${path}`

        // Validate URL before fetching
        const validation = validateUrl(url)
        if (!validation.valid) return null

        try {
          const response = await fetchWithTimeout(url, timeout, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'BlogsAreBack/1.0 (Feed Discovery)',
              Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
            },
          })

          if (response.ok) {
            const contentType = response.headers.get('content-type') || ''
            if (
              contentType.includes('xml') ||
              contentType.includes('rss') ||
              contentType.includes('atom')
            ) {
              return {
                url,
                title: null,
                type: contentType.includes('atom') ? 'atom' as const : 'rss' as const,
              }
            }
          }
        } catch {
          // Ignore errors during probing
        }
        return null
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        feeds.push(result.value)
      }
    }

    // Early exit if we found a feed
    if (feeds.length > 0) break
  }

  return feeds
}

/**
 * Parse RSS/Atom feed and extract metadata
 */
async function parseFeed(
  feedUrl: string,
  timeout: number
): Promise<{
  metadata: FeedMetadata
  posts: RecentPost[]
  contentAnalysis: ContentAnalysis
} | null> {
  try {
    const parser = new Parser({
      timeout,
      headers: {
        'User-Agent': 'BlogsAreBack/1.0 (Feed Parser)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    })

    const feed = await parser.parseURL(feedUrl)

    // Extract metadata
    const metadata: FeedMetadata = {
      title: feed.title || 'Untitled',
      description: feed.description || null,
      link: feed.link || feedUrl,
      language: feed.language || null,
      last_build_date: feed.lastBuildDate || null,
    }

    // Extract recent posts (up to 3)
    const posts: RecentPost[] = (feed.items || []).slice(0, 3).map((item) => ({
      title: item.title || 'Untitled',
      link: item.link || '',
      pub_date: item.pubDate || item.isoDate || null,
    }))

    // Analyze content for full content detection
    const contentAnalysis = analyzeFullContent(feed.items || [])

    return { metadata, posts, contentAnalysis }
  } catch {
    return null
  }
}

/**
 * Analyze if feed includes full post content
 */
function analyzeFullContent(
  items: Parser.Item[],
  sampleSize = 5
): ContentAnalysis {
  const sample = items.slice(0, sampleSize)

  let fullContentCount = 0
  let totalContentLength = 0

  for (const item of sample) {
    // Access content:encoded via bracket notation with type assertion
    const itemAny = item as Record<string, unknown>
    const contentEncoded = (itemAny['content:encoded'] as string) || ''
    const contentLength = (item.content || contentEncoded || '').length
    const descriptionLength = (item.contentSnippet || item.summary || '').length

    totalContentLength += contentLength

    // Full content indicators:
    // 1. Content > 500 characters
    // 2. Content > 1.5x description length
    const hasSubstantialContent = contentLength > 500
    const contentLongerThanDesc = contentLength > descriptionLength * 1.5

    if (hasSubstantialContent && contentLongerThanDesc) {
      fullContentCount++
    }
  }

  return {
    has_full_content: sample.length > 0 ? fullContentCount / sample.length >= 0.6 : false,
    average_content_length: sample.length > 0 ? Math.round(totalContentLength / sample.length) : 0,
    sample_size: sample.length,
  }
}

/**
 * Validate if URL is a valid feed
 */
async function validateFeedUrl(url: string, timeout: number): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, timeout, {
      method: 'GET',
      headers: {
        'User-Agent': 'BlogsAreBack/1.0 (Feed Validation)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
      },
    })

    if (!response.ok) return false

    const text = await response.text()
    // Quick check for XML feed markers
    return text.includes('<rss') || text.includes('<feed') || text.includes('<channel')
  } catch {
    return false
  }
}

// ============================================================================
// Main Handler
// ============================================================================

export async function handleDiscover(
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
  const body = req.body as DiscoverRequest

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

  const input = body.url.trim()

  // Calculate timeout (use timeout budget allocation from spec)
  const totalTimeout = Math.min(body.timeout || DEFAULT_DISCOVER_TIMEOUT, MAX_DISCOVER_TIMEOUT)
  const homepageTimeout = Math.floor(totalTimeout * 0.3)
  const probeTimeout = Math.floor(totalTimeout * 0.4 / 3) // Per probe batch
  const parseTimeout = Math.floor(totalTimeout * 0.2)

  // Handle username input (no dots, no protocol)
  if (isUsernameInput(input)) {
    const username = input.replace(/^@/, '')

    const response: DiscoverPlatformHintResponse = {
      success: true,
      platform_hint: true,
      input: username,
      suggestions: [
        {
          platform: 'substack',
          url: `https://${username}.substack.com`,
          label: 'Substack',
        },
        {
          platform: 'medium',
          url: `https://medium.com/@${username}`,
          label: 'Medium',
        },
        {
          platform: 'ghost',
          url: `https://${username}.ghost.io`,
          label: 'Ghost',
        },
      ],
    }

    res.status(200).json(response)
    return
  }

  // Normalize URL
  const normalizedUrlString = normalizeUrl(input)

  // Validate URL for SSRF
  const urlValidation = validateUrl(normalizedUrlString)
  if (!urlValidation.valid) {
    res.status(200).json({
      success: false,
      error: urlValidation.error,
    } as DiscoverErrorResponse)
    return
  }

  const url = urlValidation.url!

  // Detect input type
  let inputType = detectInputType(url)
  let homepageUrl = normalizedUrlString

  // If article URL, extract homepage
  if (inputType === 'article') {
    homepageUrl = extractHomepageUrl(url)
  }

  // Initialize response data
  let feeds: FeedInfo[] = []
  let images: Images = { site_icon: null, og_image: null }
  let metadata: FeedMetadata | null = null
  let contentAnalysis: ContentAnalysis | null = null
  let recentPosts: RecentPost[] | null = null

  try {
    // If input is a feed URL, parse directly
    if (inputType === 'feed') {
      // Validate it's actually a feed
      const isValid = await validateFeedUrl(normalizedUrlString, homepageTimeout)
      if (!isValid) {
        // Fall back to treating it as a homepage
        inputType = 'homepage'
        homepageUrl = url.origin
      } else {
        feeds = [{
          url: normalizedUrlString,
          title: null,
          type: 'unknown',
        }]

        // Parse the feed
        const parsed = await parseFeed(normalizedUrlString, parseTimeout)
        if (parsed) {
          metadata = parsed.metadata
          recentPosts = parsed.posts
          contentAnalysis = parsed.contentAnalysis

          // Update feed info with title from parsing
          feeds[0].title = metadata.title

          // Try to discover images from feed's homepage link
          if (metadata.link) {
            try {
              const homeResponse = await fetchWithTimeout(metadata.link, homepageTimeout, {
                method: 'GET',
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; BlogsAreBack/1.0)',
                  Accept: 'text/html',
                },
              })

              if (homeResponse.ok) {
                const html = await homeResponse.text()
                const { document } = parseHTML(html)
                images = {
                  site_icon: extractFavicon(document as unknown as Document, metadata.link),
                  og_image: extractOgImage(document as unknown as Document, metadata.link),
                }
              }
            } catch {
              // Ignore image discovery errors
            }
          }
        }

        const response: DiscoverSuccessResponse = {
          success: true,
          input_type: 'feed',
          normalized_url: normalizedUrlString,
          feeds,
          recommended_feed: normalizedUrlString,
          metadata,
          images,
          content_analysis: contentAnalysis,
          recent_posts: recentPosts,
        }

        res.status(200).json(response)
        return
      }
    }

    // Fetch homepage HTML
    let html: string
    try {
      const response = await fetchWithTimeout(homepageUrl, homepageTimeout, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; BlogsAreBack/1.0; +https://blogsareback.com)',
          Accept: 'text/html, application/xhtml+xml, */*',
        },
      })

      if (!response.ok) {
        res.status(200).json({
          success: false,
          error: {
            code: ErrorCodes.FETCH_FAILED,
            message: `HTTP ${response.status}: ${response.statusText}`,
          },
        } as DiscoverErrorResponse)
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
        } as DiscoverErrorResponse)
        return
      }

      html = new TextDecoder().decode(arrayBuffer)
    } catch (error) {
      const isTimeout = error instanceof Error &&
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
      } as DiscoverErrorResponse)
      return
    }

    // Parse HTML
    const { document } = parseHTML(html)
    const doc = document as unknown as Document

    // Extract images
    images = {
      site_icon: extractFavicon(doc, homepageUrl),
      og_image: extractOgImage(doc, homepageUrl),
    }

    // Discover feeds from HTML link tags
    feeds = discoverFeedsFromHtml(doc, homepageUrl)

    // If no feeds found in HTML, probe common paths
    if (feeds.length === 0) {
      const origin = new URL(homepageUrl).origin
      feeds = await probeFeedPaths(origin, probeTimeout)
    }

    // Parse the recommended feed (first valid one)
    if (feeds.length > 0) {
      const recommendedFeedUrl = feeds[0].url
      const parsed = await parseFeed(recommendedFeedUrl, parseTimeout)

      if (parsed) {
        metadata = parsed.metadata
        recentPosts = parsed.posts
        contentAnalysis = parsed.contentAnalysis

        // Update feed info with title from parsing if not already set
        if (!feeds[0].title) {
          feeds[0].title = metadata.title
        }

        // Detect feed type from parsing if unknown
        if (feeds[0].type === 'unknown') {
          // rss-parser doesn't expose this directly, keep as unknown
        }
      }
    }

    // Build success response
    const response: DiscoverSuccessResponse = {
      success: true,
      input_type: inputType as 'homepage' | 'article',
      normalized_url: homepageUrl,
      feeds,
      recommended_feed: feeds.length > 0 ? feeds[0].url : null,
      metadata,
      images,
      content_analysis: contentAnalysis,
      recent_posts: recentPosts,
    }

    if (feeds.length === 0) {
      response.message = 'No RSS or Atom feeds found for this URL'
    }

    res.status(200).json(response)

  } catch (error) {
    res.status(200).json({
      success: false,
      error: {
        code: ErrorCodes.DISCOVERY_FAILED,
        message: 'Could not complete feed discovery',
        details: error instanceof Error ? error.message : undefined,
      },
    } as DiscoverErrorResponse)
  }
}
