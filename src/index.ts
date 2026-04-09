#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
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
// MCP Server
// ---------------------------------------------------------------------------
const server = new McpServer({
  name: "cc-to-cc",
  version: "0.1.0",
});

// --- register --------------------------------------------------------------
server.registerTool(
  "register",
  {
    description:
      "Register this project so other Claude Code sessions can find and message it. Run this once per project.",
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
    const reg = readRegistry();
    reg[id] = {
      id,
      path: projectPath,
      description: description ?? "",
      registeredAt: new Date().toISOString(),
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
          text: `Registered project "${id}" (${projectPath}). Inbox ready at ${projectDir(id)}/inbox/`,
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
      (e) => `- ${e.id}: ${e.description || "(no description)"} [${e.path}]`
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
      "Send a message to another project's Claude Code session.",
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

    const dir = inboxNew(to);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${msg.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(msg, null, 2));

    return {
      content: [
        {
          type: "text" as const,
          text: `Message sent to "${to}" (thread: ${msg.threadId}). Subject: ${subject}`,
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
