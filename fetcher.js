/**
 * fetcher.js — Fetch the <title> of a URL at bookmark/reminder save time.
 *
 * No new dependencies — uses Node's built-in https/http modules.
 * Returns null on any error so callers can fall back gracefully.
 */

const https = require('https')
const http  = require('http')
const { URL } = require('url')

const TIMEOUT_MS  = 5000
const MAX_REDIRECTS = 5
const MAX_BYTES   = 51200  // 50 KB — enough to reach </title> on any normal page

/**
 * Fetch the page title for a URL.
 * @param {string} rawUrl
 * @returns {Promise<string|null>}
 */
async function fetchLinkTitle(rawUrl) {
  try {
    const raw = await _get(rawUrl, 0)
    if (!raw) return null
    return _decode(raw.replace(/\s+/g, ' ').trim()).slice(0, 120) || null
  } catch {
    return null
  }
}

// ── Internal ──────────────────────────────────────────────────────────────────

function _get(rawUrl, hops) {
  return new Promise((resolve) => {
    if (hops > MAX_REDIRECTS) return resolve(null)

    let url
    try { url = new URL(rawUrl) } catch { return resolve(null) }

    const lib = url.protocol === 'https:' ? https : http

    const req = lib.get({
      hostname: url.hostname,
      path: url.pathname + url.search,
      port: url.port || undefined,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      timeout: TIMEOUT_MS,
    }, (res) => {
      // Follow redirects
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, rawUrl).href
        res.destroy()
        return resolve(_get(next, hops + 1))
      }

      if (res.statusCode !== 200) { res.destroy(); return resolve(null) }

      const ct = res.headers['content-type'] || ''
      if (!ct.includes('html')) { res.destroy(); return resolve(null) }

      let buf = ''
      let done = false

      const finish = () => {
        if (done) return
        done = true
        const m = buf.match(/<title[^>]*>([^<]*)<\/title>/i)
        resolve(m ? m[1] : null)
      }

      res.on('data', chunk => {
        buf += chunk.toString()
        if (buf.length > MAX_BYTES || buf.toLowerCase().includes('</title>')) {
          res.destroy()
        }
      })
      res.on('end',  finish)
      res.on('close', finish)
      res.on('error', () => { done = true; resolve(null) })
    })

    req.on('error',   () => resolve(null))
    req.on('timeout', () => { req.destroy(); resolve(null) })
  })
}

function _decode(str) {
  return str
    .replace(/&amp;/gi,  '&')
    .replace(/&lt;/gi,   '<')
    .replace(/&gt;/gi,   '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi,  "'")
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
}

module.exports = { fetchLinkTitle }
