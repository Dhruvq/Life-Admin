/**
 * VALIDATION 3 — Minimax STT Accepts .m4a
 *
 * Risk: If Minimax STT rejects .m4a (AAC), we need to transcode to mp3/wav first,
 *       which adds an ffmpeg dependency to the project.
 * Pass condition: A real .m4a file is submitted to Minimax STT and returns a transcript.
 *
 * How to run:
 *   1. Copy a real .m4a file (e.g., a voice memo from iPhone) to validate/sample.m4a
 *      OR set M4A_PATH env var to any .m4a file path
 *   2. Set MINIMAX_API_KEY in .env
 *   3. node validate/03-minimax-stt.js
 *
 * STT endpoint uses async job pattern: POST to create, GET to poll for result.
 */

require('dotenv').config()
const fs = require('fs')
const path = require('path')
const https = require('https')
const http = require('http')

const API_KEY = process.env.MINIMAX_API_KEY
const BASE_URL = process.env.MINIMAX_BASE_URL || 'https://api.minimax.io'
const M4A_PATH = process.env.M4A_PATH || path.join(__dirname, 'sample.m4a')

if (!API_KEY) {
  console.error('❌ MINIMAX_API_KEY not set. Add it to .env')
  process.exit(1)
}

if (!fs.existsSync(M4A_PATH)) {
  console.error(`❌ No .m4a file found at: ${M4A_PATH}`)
  console.error('   Copy a voice memo to validate/sample.m4a, or set M4A_PATH=/path/to/file.m4a')
  process.exit(1)
}

// Simple fetch wrapper using built-in https
function fetchJSON(url, options = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url)
    const lib = urlObj.protocol === 'https:' ? https : http
    const req = lib.request(urlObj, {
      method: options.method || 'GET',
      headers: options.headers || {},
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
    if (options.body) req.write(options.body)
    req.end()
  })
}

// Multipart form builder for file upload
function buildMultipart(filePath) {
  const boundary = '----FormBoundary' + Math.random().toString(36).slice(2)
  const filename = path.basename(filePath)
  const fileData = fs.readFileSync(filePath)

  const header = Buffer.from(
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: audio/m4a\r\n\r\n`
  )
  const footer = Buffer.from(`\r\n--${boundary}--\r\n`)
  const body = Buffer.concat([header, fileData, footer])

  return { boundary, body }
}

async function submitSTTJob(filePath) {
  const { boundary, body } = buildMultipart(filePath)

  return new Promise((resolve, reject) => {
    const urlObj = new URL(`${BASE_URL}/v1/stt/create`)
    const req = https.request(urlObj, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
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

async function pollSTTResult(jobId, maxAttempts = 20, intervalMs = 2000) {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`   Polling attempt ${i + 1}/${maxAttempts}...`)
    const res = await fetchJSON(`${BASE_URL}/v1/stt/${jobId}`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` },
    })

    if (res.body?.status === 'completed' || res.body?.text) {
      return res.body
    }
    if (res.body?.status === 'failed') {
      throw new Error(`STT job failed: ${JSON.stringify(res.body)}`)
    }

    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('STT job timed out after polling')
}

async function run() {
  console.log('--- Validation 3: Minimax STT Accepts .m4a ---')
  console.log(`   File: ${M4A_PATH} (${fs.statSync(M4A_PATH).size} bytes)`)

  // Step 1: Submit job
  console.log('\n[1] Submitting .m4a to Minimax STT...')
  const submitRes = await submitSTTJob(M4A_PATH)
  console.log('   Response status:', submitRes.status)
  console.log('   Response body:', JSON.stringify(submitRes.body, null, 2))

  if (submitRes.status !== 200 || submitRes.body?.base_resp?.status_code !== 0) {
    // Try alternative: if it returned transcript directly
    if (submitRes.body?.text || submitRes.body?.transcript) {
      const transcript = submitRes.body.text || submitRes.body.transcript
      console.log('\n✅ Transcript received directly:', transcript)
      console.log('\n✅ Validation 3 PASSED — Minimax STT accepts .m4a and returns transcript.')
      return
    }

    console.error('\n❌ Validation 3 FAILED — unexpected response from Minimax STT.')
    console.error('   If status 415: .m4a is rejected → need transcoding step (add ffmpeg)')
    console.error('   If status 401: check MINIMAX_API_KEY')
    console.error('   If status 404: STT endpoint may be at a different path — check docs')
    process.exit(1)
  }

  const jobId = submitRes.body?.generation_id || submitRes.body?.task_id || submitRes.body?.id
  if (!jobId) {
    console.error('❌ No job ID in response — cannot poll for result')
    process.exit(1)
  }

  // Step 2: Poll for result
  console.log(`\n[2] Polling for STT result (job: ${jobId})...`)
  const result = await pollSTTResult(jobId)
  const transcript = result.text || result.transcript || JSON.stringify(result)

  console.log('\n✅ Transcript:', transcript)
  console.log('\n✅ Validation 3 PASSED — Minimax STT accepts .m4a and returns transcript.')
  console.log('   No transcoding dependency needed.')
}

run().catch((err) => {
  console.error('\n❌ Validation 3 FAILED:', err.message)
  if (err.message.includes('415') || err.message.includes('unsupported')) {
    console.error('   MITIGATION: Add ffmpeg to transcode .m4a → .mp3 before submitting.')
    console.error('   npm install fluent-ffmpeg  +  brew install ffmpeg')
  }
  process.exit(1)
})
