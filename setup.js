#!/usr/bin/env node

/**
 * imessage-mcp setup wizard
 *
 * Interactive setup that:
 * 1. Checks Messages.app access
 * 2. Lists your recent chats
 * 3. Lets you pick contacts and assign nicknames
 * 4. Detects iMessage vs SMS
 * 5. Writes config to ~/.config/imessage-mcp/contacts.json
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

const DB_PATH = join(homedir(), "Library/Messages/chat.db");
const CONFIG_DIR = join(homedir(), ".config/imessage-mcp");
const CONTACTS_FILE = join(CONFIG_DIR, "contacts.json");

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function main() {
  console.log("\n  imessage-mcp setup\n");
  console.log("  This wizard will help you configure your contacts.\n");

  // Step 1: Check database access
  if (!existsSync(DB_PATH)) {
    console.log("  ERROR: Cannot find Messages database at:");
    console.log(`  ${DB_PATH}\n`);
    console.log("  Make sure:");
    console.log("  - You're on macOS");
    console.log("  - Terminal has Full Disk Access (System Settings > Privacy & Security)");
    rl.close();
    process.exit(1);
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true });
  } catch (err) {
    console.log("  ERROR: Cannot open Messages database.\n");
    console.log("  Grant Full Disk Access to Terminal:");
    console.log("  System Settings > Privacy & Security > Full Disk Access > Terminal\n");
    console.log(`  (${err.message})`);
    rl.close();
    process.exit(1);
  }

  console.log("  Messages database found and accessible.\n");

  // Step 2: List recent chats
  const chats = db
    .prepare(
      `
    SELECT c.rowid as chat_id, c.chat_identifier, c.display_name,
      datetime(max(m.date)/1000000000 + 978307200, 'unixepoch', 'localtime') as last_msg,
      count(m.rowid) as msg_count
    FROM chat c
    JOIN chat_message_join cmj ON c.rowid = cmj.chat_id
    JOIN message m ON cmj.message_id = m.rowid
    WHERE c.chat_identifier LIKE '+%'
    GROUP BY c.rowid
    ORDER BY max(m.date) DESC
    LIMIT 20
  `
    )
    .all();

  db.close();

  if (chats.length === 0) {
    console.log("  No message chats found.\n");
    rl.close();
    process.exit(0);
  }

  console.log("  Your recent chats:\n");
  chats.forEach((c, i) => {
    const display = c.display_name ? ` (${c.display_name})` : "";
    console.log(
      `  ${String(i + 1).padStart(3)}. ${c.chat_identifier}${display} — ${c.msg_count} msgs, last: ${c.last_msg} [chat ${c.chat_id}]`
    );
  });

  // Step 3: Load existing config
  let config = { contacts: {}, watch: [] };
  if (existsSync(CONTACTS_FILE)) {
    try {
      config = JSON.parse(readFileSync(CONTACTS_FILE, "utf-8"));
      console.log(`\n  Loaded existing config (${Object.keys(config.contacts).length} contacts).`);
    } catch {
      // Start fresh
    }
  }

  // Step 4: Add contacts
  console.log("\n  Add contacts by entering the number next to each chat.");
  console.log('  Type "done" when finished.\n');

  while (true) {
    const input = await ask("  Chat # (or 'done'): ");
    if (input.toLowerCase() === "done" || input === "") break;

    const idx = parseInt(input, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= chats.length) {
      console.log("  Invalid number, try again.");
      continue;
    }

    const chat = chats[idx];
    const nickname = await ask(`  Nickname for ${chat.chat_identifier}: `);
    if (!nickname.trim()) {
      console.log("  Skipped.");
      continue;
    }

    const serviceInput = await ask("  Service — (i)Message or (s)MS? [i]: ");
    const service =
      serviceInput.toLowerCase() === "s" || serviceInput.toLowerCase() === "sms"
        ? "SMS"
        : "iMessage";

    const watchInput = await ask("  Watch for new messages? (y/n) [y]: ");
    const shouldWatch = watchInput.toLowerCase() !== "n";

    config.contacts[nickname.trim()] = {
      phone: chat.chat_identifier,
      chat_id: chat.chat_id,
      service,
    };

    if (shouldWatch && !config.watch.includes(nickname.trim())) {
      config.watch.push(nickname.trim());
    }

    console.log(
      `  Added: ${nickname.trim()} → ${chat.chat_identifier} [${service}]${shouldWatch ? " (watching)" : ""}\n`
    );
  }

  // Step 5: Save config
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONTACTS_FILE, JSON.stringify(config, null, 2));

  console.log(`\n  Config saved to ${CONTACTS_FILE}`);
  console.log(`  ${Object.keys(config.contacts).length} contacts, ${config.watch.length} watched.\n`);
  console.log("  Add to Claude Code:");
  console.log('  claude mcp add --scope user imessage -- node "/path/to/imessage-mcp/server.js"\n');
  console.log("  Or install globally:");
  console.log("  npm install -g imessage-mcp");
  console.log("  claude mcp add --scope user imessage -- npx imessage-mcp\n");

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});
