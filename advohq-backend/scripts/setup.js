#!/usr/bin/env node
/**
 * AdvoHQ — First-run setup
 * Run once: node scripts/setup.js
 *
 * 1. Generates secure JWT secrets and writes them to .env
 * 2. Creates the first admin user account
 */

'use strict';

const readline = require('readline');
const crypto   = require('crypto');
const fs       = require('fs');
const path     = require('path');
const bcrypt   = require('bcryptjs');

const ROOT    = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

function randomHex(bytes = 64) {
  return crypto.randomBytes(bytes).toString('hex');
}

async function main() {
  console.log('\n  ⚖  AdvoHQ — First-Run Setup\n');

  // ── 1. Generate / update .env ───────────────────────────────────────────────
  let envContent = '';
  if (fs.existsSync(ENV_PATH)) {
    envContent = fs.readFileSync(ENV_PATH, 'utf-8');
    console.log('  Found existing .env — updating secrets only if not already set.\n');
  } else {
    const example = path.join(ROOT, '.env.example');
    envContent = fs.existsSync(example) ? fs.readFileSync(example, 'utf-8') : '';
  }

  function setEnvVar(content, key, value) {
    const regex = new RegExp(`^(${key}=).*`, 'm');
    if (regex.test(content)) {
      // Only overwrite placeholder values
      return content.replace(regex, (match, g1) => {
        if (match.includes('REPLACE') || match.endsWith('=')) {
          return `${g1}${value}`;
        }
        return match; // keep existing real value
      });
    }
    return content + `\n${key}=${value}`;
  }

  envContent = setEnvVar(envContent, 'JWT_ACCESS_SECRET',  randomHex(64));
  envContent = setEnvVar(envContent, 'JWT_REFRESH_SECRET', randomHex(64));

  const port = await ask('  Port [3000]: ');
  envContent = setEnvVar(envContent, 'PORT', port.trim() || '3000');

  const origin = await ask('  Frontend origin [http://localhost:3000]: ');
  envContent = setEnvVar(envContent, 'ALLOWED_ORIGINS', origin.trim() || 'http://localhost:3000');

  const apiKey = await ask('  Anthropic API key (sk-ant-...): ');
  if (apiKey.trim()) envContent = setEnvVar(envContent, 'ANTHROPIC_API_KEY', apiKey.trim());

  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
  console.log('\n  ✓  .env written\n');

  // ── 2. Create first user ─────────────────────────────────────────────────────
  require('dotenv').config({ path: ENV_PATH });
  const db = require('../db'); // initialises schema

  const existingCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  if (existingCount > 0) {
    console.log('  Users already exist — skipping account creation.\n');
    rl.close();
    return;
  }

  console.log('  Create your admin account:\n');

  let username = '';
  while (!username) {
    username = (await ask('  Username: ')).trim();
    if (!/^[a-z0-9_]{3,40}$/i.test(username)) {
      console.log('  ✗  3–40 chars, letters / numbers / underscores only.');
      username = '';
    }
  }

  const displayName = (await ask(`  Display name [${username}]: `)).trim() || username;
  const email       = (await ask('  Email (optional): ')).trim() || null;

  let password = '';
  while (password.length < 8) {
    password = (await ask('  Password (min 8 chars): ')).trim();
    if (password.length < 8) console.log('  ✗  Too short.');
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare(`
    INSERT INTO users (username, display_name, email, password_hash)
    VALUES (?, ?, ?, ?)
  `).run(username, displayName, email, hash);

  console.log(`\n  ✓  Account created: ${username}`);
  console.log('  ✓  AdvoHQ is ready. Run: npm start\n');
  rl.close();
}

main().catch(err => {
  console.error('\n  ✗  Setup failed:', err.message);
  process.exit(1);
});
