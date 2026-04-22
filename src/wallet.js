const db                                                     = require('./database');
const { creditBalance, debitBalance, forceBalance, getUser } = require('./users');

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
// Lógica de split: taxa total → dono leva commissionRate%, gerente leva o spread
// ==========================
function completeDeposit(orderId) {
  const tx = db.prepare(
    "SELECT * FROM transactions WHERE orderId = ? AND type = 'deposit'"
  ).get(orderId);

  if (!tx) return null;

  const user       = getUser(tx.chatId);
  const feePct     = user?.depositFee || 0;
  const feeAmount  = feePct > 0 ? _round2(tx.amount * feePct / 100) : 0;
  const netAmount  = _round2(tx.amount - feeAmount);

  // Atualiza transação com taxa e status
  db.prepare(`
    UPDATE transactions
    SET status = 'completed', completedAt = datetime('now'), fee = ?
    WHERE orderId = ? AND type = 'deposit'
  `).run(feeAmount, orderId);

  // Credita ao cliente o valor líquido
  const updatedUser = creditBalance(tx.chatId, netAmount);
  console.log(
    `💰 [Wallet] Depósito | chatId: ${tx.chatId} | bruto: R$${tx.amount.toFixed(2)}` +
    ` | taxa: R$${feeAmount.toFixed(2)} (${feePct}%) | líquido: R$${netAmount.toFixed(2)}`
  );

  // ==========================
  // SISTEMA DE COMISSÃO DO GERENTE
  // Split da taxa: ownerCut + managerCommission = feeAmount
  // ==========================
  let commissionResult = null;

  if (updatedUser.referredBy && feeAmount > 0) {
    const manager = getUser(updatedUser.referredBy);

    if (manager && manager.commissionRate > 0) {
      const ownerCut          = _round2(tx.amount * manager.commissionRate / 100);
      const managerCommission = _round2(feeAmount - ownerCut);

      if (managerCommission > 0) {
        // Credita comissão ao gerente
        creditBalance(manager.chatId, managerCommission);

        // Atualiza total ganho por indicações
        db.prepare(`
          UPDATE users SET referralEarned = ROUND(referralEarned + ?, 2)
          WHERE chatId = ?
        `).run(managerCommission, manager.chatId);

        // Registra como transação do tipo commission
        db.prepare(`
          INSERT INTO transactions (chatId, type, amount, gateway, status, note, completedAt, fromChatId)
          VALUES (?, 'commission', ?, 'sistema', 'completed', ?, datetime('now'), ?)
        `).run(
          manager.chatId,
          managerCommission,
          `Comissão de ${updatedUser.firstName || tx.chatId} — ${feePct}% taxa / ${manager.commissionRate}% base`,
          tx.chatId
        );

        commissionResult = {
          managerId:          manager.chatId,
          managerName:        manager.firstName,
          managerCommission,
          ownerCut,
          feePct,
          commissionRatePct:  manager.commissionRate,
        };

        console.log(
          `🤝 [Wallet] Comissão gerente | manager: ${manager.chatId}` +
          ` | comissão: R$${managerCommission.toFixed(2)} (spread ${feePct - manager.commissionRate}%)` +
          ` | dono: R$${ownerCut.toFixed(2)}`
        );
      }
    }
  }

  return {
    tx:               { ...tx, fee: feeAmount, netAmount },
    user:             updatedUser,
    commissionResult, // null se não houve comissão de gerente
  };
}

// ==========================
// CRIAR SAQUE
// Debita saldo antes de enviar para a API
// ==========================
// Nova função que verifica se precisa aprovação antes de debitar
function createWithdrawalTxWithApproval(chatId, amount, pixKey, gateway = 'XPayTech') {
  // Importar função de verificação do server.js
  const needsApproval = require('./server').checkTransactionNeedsApproval;

  // Verificar se precisa aprovação ANTES de debitar
  if (needsApproval && needsApproval(chatId, amount, pixKey)) {
    // NÃO debitar ainda - apenas criar registro de controle
    const transactionId = generateTransactionId();

    const result = db.prepare(`
      INSERT INTO transaction_controls (transactionId, chatId, amount, pixKey, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(transactionId, chatId, amount, pixKey);

    console.log(`⏳ [Wallet] Saque enviado para aprovação | chatId: ${chatId} | R$${amount.toFixed(2)} | ID: ${transactionId}`);

    return {
      needsApproval: true,
      controlId: result.lastInsertRowid,
      transactionId
    };
  }

  // Aprovação automática - usar função original
  return createWithdrawalTx(chatId, amount, gateway);
}

// Função original (mantida para compatibilidade)
function createWithdrawalTx(chatId, amount, gateway = 'XPayTech') {
  const user = debitBalance(chatId, amount);
  if (!user) return null;

  const result = db.prepare(`
    INSERT INTO transactions (chatId, type, amount, gateway, status)
    VALUES (?, 'withdrawal', ?, ?, 'pending')
  `).run(String(chatId), amount, gateway);

  console.log(`💸 [Wallet] Saque iniciado | chatId: ${chatId} | R$${amount.toFixed(2)} | Saldo restante: R$${user.balance.toFixed(2)}`);
  return { txId: result.lastInsertRowid, user };
}

// Gerar ID único para transação (mover aqui se não existir)
function generateTransactionId() {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
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
// FALHA NO SAQUE — ESTORNA SALDO
// ==========================
function failWithdrawal(txId) {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  if (!tx) return;

  creditBalance(tx.chatId, tx.amount);

  db.prepare(`
    UPDATE transactions SET status = 'failed', completedAt = datetime('now')
    WHERE id = ?
  `).run(txId);

  console.log(`⚠️  [Wallet] Saque estornado | chatId: ${tx.chatId} | R$${tx.amount.toFixed(2)}`);
}

// ==========================
// AJUSTE MANUAL DE SALDO (admin)
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

// ==========================
// HELPER
// ==========================
function _round2(v) {
  return Math.round(v * 100) / 100;
}

module.exports = {
  createDepositTx,
  completeDeposit,
  createWithdrawalTx,
  createWithdrawalTxWithApproval,
  completeWithdrawal,
  failWithdrawal,
  adminAdjust,
  getUserTransactions,
  getAllTransactions,
  generateTransactionId,
};
