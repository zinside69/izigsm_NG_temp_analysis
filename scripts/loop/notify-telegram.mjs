#!/usr/bin/env node
// notify-telegram.mjs - envoie une notification Telegram pour la loop-engineering iziGSM.
//
// Usage : node scripts/loop/notify-telegram.mjs "<message>"
//
// Config lue depuis scripts/loop/telegram.local.json (botToken, chatId) - fichier
// local, gitignore, jamais commite. Volontairement non bloquant : toute erreur
// (config absente, reseau, API Telegram) est loggee sur stderr et le script sort en
// 0, pour ne jamais faire echouer run-loop.ps1/watchdog.ps1 a cause d'une notif.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = join(__dirname, 'telegram.local.json');

const message = process.argv.slice(2).join(' ');
if (!message) {
  console.error('[notify-telegram] usage: node notify-telegram.mjs "<message>"');
  process.exit(0);
}

let config;
try {
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} catch {
  console.error('[notify-telegram] telegram.local.json introuvable ou invalide - notification ignoree (non bloquant).');
  process.exit(0);
}

const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

try {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: config.chatId, text: message }),
  });
  if (!res.ok) {
    const body = await res.text();
    console.error(`[notify-telegram] echec envoi (HTTP ${res.status}): ${body} - non bloquant.`);
  } else {
    console.log('[notify-telegram] notification envoyee.');
  }
} catch (err) {
  console.error(`[notify-telegram] erreur reseau: ${err.message} - non bloquant.`);
}
