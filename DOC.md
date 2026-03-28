# Life Admin — Working Docs

## Stack
- **Runtime**: Node.js (CommonJS)
- **iMessage**: `@photon-ai/imessage-kit` — Full Disk Access required (no SIP changes needed)
- **STT**: OpenAI Whisper (`whisper-1`) — Minimax has no public STT API
- **Text/AI**: Minimax Text API (`MiniMax-Text-01`) — classification, time parsing, urgency, entity tags, replies
- **DB**: SQLite via `better-sqlite3`
- **Audio transcoding**: `ffmpeg` (brew) + `fluent-ffmpeg` (npm) — iMessage sends `.caf`, Whisper needs `.mp3`

## Voice Memo Pipeline
```
iMessage .caf → ffmpeg → .mp3 → OpenAI Whisper → transcript → Minimax classifier
```

## .env Keys
```
MINIMAX_API_KEY=
MINIMAX_BASE_URL=https://api.minimax.io
MINIMAX_MODEL=MiniMax-M2
OPENAI_API_KEY=
MY_PHONE_NUMBER=+1XXXXXXXXXX
```

## How the routing actually works:

Photon monitors ALL messages arriving on this Mac (via iMessage sync)
Anyone can text your Mac's Apple ID / phone number
Carl picks it up and should respond back to that person (msg.sender)
MY_PHONE_NUMBER in .env is only for proactive scheduler reminders (Carl initiating contact)

## Validations
| # | What | Run | Status |
|---|------|-----|--------|
| 1 | Photon SDK sends/receives iMessage | `npm run validate:1` | Manual (interactive) |
| 2 | Photon exposes voice memo `.caf` file path | `npm run validate:2` | Manual (interactive) |
| 3 | ffmpeg `.caf→.mp3` + Whisper transcript | `npm run validate:3` | Needs `sample.caf` + `OPENAI_API_KEY` |
| 4 | Minimax returns valid JSON on 10 inputs | `npm run validate:4` | Needs `MINIMAX_API_KEY` |
| 5 | Timezone pipeline (pure logic) | `npm run validate:5` | ✅ 8/8 |

## Design Decisions (from Risk Checklist)
- **Multi-turn state (item 6)**: `pending_action` row in `settings` table — see `db.js`
- **Onboarding (item 7)**: `onboarded` flag in `settings` table — see `db.js`
- **Smart linking (item 8)**: `searchByEntityTags(tags[])` in `db.js` — in-memory tag overlap

## File Map
```
index.js        — Photon setup, message handler, starts scheduler
classifier.js   — calls Minimax Text, returns parsed intent JSON
transcriber.js  — ffmpeg .caf→.mp3, calls Whisper, returns transcript
db.js           — SQLite schema + all DB functions (✅ exists)
scheduler.js    — 30s polling loop for due reminders
responses.js    — all response copy/formatting
validate/       — pre-build risk checklist scripts
```

## Known Issues / Decisions Made
- `MiniMax-M2` is a reasoning model — uses internal CoT tokens before writing JSON output. Set `max_completion_tokens: 2048` in `classifier.js` (not 512) or responses get cut off mid-JSON
- Minimax STT does not exist — switched to OpenAI Whisper
- iMessage voice memos are `.caf` (not `.m4a`) — ffmpeg required
- `fluent-ffmpeg` npm package still needs to be installed before building `transcriber.js`
