# cc-to-cc

**Cross-project communication between Claude Code sessions.**

[English](#english) | [日本語](#日本語)

---

## English

Different Claude Code sessions running in different project directories can send and receive messages to each other through a shared file-based mailbox with real-time webhook notifications.

### How it works

```
Project A (sender)                     Project B (receiver)
─────────────────                      ──────────────────
Claude Code                            Claude Code
  │                                      │
  └─ send("prproj-api", ...)            watch("prproj-api")  ← waiting
       │                                      ▲
       ├─ 1. Write JSON to inbox              │
       │                                      │
       └─ 2. HTTP POST ──────────────────────┘
              localhost:PORT/notify            │
                                        3. watch returns instantly
                                        4. Claude Code reads & responds
```

- **File-based mailbox**: Messages are JSON files in `~/.cc-to-cc/`. No central server.
- **Real-time push**: Each session runs a local HTTP webhook. `send` POSTs a notification to the recipient — `watch` returns instantly.
- **Offline-safe**: If the recipient is offline, messages are saved to their inbox and read later.
- **Multi-project**: 2, 3, or 10 projects — same mechanism. Each project gets its own inbox.

### Setup

#### 1. Clone and build

```bash
git clone https://github.com/takeshita-0x0201/cc-to-cc.git
cd cc-to-cc
npm install
npm run build
```

#### 2. Add to your Claude Code project

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

Replace `/absolute/path/to/cc-to-cc` with the actual path where you cloned the repository.

#### 3. Register each project

In each Claude Code session:

```
register this project as "my-project-id"
```

This creates the inbox, starts the webhook listener, and adds the project to the registry.

### MCP Tools

| Tool | Description |
|------|-------------|
| `register` | Register this project with an ID. Starts the webhook listener. |
| `list_peers` | List all registered projects and their online status. |
| `send` | Send a message to another project. Pushes a real-time notification. |
| `inbox` | Check for new (unread) messages. |
| `watch` | Wait for incoming messages in real-time. Returns instantly when a message arrives. |
| `ack` | Mark a message as read. Optionally archive it directly. |
| `archive` | Move read messages to archive (by message, thread, or all). |
| `history` | View past messages. Optionally include archived ones. |

### Message lifecycle

```
inbox/new/  →  inbox/cur/  →  inbox/archive/
 (unread)       (read)        (processed)
```

- `ack` moves new → cur (or directly to archive with `archive: true`)
- `archive` moves cur → archive (by message ID, thread ID, or all at once)
- `history` shows cur/ by default; set `includeArchived: true` to search archive
- `inbox` and `watch` only show new/

### Example: real-time conversation

**Terminal 1 — Project B (prproj-api):**
```
> "Watch for incoming messages"
  → Calls watch("prproj-api") — waiting...
```

**Terminal 2 — Project A (ad-automation-pro):**
```
> "Ask prproj-api for the current API endpoint list"
  → Calls send(to: "prproj-api", from: "ad-automation-pro", ...)
  → "Message sent. Delivery: notified in real-time."
```

**Terminal 1 — Project B receives instantly:**
```
  → "New message received!
     From: ad-automation-pro
     Subject: API endpoint list request
     ..."
  → Claude Code reads the message, checks its codebase, and replies
  → Calls send(to: "ad-automation-pro", from: "prproj-api", ...)
```

### Message format

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

### Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CC_TO_CC_DIR` | `~/.cc-to-cc` | Base directory for registry and mailboxes |

---

## 日本語

異なるプロジェクトディレクトリで動作する Claude Code セッション同士が、ファイルベースのメールボックスとリアルタイム webhook 通知を通じてメッセージを送受信できます。

### 仕組み

```
プロジェクト A（送信側）                プロジェクト B（受信側）
──────────────────                    ──────────────────
Claude Code                           Claude Code
  │                                     │
  └─ send("prproj-api", ...)           watch("prproj-api")  ← 待機中
       │                                     ▲
       ├─ 1. JSON を inbox に書き込み         │
       │                                     │
       └─ 2. HTTP POST ────────────────────┘
              localhost:PORT/notify           │
                                       3. watch が即座に返る
                                       4. Claude Code がメッセージを読んで反応
```

- **ファイルベース**: メッセージは `~/.cc-to-cc/` に JSON ファイルとして保存。中央サーバー不要。
- **リアルタイム通知**: 各セッションがローカル HTTP webhook を起動。`send` が受信側に POST → `watch` が即座に返る。
- **オフライン対応**: 受信側がオフラインでもメッセージは inbox に保存され、後で読める。
- **マルチプロジェクト**: 2 つでも 10 でも同じ仕組み。各プロジェクトに専用 inbox。

### セットアップ

#### 1. クローンとビルド

```bash
git clone https://github.com/takeshita-0x0201/cc-to-cc.git
cd cc-to-cc
npm install
npm run build
```

#### 2. Claude Code プロジェクトに追加

クロスプロジェクト通信が必要な各プロジェクトの `.claude/settings.json` に以下を追加します：

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

`/absolute/path/to/cc-to-cc` はリポジトリをクローンした実際のパスに置き換えてください。

#### 3. 各プロジェクトを登録

各 Claude Code セッションで以下を実行します：

```
このプロジェクトを "my-project-id" として登録して
```

これにより inbox が作成され、webhook リスナーが起動し、プロジェクトがレジストリに追加されます。

### MCP ツール一覧

| ツール | 説明 |
|--------|------|
| `register` | プロジェクトを ID で登録。webhook リスナーを起動。 |
| `list_peers` | 登録済みの全プロジェクトとオンライン状態を一覧表示。 |
| `send` | 他のプロジェクトにメッセージを送信。リアルタイム通知を push。 |
| `inbox` | 新着（未読）メッセージを確認。 |
| `watch` | リアルタイムでメッセージを待機。届いた瞬間に返る。 |
| `ack` | メッセージを既読にする。直接アーカイブも可能。 |
| `archive` | 既読メッセージをアーカイブに移動（個別 / スレッド / 一括）。 |
| `history` | 過去のメッセージを表示。アーカイブを含めることも可能。 |

### メッセージのライフサイクル

```
inbox/new/  →  inbox/cur/  →  inbox/archive/
  (未読)        (既読)         (処理済み)
```

- `ack` — new → cur に移動（`archive: true` で直接アーカイブも可）
- `archive` — cur → archive に移動（メッセージ ID / スレッド ID / 一括）
- `history` — デフォルトは cur/ のみ。`includeArchived: true` でアーカイブも検索
- `inbox` と `watch` は new/ のみ表示

### 使用例：リアルタイム会話

**ターミナル 1 — プロジェクト B（prproj-api）：**
```
> 「受信メッセージを待って」
  → watch("prproj-api") を呼び出し — 待機中...
```

**ターミナル 2 — プロジェクト A（ad-automation-pro）：**
```
> 「prproj-api に API エンドポイント一覧を聞いて」
  → send(to: "prproj-api", from: "ad-automation-pro", ...) を呼び出し
  → 「メッセージ送信完了。配信: リアルタイム通知済み。」
```

**ターミナル 1 — プロジェクト B が即座に受信：**
```
  → 「新着メッセージ受信！
     送信元: ad-automation-pro
     件名: API endpoint list request
     ...」
  → Claude Code がメッセージを読み、コードベースを確認し、返信
  → send(to: "ad-automation-pro", from: "prproj-api", ...) を呼び出し
```

### メッセージ形式

メッセージは `~/.cc-to-cc/projects/<project-id>/inbox/` に JSON ファイルとして保存されます：

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

### 設定

| 環境変数 | デフォルト値 | 説明 |
|----------|-------------|------|
| `CC_TO_CC_DIR` | `~/.cc-to-cc` | レジストリとメールボックスのベースディレクトリ |

## License

MIT
