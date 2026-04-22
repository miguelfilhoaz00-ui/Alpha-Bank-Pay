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
// NOVAS TABELAS PARA CONTROLES AVANÇADOS
// ==========================
db.exec(`
  CREATE TABLE IF NOT EXISTS transaction_controls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transactionId TEXT UNIQUE,
    chatId TEXT,
    amount REAL,
    pixKey TEXT,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    admin_action_at TEXT NULL,
    admin_notes TEXT,
    cautionary_until TEXT NULL,
    admin_user TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    chatId TEXT PRIMARY KEY,
    auto_approve_limit REAL DEFAULT 1000,
    requires_manual_approval BOOLEAN DEFAULT 0,
    withdrawals_blocked BOOLEAN DEFAULT 0,
    daily_limit REAL DEFAULT 10000,
    monthly_limit REAL DEFAULT 50000,
    alert_high_value REAL DEFAULT 5000,
    alert_new_pix_key BOOLEAN DEFAULT 1,
    alert_multiple_withdrawals BOOLEAN DEFAULT 1,
    alert_night_hours BOOLEAN DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS broadcast_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL,
    sent_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    failed_users TEXT DEFAULT '[]',
    admin_user TEXT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_user TEXT,
    action TEXT,
    target_chatId TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS withdrawal_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    chatId TEXT,
    amount REAL,
    pixKey TEXT,
    pixKeyType TEXT,
    priority TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'queued',
    scheduled_at TEXT NULL,
    processed_at TEXT NULL,
    error_message TEXT NULL,
    retry_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
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
  `ALTER TABLE users ADD COLUMN last_activity   TEXT    DEFAULT CURRENT_TIMESTAMP`,
  `ALTER TABLE users ADD COLUMN preferred_gateway TEXT  DEFAULT 'XPayTech'`,
  `ALTER TABLE users ADD COLUMN preferred_withdrawal_gateway TEXT DEFAULT NULL`,
  `ALTER TABLE transactions ADD COLUMN fee        REAL DEFAULT 0`,
  `ALTER TABLE transactions ADD COLUMN fromChatId TEXT DEFAULT NULL`,
  `ALTER TABLE transactions ADD COLUMN metadata    TEXT DEFAULT NULL`,
];
for (const sql of migrations) {
  try { db.exec(sql); } catch (e) { /* coluna já existe — ignorar */ }
}

// Gerar referralCode para usuários antigos que não possuem
const semCodigo = db.prepare("SELECT chatId FROM users WHERE referralCode IS NULL").all();
if (semCodigo.length > 0) {
  const upd = db.prepare("UPDATE users SET referralCode = ? WHERE chatId = ?");
  for (const u of semCodigo) {
    const code = Math.random().toString(36).substr(2, 8).toUpperCase();
    upd.run(code, u.chatId);
  }
  console.log(`🔗 [DB] Códigos de indicação gerados para ${semCodigo.length} usuário(s).`);
}

console.log('🗄️  [DB] Banco de dados inicializado.');

module.exports = db;
