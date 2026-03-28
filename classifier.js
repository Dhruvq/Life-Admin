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

Current time — UTC: {{CURRENT_UTC}} | Local: {{CURRENT_LOCAL}}
All remind_at values MUST be ISO 8601 UTC strings (ending in Z).
Relative time example: if UTC is 2026-01-15T21:00:00.000Z and user says "in 30 minutes", remind_at = "2026-01-15T21:30:00.000Z". Add the duration directly to the UTC timestamp.

You must respond ONLY with a single JSON object — no markdown, no explanation, no extra text.

JSON schema:
{
  "intent": "bookmark" | "reminder" | "query" | "list_all" | "delete" | "clear_all" | "conversational",
  "item": string | null,          // for bookmark: the thing being saved
  "context": string | null,       // for bookmark: additional context/reason
  "task": string | null,          // for reminder: what to do
  "remind_at": string | null,     // for reminder: ISO 8601 UTC datetime string
  "urgency": "scheduled" | "high" | "medium" | "low" | null,  // for reminder
  "entity_tags": string[],        // normalized lowercase keywords (e.g. ["mom", "birthday", "gym"])
  "query": string | null,         // for query/delete: the search term
  "clear_target": "bookmarks" | "reminders" | "all" | null,  // for clear_all
  "reply": string | null          // for conversational: a short friendly one-line response
}

Urgency rules:
- scheduled: ALWAYS use this when the user gives an explicit time or date (remind_at is set). Overrides all other urgency signals.
- high: no explicit time AND ASAP / urgent / emergency → 6 hours (or next 8am if after 5pm)
- medium: no explicit time AND soon / today → same day evening
- low: no explicit time AND no urgency signals → next morning

clear_all rules: use when user wants to wipe everything in a category.
- "delete all bookmarks" / "clear my bookmarks" → clear_target: "bookmarks"
- "delete all reminders" / "cancel all reminders" → clear_target: "reminders"
- "clear everything" / "reset" / "delete everything" → clear_target: "all"

Entity tags: extract specific, concrete entity names that could link this to other saved items.
Rules for entity_tags:
- ONLY include proper nouns and specific identifiers: person names ("mom", "dad", "ryan"), specific product names ("airpods max", "netflix"), specific place names ("tokyo", "gym on 5th"), specific event names ("birthday", "wedding").
- NEVER include generic action words, categories, or vague nouns: do NOT include words like "reminder", "task", "buy", "read", "check", "thing", "item", "today", "soon", "follow", "up", "call", "gift".
- If nothing is specific enough to act as a meaningful link, return an empty array.
- Fewer, more precise tags are better than many loose tags.`

const FALLBACK = { intent: 'conversational', reply: null, entity_tags: [], item: null, context: null, task: null, remind_at: null, urgency: null, query: null, clear_target: null }

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

  const now = new Date()
  const utcISO = now.toISOString()
  const localStr = now.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
  const systemPrompt = SYSTEM_PROMPT
    .replace('{{CURRENT_UTC}}', utcISO)
    .replace('{{CURRENT_LOCAL}}', localStr)

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
