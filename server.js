require('dotenv').config();

const express     = require('express');
const path        = require('path');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const { getRoute }                                        = require('./src/router');
const { saveOrder, getOrder, deleteOrder }                = require('./src/store');
const { getAll, toggle, updateRange, ready: configReady } = require('./src/config');
const stats                                               = require('./src/stats');
const { getUser, upsertUser, setPixKey, setGatewayOverride, getAllUsers } = require('./src/users');
const { createDepositTx, completeDeposit, createWithdrawalTx, completeWithdrawal, failWithdrawal, getUserTransactions, getAllTransactions } = require('./src/wallet');
const xpaytech                                            = require('./src/providers/xpaytech');

// ==========================
// BOTS
// ==========================
const clientBot = new TelegramBot(process.env.CLIENT_BOT_TOKEN, { polling: false });
const adminBot  = new TelegramBot(process.env.ADMIN_BOT_TOKEN,  { polling: false });

const ADMIN_CHAT_ID  = process.env.ADMIN_CHAT_ID;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const APP_URL        = (process.env.APP_URL || '').replace(/\/$/, '');

// ==========================
// SAQUES PENDENTES (confirmação via inline keyboard)
// Map: chatId (string) → { amount }
// ==========================
const pendingWithdrawals = new Map();

// ==========================
// HELPERS
// ==========================
function formatBRL(value) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(iso) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}
function nowBR() {
  return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

// Detecta tipo de chave PIX automaticamente
function detectPixKeyType(key) {
  if (/@/.test(key))                                             return 'EMAIL';
  if (/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(key))                 return 'CPF';
  if (/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(key))          return 'CNPJ';
  if (/^\d{11}$/.test(key.replace(/\D/g, '')) && key.length <= 11) return 'PHONE';
  if (/^\d{14}$/.test(key.replace(/\D/g, '')))                  return 'CNPJ';
  return 'EVP';
}

// Mascara chave para exibição segura
function maskPixKey(key) {
  if (!key || key.length <= 6) return key;
  return key.slice(0, 3) + '***' + key.slice(-3);
}

// ==========================
// BOT CLIENTE — /start
// ==========================
clientBot.onText(/\/start/, (msg) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'Cliente';

  upsertUser(chatId, {
    firstName: msg.from?.first_name,
    lastName:  msg.from?.last_name,
    username:  msg.from?.username
  });

  clientBot.sendMessage(
    chatId,
    `🏦 *Bem-vindo ao Alpha Bank Pay, ${firstName}!* 🚀\n\n` +
    `Sua carteira digital PIX. Deposite, gerencie seu saldo e saque quando quiser!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Comandos:*\n\n` +
    `💰 /depositar <valor> — Gerar PIX para depósito\n` +
    `💳 /saldo — Ver seu saldo atual\n` +
    `💸 /sacar <valor> — Sacar para sua chave PIX\n` +
    `📋 /extrato — Histórico de transações\n` +
    `🔑 /cadastrar <chave> — Cadastrar chave PIX\n` +
    `🆘 /ajuda — Ajuda completa\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `_Para sacar, primeiro use /cadastrar para registrar sua chave PIX._`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /ajuda
// ==========================
clientBot.onText(/\/ajuda/, (msg) => {
  clientBot.sendMessage(
    msg.chat.id,
    `🆘 *Central de Ajuda — Alpha Bank Pay*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 */depositar <valor>*\n` +
    `  Gera um PIX para depositar na sua conta\n` +
    `  Ex: \`/depositar 500\`\n\n` +
    `💳 */saldo*\n` +
    `  Exibe seu saldo disponível\n\n` +
    `💸 */sacar <valor>*\n` +
    `  Solicita saque para sua chave PIX cadastrada\n` +
    `  Ex: \`/sacar 200\`\n\n` +
    `📋 */extrato*\n` +
    `  Últimas 10 transações\n\n` +
    `🔑 */cadastrar <chave> [tipo]*\n` +
    `  Cadastra chave PIX para saques\n` +
    `  Tipos: CPF, CNPJ, EMAIL, PHONE, EVP\n` +
    `  Ex: \`/cadastrar email@gmail.com\`\n` +
    `  Ex: \`/cadastrar 11999999999 PHONE\`\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /depositar (e alias /pix)
// ==========================
async function handleDepositar(msg, match) {
  const chatId = msg.chat.id;
  const input  = match[1]?.trim().replace(',', '.');
  const valor  = parseFloat(input);

  upsertUser(chatId, {
    firstName: msg.from?.first_name,
    lastName:  msg.from?.last_name,
    username:  msg.from?.username
  });

  if (!input || isNaN(valor) || valor <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Valor inválido!*\n\nUse: \`/depositar <valor>\`\nExemplo: \`/depositar 500\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const route = getRoute(valor, chatId);
  if (!route) {
    return clientBot.sendMessage(
      chatId,
      `⚠️ *Valor não disponível no momento.*\n\n` +
      `Nenhum gateway disponível para *R$ ${formatBRL(valor)}*.\nTente outro valor ou aguarde.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  let loadingMsg;
  try {
    loadingMsg = await clientBot.sendMessage(
      chatId,
      `⏳ *Gerando seu PIX...*\n\n🔄 Aguarde um momento!`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.warn('[/depositar] Erro ao enviar loading:', e.message);
    return;
  }

  try {
    const result = await route.module.createPix(chatId, valor);
    saveOrder(result.orderId, chatId, valor, route.label);
    createDepositTx(chatId, result.orderId, valor, route.label);

    clientBot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

    await clientBot.sendMessage(
      chatId,
      `✅ *PIX de Depósito Gerado!* 🎉\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Valor:* R$ ${formatBRL(valor)}\n` +
      `⏳ *Expira em:* ${result.expiresIn}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 *Copia e Cola PIX:*\n\n` +
      `\`${result.qrCode}\`\n\n` +
      `_👆 Toque no código para copiar!_\n\n` +
      `🔔 _Seu saldo será creditado automaticamente após o pagamento!_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 Copiar Código PIX', copy_text: { text: result.qrCode } }
          ]]
        }
      }
    ).catch(e => console.warn('[/depositar] Erro ao enviar QR:', e.message));

  } catch (err) {
    console.error(`❌ [${route.label}] Erro ao gerar PIX:`, err.response?.data || err.message);
    clientBot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    clientBot.sendMessage(
      chatId,
      `❌ *Erro ao gerar o PIX!*\n\n😕 Algo deu errado. Tente novamente.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
}

clientBot.onText(/\/depositar(?:\s+(.+))?/, handleDepositar);
clientBot.onText(/\/pix(?:\s+(.+))?/,       handleDepositar);

// ==========================
// BOT CLIENTE — /saldo
// ==========================
clientBot.onText(/\/saldo/, (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user) {
    return clientBot.sendMessage(
      chatId,
      `❌ Conta não encontrada. Use /start para criar sua conta.`
    ).catch(() => {});
  }

  const temChave = user.pixKey
    ? `🔑 *Chave PIX:* \`${maskPixKey(user.pixKey)}\` _(${user.pixKeyType})_`
    : `⚠️ _Nenhuma chave PIX cadastrada. Use /cadastrar para sacar._`;

  clientBot.sendMessage(
    chatId,
    `💳 *Sua Conta — Alpha Bank Pay*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 *Nome:* ${user.firstName || 'Não informado'}\n` +
    `💰 *Saldo disponível:* R$ ${formatBRL(user.balance)}\n` +
    `${temChave}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `💰 /depositar — Adicionar saldo\n` +
    `💸 /sacar — Solicitar saque\n` +
    `📋 /extrato — Ver histórico`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /cadastrar <chave> [tipo]
// ==========================
clientBot.onText(/\/cadastrar(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const args   = match[1]?.trim().split(/\s+/);

  if (!args || args.length === 0 || !args[0]) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Uso:* \`/cadastrar <chave_pix> [tipo]\`\n\n` +
      `Tipos aceitos: CPF, CNPJ, EMAIL, PHONE, EVP\n\n` +
      `*Exemplos:*\n` +
      `• \`/cadastrar email@gmail.com\`\n` +
      `• \`/cadastrar 11999999999 PHONE\`\n` +
      `• \`/cadastrar 123.456.789-00 CPF\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const pixKey     = args[0];
  const pixKeyType = args[1] ? args[1].toUpperCase() : detectPixKeyType(pixKey);
  const validos    = ['CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP'];

  if (!validos.includes(pixKeyType)) {
    return clientBot.sendMessage(
      chatId,
      `❌ Tipo inválido: *${pixKeyType}*\n\nUse: CPF, CNPJ, EMAIL, PHONE ou EVP`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  upsertUser(chatId, {
    firstName: msg.from?.first_name,
    lastName:  msg.from?.last_name,
    username:  msg.from?.username
  });

  setPixKey(chatId, pixKey, pixKeyType);
  console.log(`🔑 [Bot] chatId ${chatId} cadastrou chave PIX: ${pixKey} (${pixKeyType})`);

  clientBot.sendMessage(
    chatId,
    `✅ *Chave PIX cadastrada com sucesso!*\n\n` +
    `🔑 *Chave:* \`${pixKey}\`\n` +
    `📌 *Tipo:* ${pixKeyType}\n\n` +
    `Agora você pode usar /sacar para retirar seu saldo!`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /extrato
// ==========================
clientBot.onText(/\/extrato/, (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user) {
    return clientBot.sendMessage(
      chatId, `❌ Conta não encontrada. Use /start para criar sua conta.`
    ).catch(() => {});
  }

  const txs = getUserTransactions(chatId, 10);

  if (!txs || txs.length === 0) {
    return clientBot.sendMessage(
      chatId,
      `📋 *Seu Extrato*\n\n💤 Nenhuma transação ainda.\n\nUse /depositar para adicionar saldo!`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const linhas = txs.map(tx => {
    const tipo  = tx.type === 'deposit' ? '⬇️ Depósito' : '⬆️ Saque';
    const sinal = tx.type === 'deposit' ? '+' : '-';
    const icon  = tx.status === 'completed' ? '✅' : tx.status === 'failed' ? '❌' : '⏳';
    const data  = tx.completedAt ? formatDate(tx.completedAt) : formatDate(tx.createdAt);
    return `${icon} ${tipo} ${sinal}R$ ${formatBRL(tx.amount)}\n   📅 ${data}`;
  }).join('\n\n');

  clientBot.sendMessage(
    chatId,
    `📋 *Extrato — Últimas 10 transações*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n${linhas}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Saldo atual:* R$ ${formatBRL(user.balance)}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /sacar <valor>
// ==========================
clientBot.onText(/\/sacar(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input  = match[1]?.trim().replace(',', '.');
  const valor  = parseFloat(input);
  const user   = getUser(chatId);

  if (!user) {
    return clientBot.sendMessage(
      chatId, `❌ Conta não encontrada. Use /start para criar sua conta.`
    ).catch(() => {});
  }

  if (!input || isNaN(valor) || valor <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Valor inválido!*\n\nUse: \`/sacar <valor>\`\nExemplo: \`/sacar 300\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (valor < 10) {
    return clientBot.sendMessage(
      chatId, `❌ *Valor mínimo de saque é R$ 10,00*`, { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (!user.pixKey) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Você não tem chave PIX cadastrada!*\n\n` +
      `Use /cadastrar para registrar sua chave PIX antes de sacar.\n\n` +
      `Exemplo: \`/cadastrar email@gmail.com\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (user.balance < valor) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Saldo insuficiente!*\n\n` +
      `💰 *Saldo disponível:* R$ ${formatBRL(user.balance)}\n` +
      `💸 *Valor solicitado:* R$ ${formatBRL(valor)}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // Armazena saque pendente e pede confirmação
  pendingWithdrawals.set(String(chatId), { amount: valor });

  clientBot.sendMessage(
    chatId,
    `⚠️ *Confirmar Saque?*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 *Valor:* R$ ${formatBRL(valor)}\n` +
    `🔑 *Destino:* \`${maskPixKey(user.pixKey)}\` _(${user.pixKeyType})_\n` +
    `💳 *Saldo após saque:* R$ ${formatBRL(user.balance - valor)}\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Confirmar saque', callback_data: `confirm_wd_${chatId}` },
          { text: '❌ Cancelar',        callback_data: `cancel_wd_${chatId}` }
        ]]
      }
    }
  ).catch(() => {});
});

// ==========================
// CALLBACK — confirmação de saque
// ==========================
clientBot.on('callback_query', async (query) => {
  const chatId = String(query.message.chat.id);
  const data   = query.data;

  clientBot.answerCallbackQuery(query.id).catch(() => {});

  if (data === `confirm_wd_${chatId}`) {
    const pending = pendingWithdrawals.get(chatId);
    if (!pending) {
      return clientBot.sendMessage(chatId, `❌ Solicitação expirada. Use /sacar novamente.`).catch(() => {});
    }
    pendingWithdrawals.delete(chatId);

    const user = getUser(chatId);
    if (!user || user.balance < pending.amount) {
      return clientBot.sendMessage(
        chatId, `❌ *Saldo insuficiente.* Use /saldo para verificar.`, { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    clientBot.editMessageText(
      `⏳ *Processando saque de R$ ${formatBRL(pending.amount)}...*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});

    // Cria transação (debita saldo)
    const withdrawal = createWithdrawalTx(chatId, pending.amount, 'XPayTech');
    if (!withdrawal) {
      return clientBot.sendMessage(
        chatId, `❌ *Saldo insuficiente.* Use /saldo para verificar.`, { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    try {
      const result = await xpaytech.withdraw(chatId, pending.amount, user.pixKey, user.pixKeyType);
      completeWithdrawal(withdrawal.txId, result.orderId);

      clientBot.editMessageText(
        `✅ *Saque Enviado com Sucesso!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
        `🔑 *Destino:* \`${maskPixKey(user.pixKey)}\`\n` +
        `💳 *Saldo restante:* R$ ${formatBRL(withdrawal.user.balance)}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `_O valor chegará em instantes via PIX!_ 🚀`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
      ).catch(() => {});

      adminBot.sendMessage(
        ADMIN_CHAT_ID,
        `💸 *SAQUE PROCESSADO*\n\n` +
        `👤 *Usuário:* ${user.firstName || chatId}\n` +
        `💰 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
        `🔑 *Chave:* \`${user.pixKey}\` (${user.pixKeyType})\n` +
        `📅 *Data:* ${nowBR()}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

    } catch (err) {
      console.error('❌ [Saque] Erro XPayTech:', err.response?.data || err.message);
      failWithdrawal(withdrawal.txId); // estorna saldo automaticamente

      clientBot.editMessageText(
        `❌ *Erro ao processar o saque.*\n\n` +
        `😕 Seu saldo foi estornado automaticamente.\n` +
        `Tente novamente em instantes.`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
      ).catch(() => {});
    }

  } else if (data === `cancel_wd_${chatId}`) {
    pendingWithdrawals.delete(chatId);
    clientBot.editMessageText(
      `❌ *Saque cancelado.*`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

// Mensagens sem comando
clientBot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/') && !msg.via_bot) {
    clientBot.sendMessage(
      msg.chat.id,
      `👋 Use os comandos:\n\n💰 /depositar <valor>\n💳 /saldo\n💸 /sacar <valor>\n📋 /extrato\n🆘 /ajuda`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

// ==========================
// EXPRESS
// ==========================
const app = express();
app.use(express.json());

function panelAuth(req, res, next) {
  const key = req.headers['x-panel-key'];
  if (!PANEL_PASSWORD || key !== PANEL_PASSWORD) return res.status(401).json({ error: 'Não autorizado.' });
  next();
}

app.get('/painel', (req, res) => res.sendFile(path.join(__dirname, 'panel/index.html')));

// Providers
app.get('/painel/api/providers', panelAuth, (req, res) => res.json(getAll()));

app.post('/painel/api/providers/:id/toggle', panelAuth, (req, res) => {
  const updated = toggle(req.params.id);
  if (!updated) return res.status(404).json({ success: false });
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `🎛️ *PAINEL — GATEWAY ${updated.enabled ? 'LIGADO' : 'DESLIGADO'}*\n🏦 *${updated.label}*\n📅 ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  res.json({ success: true, provider: { id: req.params.id, ...updated } });
});

app.post('/painel/api/providers/:id/range', panelAuth, (req, res) => {
  const { min, max } = req.body;
  const updated = updateRange(req.params.id, Number(min), Number(max));
  if (!updated) return res.status(400).json({ success: false, error: 'Valores inválidos.' });
  res.json({ success: true, provider: { id: req.params.id, ...updated } });
});

app.get('/painel/api/stats', panelAuth, (req, res) => {
  res.json({ today: stats.getToday(), history: stats.getHistory(10) });
});

// Usuários
app.get('/painel/api/users', panelAuth, (req, res) => {
  res.json(getAllUsers());
});

app.post('/painel/api/users/:chatId/gateway', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const updated = setGatewayOverride(req.params.chatId, req.body.gatewayOverride || null);
  console.log(`🎛️  [Painel] Gateway do chatId ${req.params.chatId} → ${req.body.gatewayOverride || 'auto'}`);
  res.json({ success: true, user: updated });
});

// Transações
app.get('/painel/api/transactions', panelAuth, (req, res) => {
  res.json(getAllTransactions(100));
});

// ══════════════════════════════════
// WEBHOOKS DE PAGAMENTO
// ══════════════════════════════════

app.post('/webhook/pagnet', (req, res) => {
  console.log('📥 [PagNet] Postback:', JSON.stringify(req.body));
  try {
    const { externalRef, status } = req.body;
    if (status === 'paid' || status === 'approved')     _notifyPayment(externalRef);
    if (status === 'refused' || status === 'cancelled') _notifyFailed(externalRef);
  } catch (e) { console.error('[PagNet] Erro:', e.message); }
  res.sendStatus(200);
});

app.post('/webhook/fluxopay', (req, res) => {
  console.log('📥 [FluxoPay] Webhook:', JSON.stringify(req.body));
  try {
    const { event, data } = req.body;
    if (event === 'pix_in.completed') {
      _notifyPayment(data.orderId, {
        pagador: data.payer?.name || null,
        cpf:     data.payer?.document || null,
        txId:    data.idTransaction,
        paidAt:  data.paidAt
      });
    }
  } catch (e) { console.error('[FluxoPay] Erro:', e.message); }
  res.sendStatus(200);
});

app.post('/webhook/podpay', (req, res) => {
  console.log('📥 [PodPay] Webhook:', JSON.stringify(req.body));
  try {
    const { event, data } = req.body;
    if (event === 'transaction.paid' && data?.status === 'PAID') {
      _notifyPayment(`podpay_${data.id}`, { txId: data.id, paidAt: data.paidAt });
    }
  } catch (e) { console.error('[PodPay] Erro:', e.message); }
  res.sendStatus(200);
});

app.post('/webhook/sharkbanking', (req, res) => {
  console.log('📥 [SharkBanking] Postback:', JSON.stringify(req.body));
  try {
    const { externalRef, status } = req.body;
    if (status === 'paid' || status === 'approved')     _notifyPayment(externalRef);
    if (status === 'refused' || status === 'cancelled') _notifyFailed(externalRef);
  } catch (e) { console.error('[SharkBanking] Erro:', e.message); }
  res.sendStatus(200);
});

app.post('/webhook/xpaytech', (req, res) => {
  console.log('📥 [XPayTech] Webhook:', JSON.stringify(req.body));
  try {
    const body       = req.body?.data || req.body;
    const externalId = body.externalId;
    const status     = body.status;

    // Ignora pay-outs (saques), processa apenas pay-ins (depósitos)
    if (externalId && externalId.startsWith('xpay_out_')) {
      console.log('ℹ️  [XPayTech] Webhook de pay-out ignorado:', externalId);
      return res.sendStatus(200);
    }

    if (status === 'FINISHED') _notifyPayment(externalId, { txId: body.id });
    if (status === 'CANCELLED' || status === 'TIMEOUT' || status === 'REVERSED') _notifyFailed(externalId);
  } catch (e) { console.error('[XPayTech] Erro:', e.message); }
  res.sendStatus(200);
});

// ══════════════════════════════════
// HELPERS DE NOTIFICAÇÃO
// ══════════════════════════════════

function _notifyPayment(orderId, extra = {}) {
  const order = getOrder(orderId);
  if (!order) {
    console.warn(`⚠️  Order não encontrada: ${orderId}`);
    return;
  }

  const { chatId, amountReais, provider } = order;

  // Credita saldo e marca depósito como concluído
  const depositResult = completeDeposit(orderId);
  const novoSaldo     = depositResult?.user?.balance ?? null;

  const valorFormatado = formatBRL(amountReais);
  const dataHora       = extra.paidAt ? formatDate(extra.paidAt) : nowBR();

  let msgCliente =
    `🎉 *DEPÓSITO CONFIRMADO!* ✅\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Valor depositado:* R$ ${valorFormatado}\n` +
    `📅 *Data:* ${dataHora}\n`;

  if (novoSaldo !== null) {
    msgCliente += `💳 *Saldo atual:* R$ ${formatBRL(novoSaldo)}\n`;
  }

  msgCliente +=
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Use /saldo para ver sua conta ou /sacar para retirar. 🚀`;

  clientBot.sendMessage(chatId, msgCliente, { parse_mode: 'Markdown' })
    .catch(e => console.error('[notify] Erro cliente:', e.message));

  let adminMsg =
    `💸 *NOVO DEPÓSITO RECEBIDO!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Valor:* R$ ${valorFormatado}\n` +
    `🏦 *Gateway:* ${provider}\n`;

  if (extra.pagador) adminMsg += `👤 *Pagador:* ${extra.pagador}\n`;
  if (extra.cpf)     adminMsg += `📄 *CPF:* \`${extra.cpf}\`\n`;
  if (extra.txId)    adminMsg += `🆔 *ID:* \`${extra.txId}\`\n`;
  adminMsg += `📅 *Data:* ${dataHora}\n━━━━━━━━━━━━━━━━━━━━`;

  adminBot.sendMessage(ADMIN_CHAT_ID, adminMsg, { parse_mode: 'Markdown' })
    .catch(e => console.error('[notify] Erro admin:', e.message));

  stats.record({ amountReais, provider, chatId, paidAt: extra.paidAt || null });
  deleteOrder(orderId);
}

function _notifyFailed(orderId) {
  const order = getOrder(orderId);
  if (!order) return;
  clientBot.sendMessage(
    order.chatId,
    `❌ *Depósito não confirmado.*\n\n😕 Sua cobrança foi cancelada ou expirou.\nGere uma nova com /depositar se quiser tentar novamente.`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  deleteOrder(orderId);
}

// ══════════════════════════════════
// ROTAS DE SISTEMA
// ══════════════════════════════════

app.post('/bot/telegram', (req, res) => {
  try { clientBot.processUpdate(req.body); }
  catch (e) { console.error('❌ [Telegram] Erro ao processar update:', e.message); }
  res.sendStatus(200);
});

app.get('/',     (req, res) => res.json({ status: 'ok', bot: 'Alpha Bank Pay', version: '2.0.0' }));
app.get('/ping', (req, res) => res.status(200).send('pong'));

app.get('/webhook-info', async (req, res) => {
  try {
    const r = await axios.get(`https://api.telegram.org/bot${process.env.CLIENT_BOT_TOKEN}/getWebhookInfo`);
    res.json(r.data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==========================
// INICIALIZAÇÃO
// ==========================
const PORT = process.env.PORT || 3000;

configReady.then(() => {
  app.listen(PORT, () => {
    console.log('\n🏦 ═══════════════════════════════════════');
    console.log('      Alpha Bank Pay — Iniciado! 🚀');
    console.log('═══════════════════════════════════════════');
    console.log(`🌐 Porta:   ${PORT}`);
    console.log(`🔗 APP_URL: ${APP_URL || '⚠️ NÃO DEFINIDO'}`);
    console.log(`📅 Horário: ${nowBR()}`);
    console.log('═══════════════════════════════════════════\n');

    if (APP_URL) {
      axios.post(`https://api.telegram.org/bot${process.env.CLIENT_BOT_TOKEN}/setWebhook`, {
        url: `${APP_URL}/bot/telegram`,
        drop_pending_updates: true
      })
        .then(r  => console.log('✅ Webhook Telegram registrado!', JSON.stringify(r.data)))
        .catch(e => console.error('❌ Webhook erro:', e.response?.data || e.message));
    }

    const cfg      = getAll();
    const ativos   = Object.values(cfg).filter(p => p.enabled).map(p => `• ${p.label}`).join('\n');
    const inativos = Object.values(cfg).filter(p => !p.enabled).map(p => `• ${p.label}`).join('\n') || 'Nenhum';

    adminBot.sendMessage(
      ADMIN_CHAT_ID,
      `🟢 *ALPHA BANK PAY — SERVIDOR INICIADO*\n\n📅 *Horário:* ${nowBR()}\n\n✅ *Gateways ativos:*\n${ativos}\n\n⏹️ *Desativados:*\n${inativos}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    if (APP_URL) {
      setInterval(() => {
        axios.get(`${APP_URL}/ping`, { timeout: 10000 }).catch(() => {});
      }, 25 * 1000);
    }

    setInterval(() => {
      console.log(`💓 [Heartbeat] ${nowBR()}`);
    }, 10 * 60 * 1000);
  });
}).catch(e => {
  console.error('❌ Erro fatal na inicialização:', e.message);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => { console.error('⚠️  [unhandledRejection]', reason?.message || reason); });
process.on('uncaughtException',  (err)    => { console.error('⚠️  [uncaughtException]',  err?.message || err); });
