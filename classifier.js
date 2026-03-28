/**
 * classifier.js — Intent classification via Minimax MiniMax-M2
 *
 * Takes a text string, returns a structured intent JSON object.
 *
 * MiniMax-M2 is a reasoning model — it uses internal CoT tokens before writing
 * output. Always use max_completion_tokens: 2048 or the reasoning tokens will
 * consume the budget and leave nothing for the actual JSON output.
 */

require('dotenv').config()

const https = require('https')

const API_KEY = process.env.MINIMAX_API_KEY
const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io'
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2'
const GROUP_ID = process.env.MINIMAX_GROUP_ID  // optional for api.minimax.io

// The classification prompt — same as validated in validate/04-minimax-classification.js
const SYSTEM_PROMPT = `You are an intent classifier for a personal iMessage assistant called Carl.
The user sends messages to save bookmarks, set reminders, query saved items, or just chat.

Current datetime (user's local time): {{CURRENT_DATETIME}}

You must respond ONLY with a single JSON object — no markdown, no explanation, no extra text.

JSON schema:
{
  "intent": "bookmark" | "reminder" | "query" | "list_all" | "delete" | "conversational",
  "item": string | null,          // for bookmark: the thing being saved
  "context": string | null,       // for bookmark: additional context/reason
  "task": string | null,          // for reminder: what to do
  "remind_at": string | null,     // for reminder: ISO 8601 UTC datetime string
  "urgency": "high" | "medium" | "low" | null,  // for reminder
  "entity_tags": string[],        // normalized lowercase keywords (e.g. ["mom", "birthday", "gym"])
  "query": string | null,         // for query/delete: the search term
  "reply": string | null          // for conversational: a short friendly one-line response
}

Urgency rules (only when no explicit time given):
- high: ASAP / urgent / emergency → 6 hours (or next 8am if after 5pm)
- medium: soon / today → same day evening
- low: no urgency signals → next morning

Entity tags: extract normalized lowercase keywords that could link this to other saved items.`

const FALLBACK = { intent: 'conversational', reply: null, entity_tags: [], item: null, context: null, task: null, remind_at: null, urgency: null, query: null }

/**
 * Classify a text message into a structured intent object.
 * @param {string} text
 * @returns {Promise<object>} intent object — never throws, falls back to conversational on error
 */
async function classify(text) {
  if (!API_KEY) {
    console.error('[classifier] MINIMAX_API_KEY not set')
    return FALLBACK
  }

  const now = new Date().toLocaleString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  })
  const systemPrompt = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', now)

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: text },
    ],
    temperature: 0.1,
    max_completion_tokens: 2048,
    stream: false,
  })

  try {
    const res = await _post(body)

    if (res.status !== 200) {
      console.error(`[classifier] HTTP ${res.status}:`, JSON.stringify(res.body))
      return FALLBACK
    }

    const rawContent = res.body?.choices?.[0]?.message?.content
    if (!rawContent) {
      console.error('[classifier] No content in response:', JSON.stringify(res.body))
      return FALLBACK
    }

    const parsed = _extractJSON(rawContent)
    console.log(`[classifier] intent=${parsed.intent} tags=[${(parsed.entity_tags || []).join(', ')}]`)
    return parsed

  } catch (err) {
    console.error(`[classifier] Error: ${err.message}`)
    return FALLBACK
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractJSON(text) {
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  return JSON.parse(cleaned)
}

function _post(body) {
  return new Promise((resolve, reject) => {
    const url = GROUP_ID
      ? `${BASE_URL}/v1/text/chatcompletion_v2?GroupId=${GROUP_ID}`
      : `${BASE_URL}/v1/text/chatcompletion_v2`

    const urlObj = new URL(url)
    const req = https.request(urlObj, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = ''
      res.on('data', (chunk) => (data += chunk))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) })
        } catch {
          resolve({ status: res.statusCode, body: data })
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

module.exports = { classify }
