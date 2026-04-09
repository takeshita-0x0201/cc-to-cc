# cc-to-cc

**Cross-project communication between Claude Code sessions.**

[English](#english) | [日本語](#日本語)

---

## English

Different Claude Code sessions running in different project directories can send and receive messages to each other through a shared file-based mailbox.

### How it works

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

In each Claude Code session, run:

```
register this project as "my-project-id"
```

This creates the inbox and adds the project to the registry.

### MCP Tools

| Tool | Description |
|------|-------------|
| `register` | Register this project with an ID so others can find it |
| `list_peers` | List all registered projects |
| `send` | Send a message to another project |
| `inbox` | Check for new messages |
| `ack` | Mark a message as read |
| `history` | View past messages, optionally filtered by thread |

### Example conversation

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

異なるプロジェクトディレクトリで動作する Claude Code セッション同士が、ファイルベースのメールボックスを通じてメッセージを送受信できます。

### 仕組み

```
Claude Code (プロジェクトA)       Claude Code (プロジェクトB)
        │                                │
   MCP サーバー                     MCP サーバー
   (cc-to-cc)                       (cc-to-cc)
        │                                │
        └──── ~/.cc-to-cc/inbox/ ────────┘
              (共有ファイルシステム)
```

各 Claude Code セッションに MCP ツール（`send`, `inbox`, `list_peers` 等）が追加されます。メッセージは共有ディレクトリ（`~/.cc-to-cc/`）に JSON ファイルとして保存されます。中央サーバーは不要で、ファイルシステムだけで動作します。

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

これにより inbox が作成され、プロジェクトがレジストリに追加されます。

### MCP ツール一覧

| ツール | 説明 |
|--------|------|
| `register` | プロジェクトを ID で登録し、他のセッションから発見可能にする |
| `list_peers` | 登録済みの全プロジェクトを一覧表示 |
| `send` | 他のプロジェクトにメッセージを送信 |
| `inbox` | 新着メッセージを確認 |
| `ack` | メッセージを既読にする |
| `history` | 過去のメッセージを表示（スレッドでフィルタ可能） |

### 使用例

**プロジェクト A（ad-automation-pro）にて：**
```
「prproj-api に現在の API エンドポイント一覧を聞いて」
```

**プロジェクト B（prproj-api）にて：**
```
「受信箱を確認して」
→ ad-automation-pro からの新着メッセージ：「API エンドポイント一覧を教えてください」

「エンドポイント一覧を返信して」
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
