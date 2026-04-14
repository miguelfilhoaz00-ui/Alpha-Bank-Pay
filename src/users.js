const db = require('./database');

// ==========================
// GERAR CÓDIGO DE INDICAÇÃO
// ==========================
function generateReferralCode() {
  return Math.random().toString(36).substr(2, 8).toUpperCase();
}

// ==========================
// BUSCAR USUÁRIO
// ==========================
function getUser(chatId) {
  return db.prepare('SELECT * FROM users WHERE chatId = ?').get(String(chatId)) || null;
}

// ==========================
// BUSCAR POR CÓDIGO DE INDICAÇÃO
// ==========================
function getUserByReferralCode(code) {
  return db.prepare('SELECT * FROM users WHERE referralCode = ?').get(String(code).toUpperCase()) || null;
}

// ==========================
// CRIAR OU ATUALIZAR USUÁRIO
// Retorna { user, isNew }
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
    return { user: getUser(chatId), isNew: false };
  } else {
    const code = generateReferralCode();
    db.prepare(`
      INSERT INTO users (chatId, firstName, lastName, username, referralCode)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(chatId), firstName || null, lastName || null, username || null, code);
    console.log(`👤 [Users] Novo usuário: ${chatId} (${firstName || 'sem nome'}) — código: ${code}`);
    return { user: getUser(chatId), isNew: true };
  }
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
// BANIR / DESBANIR USUÁRIO
// ==========================
function setBanned(chatId, banned) {
  db.prepare(`
    UPDATE users SET banned = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(banned ? 1 : 0, String(chatId));
  return getUser(chatId);
}

// ==========================
// DEFINIR TAXA DE DEPÓSITO DO USUÁRIO (%)
// Aplicada quando ESTE usuário deposita
// ==========================
function setDepositFee(chatId, fee) {
  db.prepare(`
    UPDATE users SET depositFee = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(Number(fee) || 0, String(chatId));
  return getUser(chatId);
}

// ==========================
// DEFINIR TAXA BASE DO GERENTE (commissionRate)
// % que o DONO garante sobre os depósitos dos clientes deste gerente
// Definido pelo admin — só admin pode alterar
// ==========================
function setCommissionRate(chatId, rate) {
  db.prepare(`
    UPDATE users SET commissionRate = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(Number(rate) || 0, String(chatId));
  return getUser(chatId);
}

// ==========================
// DEFINIR TAXA DO REFERRAL (referralFee)
// % que o GERENTE cobra dos seus clientes indicados
// Deve ser >= commissionRate — validado antes de chamar
// ==========================
function setReferralFee(chatId, fee) {
  db.prepare(`
    UPDATE users SET referralFee = ?, updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(Number(fee) || 0, String(chatId));
  return getUser(chatId);
}

// ==========================
// DEFINIR INDICADOR (referredBy)
// Só aplica se o usuário ainda não tem indicador.
// Também aplica a referralFee do gerente como depositFee do novo usuário.
// ==========================
function setReferredBy(chatId, referrerChatId) {
  const referrer = getUser(referrerChatId);
  if (!referrer) return getUser(chatId);

  // Só registra se ainda não tem indicador
  db.prepare(`
    UPDATE users SET referredBy = ?, updatedAt = datetime('now')
    WHERE chatId = ? AND referredBy IS NULL
  `).run(String(referrerChatId), String(chatId));

  // Aplica automaticamente a taxa do gerente ao novo cliente
  if (referrer.referralFee > 0) {
    db.prepare(`
      UPDATE users SET depositFee = ?, updatedAt = datetime('now')
      WHERE chatId = ?
    `).run(referrer.referralFee, String(chatId));
    console.log(`💸 [Users] Taxa automática aplicada | cliente: ${chatId} | gerente: ${referrerChatId} | ${referrer.referralFee}%`);
  }

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
// AJUSTE FORÇADO DE SALDO (admin)
// amount positivo = crédito, negativo = débito forçado (até 0)
// ==========================
function forceBalance(chatId, delta) {
  db.prepare(`
    UPDATE users SET balance = ROUND(MAX(0, balance + ?), 2), updatedAt = datetime('now')
    WHERE chatId = ?
  `).run(delta, String(chatId));
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
  getUserByReferralCode,
  upsertUser,
  setPixKey,
  setGatewayOverride,
  setBanned,
  setDepositFee,
  setCommissionRate,
  setReferralFee,
  setReferredBy,
  creditBalance,
  debitBalance,
  forceBalance,
  getAllUsers,
};
