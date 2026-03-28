🚀 Photon iMessage Kit — Setup Guide
Requirements:
macOS only
Node.js >= 18 or Bun >= 1.0
Full Disk Access permission
Step 1 — Install
For Bun (zero deps): bun add @photon-ai/imessage-kit
For Node.js: npm install @photon-ai/imessage-kit better-sqlite3

Step 2 — Grant Full Disk Access
System Settings → Privacy & Security → Full Disk Access → click "+" → add your IDE/terminal (Cursor, VS Code, Terminal, Warp)

Step 3 — Send your first message
import { IMessageSDK } from '@photon-ai/imessage-kit'
const sdk = new IMessageSDK()
await sdk.send('+1234567890', 'Hello from iMessage Kit!')
await sdk.close()


Step 4 — Try the examples
bun run examples/01-send-text.ts

Full docs & repo: https://github.com/photon-hq/imessage-kit