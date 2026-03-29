# Life Admin Agent 

**Not "an AI task assistant" — but "an AI that ensures nothing important slips through your life."**

Life Admin Agent is an intelligent iMessage bot that lives entirely inside your native messaging app. It bookmarks things you want to remember, reminds you about things you need to do, and seamlessly processes both text messages and native iMessage voice memos.

### Video Demo:

[Watch the Demo Video](./Carl_demo.mov)

##  Core Features

- **Six Core Intents**: Seamlessly detects whether you want to **Bookmark**, set a **Reminder**, **Query** saved items, **List All** active items, **Delete**, or just have a **Conversational** chat.
- **Native Voice Memos**: Just speak to it. The agent transcodes Apple's `.caf` voice memos to `.mp3` and transcribes them using OpenAI Whisper before processing your intent.
- **Smart Linking**: When you set a reminder (e.g., "Remind me to get mom's birthday gift"), the agent intelligently searches your previous bookmarks and links relevant items (e.g., " You saved a Keurig Espresso machine for that").
- **Urgency Detection**: Infers urgency from natural language (e.g., "ASAP", "urgent") and defaults to appropriate reminder windows when an explicit time isn't provided.
- **Proactive Reminders**: Initiates contact when a reminder is due instead of waiting for you to ask.

##  Tech Stack

- **Runtime/Framework:** Node.js (Express / Plain Node)
- **Messaging Integration:** Photon SDK (for native iMessage interactions)
- **Database:** SQLite (`better-sqlite3`)
- **Speech-to-Text:** OpenAI Whisper (via `ffmpeg` for audio transcoding)
- **AI / NLP Engine:** Minimax Text API (MiniMax-M2) for intent classification, entity extraction, time parsing, and urgency detection.

##  How it Works

1. **Message Arrives**: Handled via the Photon SDK (text or audio).
2. **Audio Processing**: Voice memos are transcoded via `ffmpeg` and transcribed by OpenAI Whisper.
3. **Intent Classification**: Text is routed to the Minimax API to extract structured JSON (intent, datetime, entities, urgency).
4. **Execution**: The agent stores the bookmark, schedules the reminder, queries memory, or responds conversationally.
5. **Proactive Polling**: A continuous scheduler checks the database every 30 seconds for due reminders and dispatches follow-ups.

##  Getting Started

### Prerequisites

- macOS (required for Photon SDK / iMessage)
- Node.js
- ffmpeg (for `.caf` to `.mp3` audio transcoding)
- A valid OpenAI API Key (for Whisper)
- A valid Minimax API Key

### Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd Life-Admin
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Configure your environment variables (see Configuration section).
4. Start the application:
   ```bash
   npm start
   ```

##  Configuration

### Sample .env File

   ```bash
# Minimax API Configuration
# Sign up at https://www.minimaxi.com to get your credentials
# Your Minimax API Key (Bearer token for Authorization header)
MINIMAX_API_KEY=

# Your Minimax Group ID (required for some endpoints)
MINIMAX_GROUP_ID=

# Base API URL
MINIMAX_BASE_URL=https://api.minimax.io

# Model
MINIMAX_MODEL=M2

# Your Phone Number
MY_PHONE_NUMBER=+1xxxxxxxxx

# Your OpenAI API Key(Only for Voice Memo Transcription)
OPENAI_API_KEY=
 ```
##  Project Structure

- `index.js` — Photon setup, message handler entry point, starts the scheduler.
- `classifier.js` — Calls Minimax Text, returns parsed intent JSON.
- `transcriber.js` — Handles `ffmpeg` transcoding and OpenAI Whisper calls.
- `db.js` — Initializes SQLite, handles CRUD operations and Smart Linking queries.
- `scheduler.js` — The 30-second polling loop for due reminders.
- `responses.js` — Centralized response formatting and copy (Emoji System).

##  MIT License