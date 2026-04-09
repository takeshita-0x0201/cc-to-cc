#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as net from "node:net";
import { z } from "zod/v4";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------
const BASE_DIR = path.join(
  process.env.CC_TO_CC_DIR ?? path.join(process.env.HOME!, ".cc-to-cc")
);
const REGISTRY_PATH = path.join(BASE_DIR, "registry.json");

function projectDir(projectId: string) {
  return path.join(BASE_DIR, "projects", projectId);
}
function inboxNew(projectId: string) {
  return path.join(projectDir(projectId), "inbox", "new");
}
function inboxCur(projectId: string) {
  return path.join(projectDir(projectId), "inbox", "cur");
}
function inboxArchive(projectId: string) {
  return path.join(projectDir(projectId), "inbox", "archive");
}

// ---------------------------------------------------------------------------
// Registry helpers
// ---------------------------------------------------------------------------
interface ProjectEntry {
  id: string;
  path: string;
  description: string;
  registeredAt: string;
  webhookPort?: number;
}

function readRegistry(): Record<string, ProjectEntry> {
  if (!fs.existsSync(REGISTRY_PATH)) return {};
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf-8"));
}

function writeRegistry(reg: Record<string, ProjectEntry>) {
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

// ---------------------------------------------------------------------------
// Message type
// ---------------------------------------------------------------------------
interface Message {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  threadId: string | null;
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Notification queue — receives push from HTTP webhook
// ---------------------------------------------------------------------------
interface Notification {
  messageId: string;
  from: string;
  subject: string;
  timestamp: string;
}

const pendingNotifications: Notification[] = [];

// Resolvers for watch tool — wake up waiting watchers on push
let watchResolvers: Array<(n: Notification) => void> = [];

function pushNotification(n: Notification) {
  // If someone is watching, wake them up immediately
  if (watchResolvers.length > 0) {
    const resolver = watchResolvers.shift()!;
    resolver(n);
  } else {
    pendingNotifications.push(n);
  }
}

// ---------------------------------------------------------------------------
// HTTP webhook server — receives notifications from other MCP instances
// ---------------------------------------------------------------------------
let webhookServer: http.Server | null = null;
let webhookPort: number | null = null;

function startWebhookServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/notify") {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          try {
            const notification: Notification = JSON.parse(body);
            pushNotification(notification);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(400);
            res.end("Invalid JSON");
          }
        });
        return;
      }
      // Health check
      if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      res.writeHead(404);
      res.end("Not found");
    });

    // Find a random available port
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address() as net.AddressInfo;
      webhookServer = srv;
      webhookPort = addr.port;
      resolve(addr.port);
    });
    srv.on("error", reject);
  });
}

// Send HTTP notification to a peer's webhook
async function notifyPeer(port: number, notification: Notification): Promise<boolean> {
  return new Promise((resolve) => {
    const payload = JSON.stringify(notification);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path: "/notify",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 3000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end(payload);
  });
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "cc-to-cc",
  version: "0.2.0",
});

// --- register --------------------------------------------------------------
server.registerTool(
  "register",
  {
    description:
      "Register this project so other Claude Code sessions can find and message it. Starts a webhook listener for real-time notifications. Run this once per session.",
    inputSchema: {
      id: z
        .string()
        .describe(
          'A short, unique project identifier (e.g. "ad-automation-pro", "prproj-api")'
        ),
      projectPath: z
        .string()
        .describe("Absolute path to the project root directory"),
      description: z
        .string()
        .optional()
        .describe("Short description of what this project is"),
    },
  },
  async ({ id, projectPath, description }) => {
    // Start webhook server if not already running
    if (!webhookServer) {
      await startWebhookServer();
    }

    const reg = readRegistry();
    reg[id] = {
      id,
      path: projectPath,
      description: description ?? "",
      registeredAt: new Date().toISOString(),
      webhookPort: webhookPort!,
    };
    writeRegistry(reg);

    // Ensure inbox dirs exist
    fs.mkdirSync(inboxNew(id), { recursive: true });
    fs.mkdirSync(inboxCur(id), { recursive: true });
    fs.mkdirSync(inboxArchive(id), { recursive: true });

    return {
      content: [
        {
          type: "text" as const,
          text: `Registered project "${id}" (${projectPath}). Webhook listening on port ${webhookPort}. Use the "watch" tool to wait for incoming messages in real-time.`,
        },
      ],
    };
  }
);

// --- list_peers -------------------------------------------------------------
server.registerTool(
  "list_peers",
  {
    description:
      "List all registered projects that you can send messages to.",
    inputSchema: {},
  },
  async () => {
    const reg = readRegistry();
    const entries = Object.values(reg);
    if (entries.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "No projects registered yet." },
        ],
      };
    }
    const lines = entries.map(
      (e) => {
        const status = e.webhookPort ? `webhook:${e.webhookPort}` : "no webhook";
        return `- ${e.id}: ${e.description || "(no description)"} [${e.path}] (${status})`;
      }
    );
    return {
      content: [
        {
          type: "text" as const,
          text: `Registered projects:\n${lines.join("\n")}`,
        },
      ],
    };
  }
);

// --- send -------------------------------------------------------------------
server.registerTool(
  "send",
  {
    description:
      "Send a message to another project's Claude Code session. If the recipient is watching, they will be notified in real-time.",
    inputSchema: {
      to: z
        .string()
        .describe("The project ID to send the message to"),
      from: z
        .string()
        .describe("Your project ID (the sender)"),
      subject: z.string().describe("Short subject line"),
      body: z.string().describe("Message body — be specific and actionable"),
      threadId: z
        .string()
        .optional()
        .describe(
          "Thread ID if replying to an existing conversation. Use the threadId from a received message to continue the thread."
        ),
    },
  },
  async ({ to, from, subject, body, threadId }) => {
    const reg = readRegistry();
    if (!reg[to]) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: project "${to}" is not registered. Use list_peers to see available projects.`,
          },
        ],
      };
    }

    const msg: Message = {
      id: crypto.randomUUID(),
      from,
      to,
      subject,
      body,
      threadId: threadId ?? crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    // Write message to recipient's inbox
    const dir = inboxNew(to);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${msg.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(msg, null, 2));

    // Push webhook notification to recipient if they have an active listener
    let pushStatus = "no webhook";
    const targetPort = reg[to].webhookPort;
    if (targetPort) {
      const notification: Notification = {
        messageId: msg.id,
        from: msg.from,
        subject: msg.subject,
        timestamp: msg.timestamp,
      };
      const ok = await notifyPeer(targetPort, notification);
      pushStatus = ok ? "notified in real-time" : "webhook unreachable (message saved to inbox)";
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Message sent to "${to}" (thread: ${msg.threadId}). Subject: ${subject}. Delivery: ${pushStatus}.`,
        },
      ],
    };
  }
);

// --- inbox ------------------------------------------------------------------
server.registerTool(
  "inbox",
  {
    description:
      "Check your inbox for new messages from other Claude Code sessions.",
    inputSchema: {
      projectId: z.string().describe("Your project ID"),
    },
  },
  async ({ projectId }) => {
    const dir = inboxNew(projectId);
    if (!fs.existsSync(dir)) {
      return {
        content: [
          { type: "text" as const, text: "No inbox found. Register first." },
        ],
      };
    }

    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort();

    if (files.length === 0) {
      return {
        content: [
          { type: "text" as const, text: "Inbox empty. No new messages." },
        ],
      };
    }

    const messages: Message[] = files.map((f) =>
      JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))
    );

    const formatted = messages
      .map(
        (m) =>
          `---\nID: ${m.id}\nFrom: ${m.from}\nSubject: ${m.subject}\nThread: ${m.threadId}\nTime: ${m.timestamp}\n\n${m.body}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${messages.length} new message(s):\n\n${formatted}`,
        },
      ],
    };
  }
);

// --- watch ------------------------------------------------------------------
server.registerTool(
  "watch",
  {
    description:
      "Wait for incoming messages in real-time. Blocks until a new message arrives or timeout is reached. Use this to make your session reactive — when another project sends you a message, this tool returns immediately with the notification. Call this in a loop to continuously listen.",
    inputSchema: {
      projectId: z.string().describe("Your project ID"),
      timeoutSeconds: z
        .number()
        .optional()
        .describe(
          "How long to wait for a message (default: 30 seconds, max: 120 seconds)"
        ),
    },
  },
  async ({ projectId, timeoutSeconds }) => {
    const timeout = Math.min(timeoutSeconds ?? 30, 120) * 1000;

    // Check for already-queued notifications first
    if (pendingNotifications.length > 0) {
      const n = pendingNotifications.shift()!;
      // Read the full message from inbox
      const msgPath = path.join(inboxNew(projectId), `${n.messageId}.json`);
      if (fs.existsSync(msgPath)) {
        const msg: Message = JSON.parse(fs.readFileSync(msgPath, "utf-8"));
        return {
          content: [
            {
              type: "text" as const,
              text: `New message received!\n\n---\nID: ${msg.id}\nFrom: ${msg.from}\nSubject: ${msg.subject}\nThread: ${msg.threadId}\nTime: ${msg.timestamp}\n\n${msg.body}\n\n---\nUse "ack" to acknowledge, then "send" to reply on the same threadId.`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `Notification received from ${n.from}: "${n.subject}" — but message file not found. It may have been already processed.`,
          },
        ],
      };
    }

    // Wait for a webhook push or timeout
    const notification = await new Promise<Notification | null>((resolve) => {
      const timer = setTimeout(() => {
        // Remove this resolver on timeout
        watchResolvers = watchResolvers.filter((r) => r !== resolver);
        resolve(null);
      }, timeout);

      const resolver = (n: Notification) => {
        clearTimeout(timer);
        resolve(n);
      };
      watchResolvers.push(resolver);
    });

    if (!notification) {
      // Timeout — also do a filesystem check as fallback
      const dir = inboxNew(projectId);
      if (fs.existsSync(dir)) {
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
        if (files.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Watch timed out, but found ${files.length} message(s) in inbox. Use "inbox" to read them.`,
              },
            ],
          };
        }
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `No messages received within ${Math.round(timeout / 1000)} seconds. Call "watch" again to keep listening.`,
          },
        ],
      };
    }

    // Got a notification — read the full message
    const msgPath = path.join(inboxNew(projectId), `${notification.messageId}.json`);
    if (fs.existsSync(msgPath)) {
      const msg: Message = JSON.parse(fs.readFileSync(msgPath, "utf-8"));
      return {
        content: [
          {
            type: "text" as const,
            text: `New message received!\n\n---\nID: ${msg.id}\nFrom: ${msg.from}\nSubject: ${msg.subject}\nThread: ${msg.threadId}\nTime: ${msg.timestamp}\n\n${msg.body}\n\n---\nUse "ack" to acknowledge, then "send" to reply on the same threadId.`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Notification from ${notification.from}: "${notification.subject}" — message file not found.`,
        },
      ],
    };
  }
);

// --- ack --------------------------------------------------------------------
server.registerTool(
  "ack",
  {
    description:
      "Acknowledge (mark as read) a message. Moves it from inbox/new to inbox/cur.",
    inputSchema: {
      projectId: z.string().describe("Your project ID"),
      messageId: z
        .string()
        .describe("The message ID to acknowledge"),
      archive: z
        .boolean()
        .optional()
        .describe(
          "If true, move directly to archive instead of cur. Useful for messages that need no further reference."
        ),
    },
  },
  async ({ projectId, messageId, archive: shouldArchive }) => {
    const src = path.join(inboxNew(projectId), `${messageId}.json`);
    if (!fs.existsSync(src)) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Message ${messageId} not found in inbox.`,
          },
        ],
      };
    }

    const destDir = shouldArchive
      ? inboxArchive(projectId)
      : inboxCur(projectId);
    const dst = path.join(destDir, `${messageId}.json`);
    fs.mkdirSync(destDir, { recursive: true });
    fs.renameSync(src, dst);

    const action = shouldArchive ? "acknowledged and archived" : "acknowledged";
    return {
      content: [
        {
          type: "text" as const,
          text: `Message ${messageId} ${action}.`,
        },
      ],
    };
  }
);

// --- archive ----------------------------------------------------------------
server.registerTool(
  "archive",
  {
    description:
      "Archive read messages to keep cur/ clean. Moves messages from cur to archive. Supports archiving by message ID, thread ID, or all at once.",
    inputSchema: {
      projectId: z.string().describe("Your project ID"),
      messageId: z
        .string()
        .optional()
        .describe("Archive a specific message by ID"),
      threadId: z
        .string()
        .optional()
        .describe("Archive all messages in a specific thread"),
      all: z
        .boolean()
        .optional()
        .describe("Archive all messages in cur/"),
    },
  },
  async ({ projectId, messageId, threadId, all: archiveAll }) => {
    const curDir = inboxCur(projectId);
    const archDir = inboxArchive(projectId);
    fs.mkdirSync(archDir, { recursive: true });

    if (!fs.existsSync(curDir)) {
      return {
        content: [
          { type: "text" as const, text: "No read messages to archive." },
        ],
      };
    }

    const files = fs.readdirSync(curDir).filter((f) => f.endsWith(".json"));
    let toArchive: string[] = [];

    if (messageId) {
      const fname = `${messageId}.json`;
      if (files.includes(fname)) {
        toArchive = [fname];
      } else {
        return {
          content: [
            {
              type: "text" as const,
              text: `Message ${messageId} not found in cur/.`,
            },
          ],
        };
      }
    } else if (threadId) {
      toArchive = files.filter((f) => {
        const msg: Message = JSON.parse(
          fs.readFileSync(path.join(curDir, f), "utf-8")
        );
        return msg.threadId === threadId;
      });
      if (toArchive.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No messages found for thread ${threadId}.`,
            },
          ],
        };
      }
    } else if (archiveAll) {
      toArchive = files;
    } else {
      return {
        content: [
          {
            type: "text" as const,
            text: "Specify messageId, threadId, or all: true.",
          },
        ],
      };
    }

    for (const f of toArchive) {
      fs.renameSync(path.join(curDir, f), path.join(archDir, f));
    }

    return {
      content: [
        {
          type: "text" as const,
          text: `Archived ${toArchive.length} message(s).`,
        },
      ],
    };
  }
);

// --- history ----------------------------------------------------------------
server.registerTool(
  "history",
  {
    description:
      "View past (acknowledged) messages, optionally filtered by thread.",
    inputSchema: {
      projectId: z.string().describe("Your project ID"),
      threadId: z
        .string()
        .optional()
        .describe("Filter by thread ID to see a specific conversation"),
      includeArchived: z
        .boolean()
        .optional()
        .describe(
          "Include archived messages in results. Default: false (only shows cur/)."
        ),
    },
  },
  async ({ projectId, threadId, includeArchived }) => {
    const dirs = [inboxCur(projectId)];
    if (includeArchived) {
      dirs.push(inboxArchive(projectId));
    }

    let messages: Message[] = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter((f: string) => f.endsWith(".json"));
      for (const f of files) {
        messages.push(
          JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"))
        );
      }
    }

    if (messages.length === 0) {
      return {
        content: [{ type: "text" as const, text: "No message history." }],
      };
    }

    if (threadId) {
      messages = messages.filter((m) => m.threadId === threadId);
    }

    messages.sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    if (messages.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: threadId
              ? `No messages found for thread ${threadId}.`
              : "No message history.",
          },
        ],
      };
    }

    const formatted = messages
      .map(
        (m) =>
          `---\nID: ${m.id}\nFrom: ${m.from}\nSubject: ${m.subject}\nThread: ${m.threadId}\nTime: ${m.timestamp}\n\n${m.body}`
      )
      .join("\n\n");

    return {
      content: [
        {
          type: "text" as const,
          text: `${messages.length} message(s):\n\n${formatted}`,
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("cc-to-cc server error:", err);
  process.exit(1);
});
