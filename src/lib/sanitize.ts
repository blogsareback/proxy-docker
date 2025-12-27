// HTML Sanitization for Readability output
// Strips all attributes except allowed ones, removes dangerous elements,
// and resolves relative URLs

import { parseHTML } from 'linkedom'

// Allowed tags for sanitization (matches extension behavior)
const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'mark',
  'a',
  'img',
  'figure',
  'figcaption',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'hr',
  'sup',
  'sub',
  'details',
  'summary',
  'div', // Readability uses these as containers
  'span',
  'article',
  'section',
  'aside',
  'header',
  'footer',
  'main',
  'time',
  'abbr',
  'cite',
  'dfn',
  'kbd',
  'samp',
  'var',
  'small',
  'dl',
  'dt',
  'dd',
  'caption',
  'col',
  'colgroup',
  'picture',
  'source',
  'video',
  'audio',
])

// Dangerous tags that should be completely removed (content and all)
const DANGEROUS_TAGS = new Set([
  'script',
  'style',
  'link',
  'meta',
  'iframe',
  'embed',
  'object',
  'form',
  'input',
  'button',
  'select',
  'textarea',
  'noscript',
  'template',
  'svg', // SVGs can contain scripts
])

// Attributes allowed per tag
const ALLOWED_ATTRS: Record<string, string[]> = {
  a: ['href'],
  img: ['src', 'alt', 'title'],
  source: ['src', 'srcset', 'type', 'media'],
  video: ['src', 'poster', 'width', 'height'],
  audio: ['src'],
  time: ['datetime'],
  abbr: ['title'],
  dfn: ['title'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
  col: ['span'],
  colgroup: ['span'],
}

/**
 * Sanitize HTML from Readability output
 * Strips all attributes except allowed ones, removes dangerous elements,
 * and resolves relative URLs to absolute
 */
export function sanitizeHtml(html: string, baseUrl: string): string {
  const { document } = parseHTML(`<!DOCTYPE html><html><body>${html}</body></html>`)

  // Remove dangerous elements completely (including content)
  for (const tagName of DANGEROUS_TAGS) {
    const elements = Array.from(document.querySelectorAll(tagName)) as Element[]
    for (const el of elements) {
      el.remove()
    }
  }

  // Process all remaining elements
  const allElements = Array.from(document.querySelectorAll('*')) as Element[]
  for (const el of allElements) {
    // Skip html, head, body which are part of the document structure
    const tagName = el.tagName.toLowerCase()
    if (tagName === 'html' || tagName === 'head' || tagName === 'body') {
      continue
    }

    // Remove unknown tags but keep their content
    if (!ALLOWED_TAGS.has(tagName)) {
      // Replace element with its children
      const parent = el.parentNode
      if (parent) {
        while (el.firstChild) {
          parent.insertBefore(el.firstChild, el)
        }
        parent.removeChild(el)
      }
      continue
    }

    // Get allowed attributes for this tag
    const allowedAttrs = ALLOWED_ATTRS[tagName] || []

    // Remove all non-allowed attributes
    const attrs = Array.from(el.attributes) as Attr[]
    for (const attr of attrs) {
      if (!allowedAttrs.includes(attr.name)) {
        el.removeAttribute(attr.name)
      }
    }

    // Validate href on anchors (no javascript: or data:)
    if (tagName === 'a') {
      const href = el.getAttribute('href')
      if (href) {
        const hrefLower = href.toLowerCase().trim()
        if (
          hrefLower.startsWith('javascript:') ||
          hrefLower.startsWith('data:') ||
          hrefLower.startsWith('vbscript:')
        ) {
          el.removeAttribute('href')
        } else if (
          !href.startsWith('http://') &&
          !href.startsWith('https://') &&
          !href.startsWith('mailto:') &&
          !href.startsWith('#')
        ) {
          // Resolve relative URLs
          try {
            const absoluteUrl = new URL(href, baseUrl).href
            el.setAttribute('href', absoluteUrl)
          } catch {
            // Invalid URL, leave as-is
          }
        }
      }
    }

    // Resolve relative image URLs
    if (tagName === 'img') {
      const src = el.getAttribute('src')
      if (src) {
        const srcLower = src.toLowerCase().trim()
        // Skip data URIs
        if (!srcLower.startsWith('data:')) {
          if (
            !src.startsWith('http://') &&
            !src.startsWith('https://')
          ) {
            try {
              const absoluteUrl = new URL(src, baseUrl).href
              el.setAttribute('src', absoluteUrl)
            } catch {
              // Invalid URL, leave as-is
            }
          }
        }
      }
    }

    // Resolve relative source URLs (for picture/video/audio elements)
    if (tagName === 'source') {
      const src = el.getAttribute('src')
      if (
        src &&
        !src.startsWith('http://') &&
        !src.startsWith('https://') &&
        !src.startsWith('data:')
      ) {
        try {
          const absoluteUrl = new URL(src, baseUrl).href
          el.setAttribute('src', absoluteUrl)
        } catch {
          // Invalid URL, leave as-is
        }
      }

      // Also handle srcset
      const srcset = el.getAttribute('srcset')
      if (srcset) {
        const resolvedSrcset = resolveSrcset(srcset, baseUrl)
        el.setAttribute('srcset', resolvedSrcset)
      }
    }

    // Resolve video poster attribute
    if (tagName === 'video') {
      const poster = el.getAttribute('poster')
      if (
        poster &&
        !poster.startsWith('http://') &&
        !poster.startsWith('https://') &&
        !poster.startsWith('data:')
      ) {
        try {
          const absoluteUrl = new URL(poster, baseUrl).href
          el.setAttribute('poster', absoluteUrl)
        } catch {
          // Invalid URL, leave as-is
        }
      }
    }
  }

  return document.body.innerHTML
}

/**
 * Resolve relative URLs in srcset attribute
 */
function resolveSrcset(srcset: string, baseUrl: string): string {
  return srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/)
      if (parts.length >= 1) {
        const url = parts[0]
        if (
          url &&
          !url.startsWith('http://') &&
          !url.startsWith('https://') &&
          !url.startsWith('data:')
        ) {
          try {
            parts[0] = new URL(url, baseUrl).href
          } catch {
            // Invalid URL, leave as-is
          }
        }
      }
      return parts.join(' ')
    })
    .join(', ')
}

/**
 * Resolve a URL relative to a base URL
 * Returns the resolved absolute URL or the original if resolution fails
 */
export function resolveUrl(url: string, baseUrl: string): string {
  if (!url) return url

  // Already absolute
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
  }

  // Data URI - return as-is
  if (url.startsWith('data:')) {
    return url
  }

  try {
    return new URL(url, baseUrl).href
  } catch {
    return url
  }
}
