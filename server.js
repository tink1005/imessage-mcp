#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import Database from "better-sqlite3";
import { execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

// --- Config ---

const DB_PATH = join(homedir(), "Library/Messages/chat.db");
const CONFIG_DIR = join(homedir(), ".config/imessage-ai");
const CONTACTS_FILE = join(CONFIG_DIR, "contacts.json");

// --- Contact Management ---

function loadConfig() {
  if (!existsSync(CONTACTS_FILE)) {
    return { contacts: {}, watch: [] };
  }
  return JSON.parse(readFileSync(CONTACTS_FILE, "utf-8"));
}

function saveConfig(config) {
  writeFileSync(CONTACTS_FILE, JSON.stringify(config, null, 2));
}

function resolveContact(nameOrPhone) {
  const config = loadConfig();
  // Direct phone number
  if (nameOrPhone.startsWith("+")) {
    const entry = Object.entries(config.contacts).find(
      ([, c]) => c.phone === nameOrPhone
    );
    return {
      phone: nameOrPhone,
      name: entry ? entry[0] : null,
      service: entry ? entry[1].service : "iMessage",
      chat_id: entry ? entry[1].chat_id : null,
    };
  }
  // Nickname lookup (case-insensitive)
  const key = Object.keys(config.contacts).find(
    (k) => k.toLowerCase() === nameOrPhone.toLowerCase()
  );
  if (key && config.contacts[key]) {
    const c = config.contacts[key];
    return { phone: c.phone, name: key, service: c.service, chat_id: c.chat_id };
  }
  return null;
}

function listContacts() {
  const config = loadConfig();
  return Object.entries(config.contacts).map(([name, c]) => ({
    name,
    phone: c.phone,
    chat_id: c.chat_id,
    service: c.service,
  }));
}

// --- iMessage Decoder ---

function decodeAttributedBody(blob) {
  if (!blob) return null;
  try {
    const marker = Buffer.from("NSString");
    const idx = blob.indexOf(marker);
    if (idx === -1) return null;
    const searchStart = idx + marker.length;
    for (let i = searchStart; i < Math.min(searchStart + 50, blob.length); i++) {
      if (blob[i] === 0x2b) {
        const length = blob[i + 1];
        return blob.slice(i + 2, i + 2 + length).toString("utf-8");
      }
    }
  } catch {
    return null;
  }
  return null;
}

// --- Message Operations ---

function readMessages(chatId, limit = 10, since = null) {
  const db = new Database(DB_PATH, { readonly: true });
  let query, params;

  if (since) {
    query = `
      SELECT m.text, m.attributedBody, m.is_from_me,
        datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as readable_date
      FROM message m
      JOIN chat_message_join cmj ON m.rowid = cmj.message_id
      WHERE cmj.chat_id = ?
      AND datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') > ?
      AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000)
      ORDER BY m.date DESC
      LIMIT ?
    `;
    params = [chatId, since, limit];
  } else {
    query = `
      SELECT m.text, m.attributedBody, m.is_from_me,
        datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as readable_date
      FROM message m
      JOIN chat_message_join cmj ON m.rowid = cmj.message_id
      WHERE cmj.chat_id = ?
      AND (m.associated_message_type IS NULL OR m.associated_message_type < 2000)
      ORDER BY m.date DESC
      LIMIT ?
    `;
    params = [chatId, limit];
  }

  const rows = db.prepare(query).all(...params);
  db.close();

  return rows
    .map((row) => {
      const msg =
        row.text || decodeAttributedBody(row.attributedBody) || "[media/attachment]";
      return {
        sender: row.is_from_me ? "me" : "them",
        message: msg,
        date: row.readable_date,
      };
    })
    .reverse();
}

function sendMessage(phone, message, service) {
  const script = `on run argv
    set recipient to item 1 of argv
    set msg to item 2 of argv
    set serviceType to item 3 of argv
    tell application "Messages"
        if serviceType is "SMS" then
            try
                set targetAccount to 1st account whose service type = SMS
                set targetBuddy to buddy recipient of targetAccount
                send msg to targetBuddy
                return "SMS sent to " & recipient
            on error errMsg
                return "ERROR (SMS): " & errMsg
            end try
        else
            try
                set targetAccount to 1st account whose service type = iMessage
                set targetBuddy to buddy recipient of targetAccount
                send msg to targetBuddy
                return "iMessage sent to " & recipient
            on error
                try
                    set smsAccount to 1st account whose service type = SMS
                    set targetBuddy to buddy recipient of smsAccount
                    send msg to targetBuddy
                    return "SMS sent to " & recipient & " (iMessage unavailable)"
                on error errMsg
                    return "ERROR: " & errMsg
                end try
            end try
        end if
    end tell
end run`;

  const tmpDir = mkdtempSync(join(tmpdir(), "imsg-"));
  const scriptPath = join(tmpDir, "send.applescript");
  writeFileSync(scriptPath, script);

  const result = execFileSync("osascript", [scriptPath, phone, message, service], {
    encoding: "utf-8",
    timeout: 10000,
  }).trim();

  return result;
}

// --- MCP Server ---

const server = new McpServer({
  name: "imessage-ai",
  version: "1.0.0",
});

server.tool(
  "send_imessage",
  "Send an iMessage or SMS. Accepts a nickname (e.g. 'Alex') or phone number (e.g. '+1234567890'). Automatically picks iMessage or SMS based on contact config.",
  {
    to: z
      .string()
      .describe(
        'Nickname from contacts (e.g. "Alex") or phone number in international format (e.g. "+1234567890")'
      ),
    message: z.string().describe("The message text to send"),
  },
  async ({ to, message }) => {
    try {
      const contact = resolveContact(to);
      if (!contact) {
        return {
          content: [
            {
              type: "text",
              text: `Contact "${to}" not found. Use a phone number with country code (e.g. +1234567890) or add them with set_contact first.`,
            },
          ],
          isError: true,
        };
      }
      const result = sendMessage(contact.phone, message, contact.service);
      const label = contact.name ? `${contact.name} (${contact.phone})` : contact.phone;
      return { content: [{ type: "text", text: `${result} — ${label}` }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "read_imessages",
  "Read recent messages from a contact. Accepts a nickname or chat ID. Run list_contacts or list_recent_chats to find the right identifier.",
  {
    contact: z
      .string()
      .describe(
        'Nickname (e.g. "Alex") or chat ID number as string (e.g. "26"). Use list_contacts to see available nicknames.'
      ),
    limit: z
      .number()
      .optional()
      .default(10)
      .describe("Number of messages to fetch (default 10)"),
    since: z
      .string()
      .optional()
      .describe(
        'Only messages after this timestamp, e.g. "2026-03-03 20:00:00"'
      ),
  },
  async ({ contact, limit, since }) => {
    try {
      let chatId;
      // Try as nickname first
      const resolved = resolveContact(contact);
      if (resolved && resolved.chat_id) {
        chatId = resolved.chat_id;
      } else {
        // Try as raw chat ID
        const parsed = parseInt(contact, 10);
        if (!isNaN(parsed)) {
          chatId = parsed;
        } else {
          return {
            content: [
              {
                type: "text",
                text: `Could not resolve "${contact}". Use list_contacts to see nicknames or list_recent_chats for chat IDs.`,
              },
            ],
            isError: true,
          };
        }
      }

      const messages = readMessages(chatId, limit, since || null);
      if (messages.length === 0) {
        return { content: [{ type: "text", text: "No messages found." }] };
      }
      const formatted = messages
        .map((m) => `[${m.date}] ${m.sender}: ${m.message}`)
        .join("\n");
      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_recent_chats",
  "List the most recent iMessage/SMS chats with their chat IDs. Useful for discovering chat IDs to use with read_imessages.",
  {
    limit: z
      .number()
      .optional()
      .default(15)
      .describe("Number of recent chats to show"),
  },
  async ({ limit }) => {
    try {
      const db = new Database(DB_PATH, { readonly: true });
      const rows = db
        .prepare(
          `
        SELECT c.rowid as chat_id, c.chat_identifier, c.display_name,
          datetime(max(m.date)/1000000000 + 978307200, 'unixepoch', 'localtime') as last_msg
        FROM chat c
        JOIN chat_message_join cmj ON c.rowid = cmj.chat_id
        JOIN message m ON cmj.message_id = m.rowid
        GROUP BY c.rowid
        ORDER BY max(m.date) DESC
        LIMIT ?
      `
        )
        .all(limit);
      db.close();

      const formatted = rows
        .map(
          (r) =>
            `Chat ${r.chat_id}: ${r.chat_identifier}${r.display_name ? ` (${r.display_name})` : ""} — last: ${r.last_msg}`
        )
        .join("\n");
      return { content: [{ type: "text", text: formatted }] };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }
);

server.tool(
  "list_contacts",
  "List all configured contacts with their nicknames, phone numbers, chat IDs, and service type (iMessage/SMS).",
  {},
  async () => {
    const contacts = listContacts();
    if (contacts.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: 'No contacts configured. Use set_contact to add contacts, or run "npm run setup" for interactive setup.',
          },
        ],
      };
    }
    const formatted = contacts
      .map(
        (c) =>
          `${c.name}: ${c.phone} (chat ${c.chat_id ?? "unknown"}) [${c.service}]`
      )
      .join("\n");
    return { content: [{ type: "text", text: formatted }] };
  }
);

server.tool(
  "set_contact",
  "Add or update a contact with a nickname, phone number, optional chat ID, and service type.",
  {
    name: z.string().describe('Nickname for the contact (e.g. "Alex")'),
    phone: z
      .string()
      .describe(
        'Phone number in international format (e.g. "+1234567890")'
      ),
    chat_id: z
      .number()
      .optional()
      .describe(
        "iMessage chat ID (find with list_recent_chats). Needed for reading messages."
      ),
    service: z
      .enum(["iMessage", "SMS"])
      .optional()
      .default("iMessage")
      .describe("Service type — use SMS for Android contacts"),
  },
  async ({ name, phone, chat_id, service }) => {
    const config = loadConfig();
    config.contacts[name] = {
      phone,
      chat_id: chat_id ?? config.contacts[name]?.chat_id ?? null,
      service: service ?? "iMessage",
    };
    saveConfig(config);
    return {
      content: [
        {
          type: "text",
          text: `Contact saved: ${name} → ${phone} [${service}]${chat_id ? ` (chat ${chat_id})` : ""}`,
        },
      ],
    };
  }
);

// Start
const transport = new StdioServerTransport();
await server.connect(transport);
