Life Admin Agent — MVP Project Specification 
 Product Overview 
 One-line pitch:  An iMessage agent that bookmarks things you want to remember and reminds you about things you need to do — and you can tell it what to do by typing or just sending a voice memo. 
 Winning angle:  Not "an AI task assistant" — but "an AI that ensures nothing important slips through your life." 
 The agent lives entirely inside iMessage via the Photon SDK. It receives text messages and voice memos, classifies the user's intent, and either stores a bookmark, creates a timed reminder, retrieves saved information, or responds conversationally. Reminders fire proactively — the agent initiates contact when something is due. 
 
 Core Features 
 Six Intents 
 Every incoming message is classified into one of six intents: 
 Bookmark  — "Bookmark Keurig Espresso machine for mom's birthday." Stores the item with context and tags. Does NOT proactively message the user. Only surfaces when queried later. 
 
 
 Reminder  — "Remind me to pay my credit card bill in 10 days." Parses the natural language time expression into an absolute datetime, stores it, and proactively messages the user when the time arrives. 
 
 
 Query  — "What did I want to get my mom for her birthday?" Searches bookmarks and reminders by keyword/tag matching and returns results. 
 
 
 List All  — "What am I tracking?" Returns all active bookmarks and pending reminders in one grouped view. 
 
 
 Delete/Cancel  — "Cancel my gym reminder" or "Remove that Keurig bookmark." Finds the closest match, confirms deletion. If multiple matches, asks which one. 
 
 
 Conversational  — "Thanks" / "Hey" / "You're the best." Returns a short, friendly, one-line response. Never re-explains capabilities unless the user seems confused. 
 
 
 Voice Memo Input 
 Users can send a voice memo in iMessage instead of typing. The audio is transcribed via OpenAI Whisper (after ffmpeg transcodes .caf → .mp3), then the transcript is processed through the same intent classification pipeline as text. This makes the interaction feel native to how people already use iMessage. 
 Smart Linking (Bookmarks ↔ Reminders) 
 When a reminder is created, the agent searches existing bookmarks for overlapping entity tags. If a match is found, the reminder confirmation references the related bookmark. Example: User previously bookmarked "Keurig Espresso machine for mom's birthday." Later says "Remind me to get mom's birthday gift on Friday." The agent responds: "I'll remind you to get mom's birthday gift on Friday — you saved a Keurig Espresso machine for that." 
 Urgency Detection 
 When a reminder has no explicit time, the agent infers urgency from language. "I need to call the landlord about the leak ASAP" is flagged as high urgency and defaults to a 6-hour reminder, unless past 5pm, in which case it defaults to the next day at 8am. Tiers: High = 6 hour, Medium = same day (evening), Low = next morning. 
 If the user provides an explicit time, that always takes priority regardless of urgency. 
 
 
 Architecture 
 Tech Stack 
 Runtime:  Node.js (required by Photon SDK) 
 Framework:  Express or plain Node 
 Database:  SQLite via better-sqlite3 
 APIs:  OpenAI Whisper (STT), Minimax Text (model: MiniMax-M2) 
 Messaging:  Photon SDK (iMessage) 
 Dev Environment:  TRAE AI 
 Message Flow 
 Message arrives via Photon (text or audio) 
 If audio → send to Minimax Speech API for transcription 
 Text (typed or transcribed) → send to Minimax Text API for intent classification 
 Minimax returns structured JSON with intent, entities, tags, urgency, and (for reminders) an absolute datetime 
 Execute: store bookmark, create reminder, search memory, list all, delete, or generate conversational reply 
 Format response and send back via Photon 
 Database Schema 
 Two tables: 
 bookmarks:  id, item, context, tags (JSON string), created_at 
 reminders:  id, task, remind_at (ISO datetime string), urgency (low/medium/high), status (pending/sent/cancelled), entity_tags (JSON string), created_at 
 Single-user — no user_id column needed for the hackathon. 
 Reminder Scheduler 
 A setInterval loop running every 30 seconds. Queries the reminders table for rows where remind_at <= now() and status = 'pending'. For each match, sends a follow-up message via Photon and updates status to 'sent'. 
 Project File Structure 
 index.js — Photon setup, message handler entry point, starts the scheduler 
 classifier.js — Takes text string, calls Minimax Text, returns parsed intent JSON 
 transcriber.js — Takes audio bytes, calls Minimax Speech, returns text 
 db.js — Initializes SQLite, exports: addBookmark(), addReminder(), getPendingReminders(), markReminderSent(), searchBookmarks(), searchReminders(), listAll(), deleteBookmark(), deleteReminder() 
 scheduler.js — The 30-second polling loop for due reminders 
 responses.js — All response formatting and copy in one place 
 
 
 API Usage
 OpenAI Whisper (Speech-to-Text)
 Core to the voice memo pipeline. iMessage delivers voice memos as .caf files. ffmpeg transcodes .caf → .mp3, then the file is sent to OpenAI Whisper (whisper-1) which returns a transcript. That transcript flows into the same intent classification pipeline as typed messages. Note: Minimax does not offer a public STT API — confirmed 404 on all plausible endpoints.
 Minimax Text
 Does all of the following in a single API call per message:
 Intent classification (bookmark / reminder / query / list_all / delete / conversational)
 Natural language time parsing (converts "in 10 days" or "tomorrow at 6pm" to ISO datetime)
 Urgency detection (high / medium / low based on language)
 Entity tag extraction (normalized keywords like "mom", "birthday", "gym" for smart linking)
 Conversational reply generation (for non-command messages)
 The classification prompt receives the current datetime and the user's message, and returns structured JSON.
 
 
 Response Templates & UX 
 Emoji System 
 📌 Bookmarks 
 ⏰ Reminders 
 ✅ Completed/cancelled 
 🔗 Smart linking (when a reminder connects to a bookmark) 
 Example Responses 
 Bookmark confirmed:  "📌 Bookmarked — Keurig Espresso machine (gift for mom's birthday)" 
 Reminder confirmed:  "⏰ Got it — I'll remind you to pay your credit card bill on April 2nd" 
 Reminder confirmed with smart link:  "⏰ I'll remind you to get mom's birthday gift on Friday — 🔗 you saved a Keurig Espresso machine for that" 
 Urgent reminder confirmed (no explicit time):  "⏰ I'll remind you in 1 hour to call the landlord about the leak — flagged as urgent" 
 Reminder fired:  "Hey — you wanted to pay your credit card bill today" 
 Query result:  "Here's what I've got: 📌 Keurig Espresso machine — mom's birthday (saved 3 days ago)" 
 Query no results:  "I don't have anything saved about that. Want to bookmark something?" 
 List all:  "Here's what you've got going on: 
 📌 Keurig Espresso machine — mom's birthday (saved 3 days ago) 📌 That Thai place on 3rd — date night spot (saved yesterday) 
 ⏰ Pay credit card bill — April 2nd ⏰ Hit the gym — tomorrow at 6pm (urgent) 
 That's 2 bookmarks and 2 reminders." 
 Delete confirmed:  "✅ Removed your gym reminder" 
 Conversational:  "Thanks" → "Anytime 👍" / "Hey" → "Hey! Need to save or remember something?" / "You're the best" → "Just doing my job 😎" 
 Unknown/confused:  "I'm not sure what to do with that. Try 'bookmark [something]' or 'remind me to [something]'" 
 Error/fallback:  "Hmm, I couldn't quite catch that voice memo. Mind sending another one?" 
 
 
 Onboarding 
 First message when a user texts the agent for the first time: 
 "Hey! I'm [Agent Name]. I keep track of things so you don't have to. Try something like: 'Bookmark AirPods Max as a gift for Dad' or 'Remind me to cancel my Netflix trial in 5 days.' You can also just send me a voice memo." 
 
 
 Edge Cases to Handle 
 Duplicate bookmarks:  "You already saved that one — want me to update it?" 
 Vague reminders ("remind me about that thing"):  Ask a clarifying question rather than storing garbage 
 Past reminder times:  "That's already in the past — want me to remind you tomorrow instead?" 
 Multiple matches on delete:  "I found 2 bookmarks about mom — which one? 1) Keurig Espresso machine 2) Flowers from Trader Joe's" 
 Minimax API slow/down:  "Give me a sec..." rather than silent failure 
 Voice memo too garbled:  "I couldn't quite make that out. Mind sending another one or typing it instead?" 
 
 
 Demo Script (2-Minute Video) 
 (10 sec)  User types "bookmark Keurig Espresso machine for mom's birthday." Agent confirms with 📌. 
 (15 sec)  User sends a voice memo: "Remind me to go to the gym tomorrow at 6pm." Agent transcribes and confirms with ⏰. 
 (15 sec)  User sends a voice memo: "I need to call the landlord about the broken sink ASAP." Agent picks up urgency, sets a 1-hour reminder. 
 (15 sec)  User types "remind me to get mom's birthday gift on Friday." Agent confirms AND links to the Keurig bookmark with 🔗. (Wow moment.) 
 (10 sec)  User asks "what am I tracking?" Gets the full grouped list. 
 (10 sec)  The gym reminder fires — agent sends "Time to hit the gym 💪" 
 (5 sec)  User says "thanks." Agent replies "Anytime 👍" 
 (~40 sec)  Intro/outro and transitions. 
 Tip: Pre-load the database with a couple of entries and set a reminder to fire during the demo so the proactive behavior is visible live. 
 
 
 Judging Criteria Alignment 
 Criterion (Weight) 
 Score 
 Product Completeness (25%) 
 Full CRUD lifecycle — create bookmarks/reminders, query, list all, delete. Voice input. Proactive reminders. Smart linking. Error handling. Onboarding. 
 Use of TRAE AI (20%) 
 Entire project built in TRAE. Commit history reflects iterative TRAE-assisted development. Documented in submission description. 
 Use of Minimax (20%)
 Minimax Text API is deeply integrated as the single brain for the agent: intent classification, time parsing, urgency detection, entity extraction, smart linking, and conversational replies — all in one prompt call. Voice transcription uses OpenAI Whisper (Minimax has no public STT API).
 Innovation & Creativity (20%) 
 Smart linking between bookmarks and reminders. Urgency detection from natural language. Voice-memo-native iMessage experience. Agent initiates contact (proactive reminders). 
 Presentation Quality (15%) 
 Single narrative demo arc (not a feature tour). Pre-seeded data for reliability. "One more thing" moment with smart linking reveal. 
 Photon Bonus Track Alignment 
 Quality of messaging experience:  Short, punchy responses. Emoji system. One-line conversational replies. No walls of text. 
 Creative use of Photon SDK:  One directional voice memo support (input via speech). Proactive scheduled messaging. Natural iMessage conversation feel. 
 How naturally the agent fits into conversation:  Casual acknowledgments. Graceful error handling. Onboarding by example, not feature lists.


 Pre-Build Risk Checklist
 Validate these before full development begins — if any of these fail, core project assumptions break.

 CRITICAL — Validate First

 1. Photon SDK / iMessage Works on Your Mac
 Risk: Apple has no official iMessage API. Photon is a third-party tool. If it doesn't work on your specific machine and macOS version, the entire project premise collapses.
 Validate: Get a working "hello world" — send and receive an iMessage programmatically via Photon before writing any other code.
 Watch for: Requires SIP disabled, accessibility permissions, specific macOS version, or Apple ID constraints.

 2. Photon SDK Exposes Voice Memo Audio
 Risk: iMessage voice memos are .m4a files. Photon may not expose raw audio bytes or a file path — it may just surface a message type with no accessible payload.
 Validate: Send a voice memo to yourself and confirm Photon surfaces the audio in a usable format.

 3. Minimax STT Accepts .m4a
 Risk: If Minimax Speech-to-Text doesn't accept .m4a (AAC), you'll need to transcode to wav or mp3 first, adding a dependency.
 Validate: Hit the Minimax STT API with a real .m4a file and confirm it returns a transcript.

 HIGH — Resolve Before Building Core Features

 4. Minimax Text API Returns Reliable Structured JSON
 Risk: Asking one LLM call to do intent classification + time parsing + urgency + entity extraction + conversational reply is a complex prompt. The model may return malformed JSON or collapse under edge cases.
 Validate: Test the classification prompt against at least 10 varied inputs (bookmarks, reminders with relative times, voice-like phrasing, conversational messages). Confirm JSON parses cleanly every time.
 Mitigation: Add try/catch around every JSON.parse() with a fallback to the conversational intent.

 5. Timezone Handling is Consistent End-to-End
 Risk: Time parsing ("in 10 days", "tomorrow at 6pm") requires the prompt to receive the current datetime in the user's local timezone. If stored datetimes and the scheduler's now() are in different timezones, reminders fire at wrong times or never.
 Validate: Confirm the Minimax prompt receives local datetime, all remind_at values are stored as UTC ISO strings, and the scheduler compares in UTC.

 MODERATE — Design Decisions Needed Before Coding

 6. Multi-Turn State for Disambiguation
 Risk: Three features require the next user message to be interpreted as a response to a previous agent question, not a new command — delete with multiple matches, duplicate bookmark confirmation, and vague reminder clarification. The current architecture has no session/conversation state.
 Decision needed: Either implement a simple pending_action state (e.g., one row in a settings table storing the current pending disambiguation), or explicitly cut these edge cases from the MVP and handle them with a best-guess pick instead.

 7. Onboarding Detection Without user_id
 Risk: The plan is single-user with no user_id, but the onboarding flow requires knowing if this is the user's first message ever.
 Fix: Add a settings table (or a single onboarded flag in a config file) that persists across restarts. Check it on every incoming message.

 8. Smart Linking Query Logic (searchByTags)
 Risk: The db.js exports listed in the plan don't include a function for searching bookmarks by entity tag overlap, which is required for smart linking when a reminder is created.
 Fix: Add a searchByEntityTags(tags[]) function to db.js that returns bookmarks whose tags JSON array shares any element with the provided tags.
