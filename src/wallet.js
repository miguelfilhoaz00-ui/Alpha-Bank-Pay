const db                                         = require('./database');
const { creditBalance, debitBalance, getUser }   = require('./users');

// ==========================
// CRIAR DEPÓSITO PENDENTE
// Chamado quando o PIX é gerado, antes do pagamento
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
// Chamado quando o webhook de pagamento chega
// ==========================
function completeDeposit(orderId) {
  const tx = db.prepare(
    "SELECT * FROM transactions WHERE orderId = ? AND type = 'deposit'"
  ).get(orderId);

  if (!tx) return null;

  db.prepare(`
    UPDATE transactions
    SET status = 'completed', completedAt = datetime('now')
    WHERE orderId = ? AND type = 'deposit'
  `).run(orderId);

  // Creditar saldo do usuário
  const user = creditBalance(tx.chatId, tx.amount);
  console.log(`💰 [Wallet] Depósito confirmado | chatId: ${tx.chatId} | R$ ${tx.amount.toFixed(2)} | Saldo: R$ ${user.balance.toFixed(2)}`);
  return { tx, user };
}

// ==========================
// CRIAR SAQUE
// Debita o saldo antes de enviar para a API
// ==========================
function createWithdrawalTx(chatId, amount, gateway = 'XPayTech') {
  const user = debitBalance(chatId, amount);
  if (!user) return null; // saldo insuficiente

  const result = db.prepare(`
    INSERT INTO transactions (chatId, type, amount, gateway, status)
    VALUES (?, 'withdrawal', ?, ?, 'pending')
  `).run(String(chatId), amount, gateway);

  console.log(`💸 [Wallet] Saque iniciado | chatId: ${chatId} | R$ ${amount.toFixed(2)} | Saldo restante: R$ ${user.balance.toFixed(2)}`);
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

  // Estornar o valor para o saldo
  creditBalance(tx.chatId, tx.amount);

  db.prepare(`
    UPDATE transactions
    SET status = 'failed', completedAt = datetime('now')
    WHERE id = ?
  `).run(txId);

  console.log(`⚠️  [Wallet] Saque falhou — estornado | chatId: ${tx.chatId} | R$ ${tx.amount.toFixed(2)}`);
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
  getUserTransactions,
  getAllTransactions
};
