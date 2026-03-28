/**
 * VALIDATION 4 — Minimax Text API Returns Reliable Structured JSON
 *
 * Risk: A single LLM call that does intent classification + time parsing + urgency +
 *       entity extraction + conversational reply is complex. The model may return
 *       malformed JSON or fail on edge cases.
 * Pass condition: All 10 test inputs parse cleanly into valid intent JSON.
 *                 0 malformed responses.
 *
 * Run: node validate/04-minimax-classification.js
 */

const path = require('path')
require('dotenv').config({ path: path.join(__dirname, '../.env') })
const https = require('https')

const API_KEY = process.env.MINIMAX_API_KEY
const GROUP_ID = process.env.MINIMAX_GROUP_ID  // optional for api.minimax.io
const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io'
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M2'

if (!API_KEY) {
  console.error('❌ MINIMAX_API_KEY not set in Life-Admin/.env')
  process.exit(1)
}

// Debug: confirm what's loaded (masked)
console.log(`   API_KEY: ${API_KEY.slice(0, 6)}...${API_KEY.slice(-4)}`)
console.log(`   BASE_URL: ${BASE_URL}`)
console.log(`   MODEL: ${MODEL}`)
console.log(`   GROUP_ID: ${GROUP_ID ? GROUP_ID.slice(0, 4) + '...' : '(not set)'}`)
console.log()

// The exact system prompt that will be used in production
const SYSTEM_PROMPT = `You are an intent classifier for a personal iMessage assistant.
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
  "entity_tags": string[],        // normalized keywords (e.g. ["mom", "birthday", "gym"])
  "query": string | null,         // for query/delete: the search term
  "reply": string | null          // for conversational: a short friendly one-line response
}

Urgency rules (only when no explicit time given):
- high: ASAP / urgent / emergency → 6 hours (or next 8am if after 5pm)
- medium: soon / today → same day evening
- low: no urgency signals → next morning

Entity tags: extract normalized lowercase keywords that could link this to other saved items.`

// 10 test inputs covering all intents and edge cases
const TEST_INPUTS = [
  // Bookmarks
  { input: 'Bookmark Keurig Espresso machine for mom\'s birthday', expectedIntent: 'bookmark' },
  { input: 'Save that Thai restaurant on 3rd street for date night', expectedIntent: 'bookmark' },

  // Reminders with relative times
  { input: 'Remind me to pay my credit card bill in 10 days', expectedIntent: 'reminder' },
  { input: 'Remind me to go to the gym tomorrow at 6pm', expectedIntent: 'reminder' },

  // Urgency (no explicit time)
  { input: 'I need to call the landlord about the leak ASAP', expectedIntent: 'reminder' },

  // Query
  { input: 'What did I want to get my mom for her birthday?', expectedIntent: 'query' },

  // List all
  { input: 'What am I tracking?', expectedIntent: 'list_all' },

  // Delete
  { input: 'Cancel my gym reminder', expectedIntent: 'delete' },

  // Conversational
  { input: 'Thanks', expectedIntent: 'conversational' },
  { input: 'You\'re the best', expectedIntent: 'conversational' },
]

function callMinimax(userMessage) {
  const now = new Date().toLocaleString('en-US', { timeZoneName: 'short' })
  const systemPrompt = SYSTEM_PROMPT.replace('{{CURRENT_DATETIME}}', now)

  const body = JSON.stringify({
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    temperature: 0.1,  // low temp for consistent structured output
    max_completion_tokens: 2048,  // MiniMax-M2 is a reasoning model — uses tokens for CoT before JSON output
    stream: false,
  })

  return new Promise((resolve, reject) => {
    // GroupId is required for api.minimax.chat but NOT for api.minimax.io
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

function extractJSON(text) {
  // Strip potential markdown code fences
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim()
  return JSON.parse(cleaned)
}

const REQUIRED_FIELDS = ['intent', 'entity_tags']
const VALID_INTENTS = ['bookmark', 'reminder', 'query', 'list_all', 'delete', 'conversational']

function validateSchema(parsed) {
  const errors = []

  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) errors.push(`missing field: ${field}`)
  }

  if (!VALID_INTENTS.includes(parsed.intent)) {
    errors.push(`invalid intent: ${parsed.intent}`)
  }

  if (!Array.isArray(parsed.entity_tags)) {
    errors.push('entity_tags must be an array')
  }

  if (parsed.intent === 'reminder') {
    if (parsed.remind_at && isNaN(Date.parse(parsed.remind_at))) {
      errors.push(`remind_at is not a valid ISO datetime: ${parsed.remind_at}`)
    }
    if (parsed.urgency && !['high', 'medium', 'low'].includes(parsed.urgency)) {
      errors.push(`invalid urgency: ${parsed.urgency}`)
    }
  }

  return errors
}

async function run() {
  console.log('--- Validation 4: Minimax Classification JSON Reliability ---')
  console.log(`Testing ${TEST_INPUTS.length} inputs against model: ${MODEL}\n`)

  let passed = 0
  let failed = 0
  const failures = []

  for (let i = 0; i < TEST_INPUTS.length; i++) {
    const { input, expectedIntent } = TEST_INPUTS[i]
    process.stdout.write(`[${i + 1}/${TEST_INPUTS.length}] "${input}"\n`)

    try {
      const res = await callMinimax(input)

      if (res.status !== 200) {
        throw new Error(`HTTP ${res.status}: ${JSON.stringify(res.body)}`)
      }

      const rawContent = res.body?.choices?.[0]?.message?.content
      if (!rawContent) {
        throw new Error(`No content in response: ${JSON.stringify(res.body)}`)
      }

      let parsed
      try {
        parsed = extractJSON(rawContent)
      } catch (e) {
        throw new Error(`JSON.parse failed — raw content: ${rawContent}`)
      }

      const schemaErrors = validateSchema(parsed)
      if (schemaErrors.length > 0) {
        throw new Error(`Schema errors: ${schemaErrors.join(', ')}`)
      }

      const intentMatch = parsed.intent === expectedIntent
      const intentNote = intentMatch ? '' : ` ⚠️  expected "${expectedIntent}", got "${parsed.intent}"`

      console.log(`   ✅ intent: ${parsed.intent}${intentNote}`)
      if (parsed.remind_at) console.log(`      remind_at: ${parsed.remind_at}`)
      if (parsed.urgency) console.log(`      urgency: ${parsed.urgency}`)
      if (parsed.entity_tags?.length) console.log(`      entity_tags: [${parsed.entity_tags.join(', ')}]`)
      if (parsed.reply) console.log(`      reply: "${parsed.reply}"`)

      passed++
    } catch (err) {
      console.log(`   ❌ FAILED: ${err.message}`)
      failed++
      failures.push({ input, error: err.message })
    }

    // Small delay to avoid rate limiting
    if (i < TEST_INPUTS.length - 1) {
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  console.log(`\n--- Results: ${passed}/${TEST_INPUTS.length} passed ---`)

  if (failed === 0) {
    console.log('\n✅ Validation 4 PASSED — Minimax returns valid structured JSON on all 10 inputs.')
    console.log('   Classification prompt is production-ready.')
  } else {
    console.log(`\n⚠️  ${failed} failure(s):`)
    failures.forEach(({ input, error }) => console.log(`   "${input}"\n   → ${error}`))
    console.log('\n   MITIGATION: Ensure try/catch + JSON.parse fallback to conversational intent in classifier.js')
    process.exit(1)
  }
}

run().catch((err) => {
  console.error('\n❌ Validation 4 FAILED (unexpected error):', err.message)
  process.exit(1)
})
