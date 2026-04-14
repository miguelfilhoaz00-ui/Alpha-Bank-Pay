const db                                               = require('./database');
const { creditBalance, debitBalance, forceBalance, getUser } = require('./users');

const REFERRAL_BONUS = 10; // R$ de bônus para quem indicou

// ==========================
// CRIAR DEPÓSITO PENDENTE
// ==========================
function createDepositTx(chatId, orderId, amount, gateway) {
  const result = db.prepare(`
    INSERT INTO transactions (chatId, orderId, type, amount, gateway, status)
    VALUES (?, ?, 'deposit', ?, ?, 'pending')
  `).run(String(chatId), orderId, amount, gateway);

  return result.lastInsertRowid;
}

// ==========================
// CONFIRMAR DEPÓSITO
// Aplica taxa de depósito e verifica bônus de indicação
// ==========================
function completeDeposit(orderId) {
  const tx = db.prepare(
    "SELECT * FROM transactions WHERE orderId = ? AND type = 'deposit'"
  ).get(orderId);

  if (!tx) return null;

  const user       = getUser(tx.chatId);
  const feePct     = user?.depositFee || 0;
  const feeAmount  = feePct > 0 ? Math.round(tx.amount * feePct / 100 * 100) / 100 : 0;
  const netAmount  = Math.round((tx.amount - feeAmount) * 100) / 100;

  db.prepare(`
    UPDATE transactions
    SET status = 'completed', completedAt = datetime('now'), fee = ?
    WHERE orderId = ? AND type = 'deposit'
  `).run(feeAmount, orderId);

  const updatedUser = creditBalance(tx.chatId, netAmount);
  console.log(`💰 [Wallet] Depósito | chatId: ${tx.chatId} | R$ ${netAmount.toFixed(2)} (taxa: R$ ${feeAmount.toFixed(2)}) | Saldo: R$ ${updatedUser.balance.toFixed(2)}`);

  // Verificar bônus de indicação (apenas no PRIMEIRO depósito)
  let referralBonus = null;
  if (updatedUser.referredBy) {
    const prevCount = db.prepare(`
      SELECT COUNT(*) as cnt FROM transactions
      WHERE chatId = ? AND type = 'deposit' AND status = 'completed' AND orderId != ?
    `).get(String(tx.chatId), orderId).cnt;

    if (prevCount === 0) {
      creditBalance(updatedUser.referredBy, REFERRAL_BONUS);
      db.prepare(`UPDATE users SET referralEarned = ROUND(referralEarned + ?, 2) WHERE chatId = ?`)
        .run(REFERRAL_BONUS, updatedUser.referredBy);
      // Registrar bônus como transação
      db.prepare(`
        INSERT INTO transactions (chatId, type, amount, gateway, status, note, completedAt)
        VALUES (?, 'admin_credit', ?, 'sistema', 'completed', ?, datetime('now'))
      `).run(updatedUser.referredBy, REFERRAL_BONUS, `Bônus indicação — ${updatedUser.firstName || tx.chatId}`);

      referralBonus = { referrerId: updatedUser.referredBy, amount: REFERRAL_BONUS };
      console.log(`🎁 [Wallet] Bônus indicação | referrer: ${updatedUser.referredBy} | R$ ${REFERRAL_BONUS}`);
    }
  }

  return { tx: { ...tx, fee: feeAmount, netAmount }, user: updatedUser, referralBonus };
}

// ==========================
// CRIAR SAQUE
// Debita o saldo antes de enviar para a API
// ==========================
function createWithdrawalTx(chatId, amount, gateway = 'XPayTech') {
  const user = debitBalance(chatId, amount);
  if (!user) return null;

  const result = db.prepare(`
    INSERT INTO transactions (chatId, type, amount, gateway, status)
    VALUES (?, 'withdrawal', ?, ?, 'pending')
  `).run(String(chatId), amount, gateway);

  console.log(`💸 [Wallet] Saque iniciado | chatId: ${chatId} | R$ ${amount.toFixed(2)} | Saldo: R$ ${user.balance.toFixed(2)}`);
  return { txId: result.lastInsertRowid, user };
}

// ==========================
// CONFIRMAR SAQUE
// ==========================
function completeWithdrawal(txId, orderId = null) {
  db.prepare(`
    UPDATE transactions
    SET status = 'completed', orderId = ?, completedAt = datetime('now')
    WHERE id = ?
  `).run(orderId, txId);
}

// ==========================
// FALHA NO SAQUE — ESTORNA O SALDO
// ==========================
function failWithdrawal(txId) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!tx) return;

  creditBalance(tx.chatId, tx.amount);

  db.prepare(`
    UPDATE transactions
    SET status = 'failed', completedAt = datetime('now')
    WHERE id = ?
  `).run(txId);

  console.log(`⚠️  [Wallet] Saque falhou — estornado | chatId: ${tx.chatId} | R$ ${tx.amount.toFixed(2)}`);
}

// ==========================
// AJUSTE MANUAL DE SALDO (admin)
// amount positivo = crédito, negativo = débito
// ==========================
function adminAdjust(chatId, amount, note = 'Ajuste manual') {
  const type = amount >= 0 ? 'admin_credit' : 'admin_debit';
  forceBalance(chatId, amount);

  db.prepare(`
    INSERT INTO transactions (chatId, type, amount, gateway, status, note, completedAt)
    VALUES (?, ?, ?, 'admin', 'completed', ?, datetime('now'))
  `).run(String(chatId), type, Math.abs(amount), note);

  return getUser(chatId);
}

// ==========================
// EXTRATO DO USUÁRIO
// ==========================
function getUserTransactions(chatId, limit = 10) {
  return db.prepare(`
    SELECT * FROM transactions
    WHERE chatId = ?
    ORDER BY createdAt DESC
    LIMIT ?
  `).all(String(chatId), limit);
}

// ==========================
// TODAS AS TRANSAÇÕES (admin)
// ==========================
function getAllTransactions(limit = 100) {
  return db.prepare(`
    SELECT t.*, u.firstName, u.lastName, u.username
    FROM transactions t
    LEFT JOIN users u ON t.chatId = u.chatId
    ORDER BY t.createdAt DESC
    LIMIT ?
  `).all(limit);
}

module.exports = {
  createDepositTx,
  completeDeposit,
  createWithdrawalTx,
  completeWithdrawal,
  failWithdrawal,
  adminAdjust,
  getUserTransactions,
  getAllTransactions,
};
