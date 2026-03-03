# imessage-ai

### Let AI send and read your iMessages. From the terminal. On macOS.

Your AI assistant can now text people for you — iMessage and SMS — straight from the command line. No Apple API needed. No jailbreak. Just works.

Built as an [MCP server](https://modelcontextprotocol.io/) for [Claude Code](https://claude.ai/code), but compatible with any MCP client.

```
You:   "Tell Alex I'm running 10 minutes late"
Claude: iMessage sent to Alex (+1234567890)
```

```
You:   "What did Jordan say?"
Claude: [5:42 PM] Jordan: are we still on for tonight?
        [5:43 PM] Jordan: bring snacks
```

---

## Features

- **Send iMessages and SMS** by nickname or phone number — no need to pick up your phone
- **Read messages** from any conversation — Claude can check your texts for you
- **Smart iMessage/SMS routing** — automatically picks the right protocol per contact
- **Nickname system** — say `"text Mom"` not `"text +1234567890"`
- **Interactive setup wizard** — scans your Messages app and configures everything
- **No API keys needed** — reads the local Messages database and sends via AppleScript
- **Secure** — no data leaves your machine, no cloud services, no third-party servers

---

## Quick Start

### 1. Install

```bash
npm install -g imessage-ai
```

Or clone locally:

```bash
git clone https://github.com/tink1005/imessage-ai.git
cd imessage-ai
npm install
```

### 2. Grant Full Disk Access

Your terminal needs access to the Messages database:

**System Settings → Privacy & Security → Full Disk Access → Terminal** (toggle on)

### 3. Run Setup

```bash
npx imessage-ai-setup
```

Or if cloned locally:

```bash
npm run setup
```

The wizard will:
- Verify Messages.app access
- List your recent conversations
- Let you pick contacts, assign nicknames, and choose iMessage vs SMS
- Save config to `~/.config/imessage-ai/contacts.json`

### 4. Connect to Claude Code

```bash
claude mcp add --scope user imessage -- npx imessage-ai
```

Or with a local install:

```bash
claude mcp add --scope user imessage -- node /path/to/imessage-ai/server.js
```

Restart Claude Code. Done. Your AI can now text people for you.

---

## Tools

| Tool | What it does |
|------|-------------|
| `send_imessage` | Send a message by nickname or phone number. Auto-routes iMessage vs SMS. |
| `read_imessages` | Read recent messages from any contact or chat. |
| `list_recent_chats` | Discover your conversations and their chat IDs. |
| `list_contacts` | Show all configured contacts with nicknames. |
| `set_contact` | Add or update a contact — name, number, iMessage/SMS preference. |

### Usage Examples

| You say | What happens |
|---------|-------------|
| "Send Alex 'on my way'" | Resolves Alex → sends via iMessage |
| "Text Jordan 'see you at 8'" | Resolves Jordan → sends via SMS (Android contact) |
| "Read my messages from Alex" | Returns last 10 messages from Alex's chat |
| "Has Mom texted me today?" | Reads messages with time filter |
| "Add a contact: Sam, +1555123456, SMS" | Saves contact for future use |

---

## How It Works

```
┌─────────────┐     ┌──────────────┐     ┌──────────────────┐
│  Claude Code │────▸│ imessage-ai │────▸│   Messages.app   │
│  (MCP client)│◂────│ (MCP server) │◂────│ (iMessage / SMS) │
└─────────────┘     └──────────────┘     └──────────────────┘
                           │
                           ▼
                    ~/Library/Messages/
                        chat.db
```

- **Reading**: Queries `~/Library/Messages/chat.db` (SQLite) directly. Decodes Apple's `attributedBody` NSTypedStream format to extract message text — the same binary blobs that Messages.app uses internally.
- **Sending**: Uses `osascript` (AppleScript) to send through Messages.app. All arguments are passed via `execFileSync` with explicit argument arrays — no shell interpolation, no injection risk.
- **SMS routing**: Messages marked as SMS route through your iPhone's [Text Message Forwarding](https://support.apple.com/en-us/HT208386) relay — your Mac sends via your phone's cellular connection.

---

## Config

Contacts are stored at `~/.config/imessage-ai/contacts.json`:

```json
{
  "contacts": {
    "Alex": {
      "phone": "+1234567890",
      "chat_id": 26,
      "service": "iMessage"
    },
    "Jordan": {
      "phone": "+0987654321",
      "chat_id": 42,
      "service": "SMS"
    }
  },
  "watch": ["Alex", "Jordan"]
}
```

| Field | Description |
|-------|-------------|
| `phone` | International format with country code |
| `chat_id` | Internal Messages.app ID (auto-detected by setup wizard) |
| `service` | `"iMessage"` for Apple users, `"SMS"` for Android |
| `watch` | Contacts to monitor for incoming messages |

---

## Requirements

| Requirement | Details |
|-------------|---------|
| **OS** | macOS 15+ (Sequoia). May work on earlier versions. |
| **Node.js** | 18 or higher |
| **Messages.app** | Signed into iMessage with your Apple ID |
| **Full Disk Access** | Terminal must have FDA in System Settings |
| **iPhone** | Required for SMS — enable Text Message Forwarding |

---

## Privacy & Security

- **Everything stays local.** No data is sent to any external server.
- **No API keys.** Reads the Messages database directly on your Mac.
- **No cloud.** Your messages never leave your machine.
- **Injection-safe.** Uses `execFileSync` with argument arrays, not shell string interpolation.
- **Config is gitignored.** Your `contacts.json` with real numbers is never committed.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "Cannot open Messages database" | Grant Full Disk Access: System Settings → Privacy & Security → Full Disk Access → Terminal |
| "buddy not found" | Send the person a message manually first in Messages.app, then retry |
| iMessage shows "Not Delivered" | Contact is on Android — use `set_contact` to mark them as SMS |
| SMS not working | Enable Text Message Forwarding on iPhone: Settings → Messages → Text Message Forwarding → your Mac |
| Setup wizard shows no chats | Check FDA permissions and ensure Messages.app has message history |

---

## Contributing

PRs welcome. If you build something cool with this, let me know.

## License

MIT

---

**Built with Claude Code.** Because typing on your phone is overrated.
