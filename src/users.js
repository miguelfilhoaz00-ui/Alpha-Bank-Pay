const db = require('./database');

// ==========================
// BUSCAR USUÁRIO
// ==========================
function getUser(chatId) {
  return db.prepare('SELECT * FROM users WHERE chatId = ?').get(String(chatId)) || null;
}

// ==========================
// CRIAR OU ATUALIZAR USUÁRIO
// ==========================
function upsertUser(chatId, { firstName, lastName, username } = {}) {
  const existing = getUser(chatId);

  if (existing) {
    db.prepare(`
      UPDATE users
      SET firstName = ?, lastName = ?, username = ?, updatedAt = datetime('now')
      WHERE chatId = ?
    `).run(
      firstName || existing.firstName,
      lastName  || existing.lastName,
      username  || existing.username,
      String(chatId)
    );
  } else {
    db.prepare(`
      INSERT INTO users (chatId, firstName, lastName, username)
      VALUES (?, ?, ?, ?)
    `).run(String(chatId), firstName || null, lastName || null, username || null);
    console.log(`👤 [Users] Novo usuário registrado: ${chatId} (${firstName || 'sem nome'})`);
  }

  return getUser(chatId);
}

// ==========================
// CADASTRAR CHAVE PIX
// ==========================
function setPixKey(chatId, pixKey, pixKeyType = 'EVP') {
  db.prepare(`
    UPDATE users SET pixKey = ?, pixKeyType = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(pixKey, pixKeyType.toUpperCase(), String(chatId));
  return getUser(chatId);
}

// ==========================
// DEFINIR GATEWAY PREFERENCIAL
// ==========================
function setGatewayOverride(chatId, gatewayOverride) {
  db.prepare(`
    UPDATE users SET gatewayOverride = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(gatewayOverride || null, String(chatId));
  return getUser(chatId);
}

// ==========================
// CREDITAR SALDO
// ==========================
function creditBalance(chatId, amount) {
  db.prepare(`
    UPDATE users SET balance = ROUND(balance + ?, 2), updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(amount, String(chatId));
  return getUser(chatId);
}

// ==========================
// DEBITAR SALDO (retorna null se insuficiente)
// ==========================
function debitBalance(chatId, amount) {
  const user = getUser(chatId);
  if (!user || user.balance < amount) return null;

  db.prepare(`
    UPDATE users SET balance = ROUND(balance - ?, 2), updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(amount, String(chatId));
  return getUser(chatId);
}

// ==========================
// LISTAR TODOS OS USUÁRIOS (admin)
// ==========================
function getAllUsers() {
  return db.prepare('SELECT * FROM users ORDER BY createdAt DESC').all();
}

module.exports = {
  getUser,
  upsertUser,
  setPixKey,
  setGatewayOverride,
  creditBalance,
  debitBalance,
  getAllUsers
};
