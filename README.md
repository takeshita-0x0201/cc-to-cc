# cc-to-cc

**Cross-project communication between Claude Code sessions.**

Different Claude Code sessions running in different project directories can send and receive messages to each other through a shared file-based mailbox.

## How it works

```
Claude Code (Project A)          Claude Code (Project B)
        │                                │
   MCP Server                       MCP Server
   (cc-to-cc)                       (cc-to-cc)
        │                                │
        └──── ~/.cc-to-cc/inbox/ ────────┘
                (shared filesystem)
```

Each Claude Code session gets a set of MCP tools (`send`, `inbox`, `list_peers`, etc.). Messages are JSON files written to a shared directory (`~/.cc-to-cc/`). No central server needed — just the filesystem.

## Setup

### 1. Clone and build

```bash
git clone https://github.com/takeshita-0x0201/cc-to-cc.git
cd cc-to-cc
npm install
npm run build
```

### 2. Add to your Claude Code project

Add this to `.claude/settings.json` in each project that needs cross-project communication:

```json
{
  "mcpServers": {
    "cc-to-cc": {
      "command": "node",
      "args": ["/absolute/path/to/cc-to-cc/dist/index.js"]
    }
  }
}
```

### 3. Register each project

In each Claude Code session, run:

```
register this project as "my-project-id"
```

This creates the inbox and adds the project to the registry.

## MCP Tools

| Tool | Description |
|------|-------------|
| `register` | Register this project with an ID so others can find it |
| `list_peers` | List all registered projects |
| `send` | Send a message to another project |
| `inbox` | Check for new messages |
| `ack` | Mark a message as read |
| `history` | View past messages, optionally filtered by thread |

## Example conversation

**In Project A (ad-automation-pro):**
```
"Send a message to prproj-api asking for the current API endpoint list"
```

**In Project B (prproj-api):**
```
"Check my inbox"
→ New message from ad-automation-pro: "Please list current API endpoints"

"Reply with the endpoint list"
```

## Message format

Messages are stored as JSON files in `~/.cc-to-cc/projects/<project-id>/inbox/`:

```json
{
  "id": "uuid",
  "from": "ad-automation-pro",
  "to": "prproj-api",
  "subject": "API endpoint list request",
  "body": "Please check and send me the current API endpoint list.",
  "threadId": "uuid",
  "timestamp": "2026-04-09T12:00:00.000Z"
}
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CC_TO_CC_DIR` | `~/.cc-to-cc` | Base directory for registry and mailboxes |

## License

MIT
