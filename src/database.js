const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '../data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'alphabankpay.db'));

// Melhor performance com WAL mode
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==========================
// CRIAÇÃO DAS TABELAS
// ==========================
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    chatId          TEXT PRIMARY KEY,
    firstName       TEXT,
    lastName        TEXT,
    username        TEXT,
    pixKey          TEXT    DEFAULT NULL,
    pixKeyType      TEXT    DEFAULT 'EVP',
    balance         REAL    DEFAULT 0,
    gatewayOverride TEXT    DEFAULT NULL,
    createdAt       TEXT    DEFAULT (datetime('now')),
    updatedAt       TEXT    DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId      TEXT    NOT NULL,
    orderId     TEXT    DEFAULT NULL,
    type        TEXT    NOT NULL,
    amount      REAL    NOT NULL,
    gateway     TEXT    DEFAULT NULL,
    status      TEXT    DEFAULT 'pending',
    note        TEXT    DEFAULT NULL,
    createdAt   TEXT    DEFAULT (datetime('now')),
    completedAt TEXT    DEFAULT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_chatId  ON transactions(chatId);
  CREATE INDEX IF NOT EXISTS idx_tx_orderId ON transactions(orderId);
  CREATE INDEX IF NOT EXISTS idx_tx_status  ON transactions(status);
`);

// ==========================
// MIGRAÇÕES — adiciona colunas sem quebrar DB existente
// ==========================
const migrations = [
  `ALTER TABLE users ADD COLUMN banned          INTEGER DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN depositFee      REAL    DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN referralCode    TEXT    DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN referredBy      TEXT    DEFAULT NULL`,
  `ALTER TABLE users ADD COLUMN referralEarned  REAL    DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN commissionRate  REAL    DEFAULT 0`,
  `ALTER TABLE users ADD COLUMN referralFee     REAL    DEFAULT 0`,
  `ALTER TABLE transactions ADD COLUMN fee      REAL    DEFAULT 0`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* coluna já existe — ignorar */ }
}

console.log('🗄️  [DB] Banco de dados inicializado.');

module.exports = db;
