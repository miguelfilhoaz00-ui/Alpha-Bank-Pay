require('dotenv').config();

const express     = require('express');
const path        = require('path');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const { getRoute }                                    = require('./src/router');
const { saveOrder, getOrder, deleteOrder }            = require('./src/store');
const { getAll, toggle, updateRange, ready: configReady } = require('./src/config');
const stats                                           = require('./src/stats');

// ==========================
// BOTS
// ==========================
const clientBot = new TelegramBot(process.env.CLIENT_BOT_TOKEN, { polling: false });
const adminBot  = new TelegramBot(process.env.ADMIN_BOT_TOKEN,  { polling: false });

const ADMIN_CHAT_ID  = process.env.ADMIN_CHAT_ID;
const PANEL_PASSWORD = process.env.PANEL_PASSWORD;
const APP_URL        = (process.env.APP_URL || '').replace(/\/$/, '');

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

// ==========================
// BOT CLIENTE — COMANDOS
// ==========================

clientBot.onText(/\/start/, (msg) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'Cliente';
  clientBot.sendMessage(
    chatId,
    `👋 *Olá, ${firstName}! Bem-vindo ao CopyPix!* 🚀\n\n` +
    `Sou seu assistente de pagamentos PIX. Gero cobranças na hora, de forma rápida e segura! 💳\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Como usar:*\n` +
    `👉 /pix <valor>\n\n` +
    `💡 *Exemplos:*\n` +
    `• \`/pix 100\`  → R$ 100,00\n` +
    `• \`/pix 500\`  → R$ 500,00\n` +
    `• \`/pix 5500\` → R$ 5.500,00\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `_Após o pagamento você será notificado automaticamente!_ 🔔`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

clientBot.onText(/\/ajuda/, (msg) => {
  clientBot.sendMessage(
    msg.chat.id,
    `🆘 *Central de Ajuda — CopyPix*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Comandos:*\n\n` +
    `🔹 /start — Tela de boas-vindas\n` +
    `🔹 /pix <valor> — Gerar cobrança PIX\n` +
    `🔹 /ajuda — Esta mensagem\n\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

clientBot.onText(/\/pix(?:\s+(.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const input  = match[1]?.trim().replace(',', '.');
  const valor  = parseFloat(input);

  if (!input || isNaN(valor) || valor <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Valor inválido!*\n\nUse: \`/pix <valor>\`\nExemplo: \`/pix 500\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const route = getRoute(valor);
  if (!route) {
    return clientBot.sendMessage(
      chatId,
      `⚠️ *Valor não disponível no momento.*\n\n` +
      `😕 Nenhum gateway disponível para *R$ ${formatBRL(valor)}*.\n` +
      `Tente outro valor ou aguarde alguns instantes.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  let loadingMsg;
  try {
    loadingMsg = await clientBot.sendMessage(
      chatId,
      `⏳ *Gerando seu PIX...*\n\n🔄 Aguarde um momento, Chefe!`,
      { parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.warn('[/pix] Erro ao enviar loading:', e.message);
    return;
  }

  try {
    const result = await route.module.createPix(chatId, valor);
    saveOrder(result.orderId, chatId, valor, route.label);
    clientBot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});

    await clientBot.sendMessage(
      chatId,
      `✅ *PIX Gerado com Sucesso!* 🎉\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💰 *Valor:* R$ ${formatBRL(valor)}\n` +
      `⏳ *Expira em:* ${result.expiresIn}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `📋 *Copia e Cola PIX:*\n\n` +
      `\`${result.qrCode}\`\n\n` +
      `_👆 Toque no código para copiar!_\n\n` +
      `🔔 _Você será notificado aqui quando o pagamento for confirmado!_`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 Copiar Código PIX', copy_text: { text: result.qrCode } }
          ]]
        }
      }
    ).catch(e => console.warn('[/pix] Erro ao enviar QR:', e.message));

  } catch (err) {
    console.error(`❌ [${route.label}] Erro ao gerar PIX:`, err.response?.data || err.message);
    clientBot.deleteMessage(chatId, loadingMsg.message_id).catch(() => {});
    clientBot.sendMessage(
      chatId,
      `❌ *Erro ao gerar o PIX!*\n\n😕 Algo deu errado. Tente novamente.\nSe o erro persistir, contate o suporte. 🛠️`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

clientBot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    clientBot.sendMessage(
      msg.chat.id,
      `👋 Use os comandos:\n\n🔹 /pix <valor> — Gerar PIX\n🔹 /ajuda — Ajuda`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

// ==========================
// EXPRESS
// ==========================
const app = express();
app.use(express.json());

// ══════════════════════════════════
// PAINEL WEB
// ══════════════════════════════════

function panelAuth(req, res, next) {
  const key = req.headers['x-panel-key'];
  if (!PANEL_PASSWORD || key !== PANEL_PASSWORD) {
    return res.status(401).json({ error: 'Não autorizado.' });
  }
  next();
}

app.get('/painel', (req, res) => {
  res.sendFile(path.join(__dirname, 'panel/index.html'));
});

app.get('/painel/api/providers', panelAuth, (req, res) => {
  res.json(getAll());
});

app.post('/painel/api/providers/:id/toggle', panelAuth, (req, res) => {
  const { id }    = req.params;
  const updated   = toggle(id);
  if (!updated) return res.status(404).json({ success: false, error: `Provider "${id}" não encontrado.` });

  console.log(`🎛️  [Painel] "${id}" → ${updated.enabled ? 'LIGADO' : 'DESLIGADO'}`);
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `🎛️ *PAINEL — CONFIGURAÇÃO ALTERADA*\n\n` +
    `${updated.enabled ? '✅ LIGADO' : '⏹️ DESLIGADO'}\n` +
    `🏦 *Gateway:* ${updated.label}\n` +
    `💰 *Faixa:* R$ ${formatBRL(updated.min)} – R$ ${formatBRL(updated.max)}\n` +
    `📅 *Data:* ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  res.json({ success: true, provider: { id, ...updated } });
});

app.post('/painel/api/providers/:id/range', panelAuth, (req, res) => {
  const { id }       = req.params;
  const { min, max } = req.body;
  const updated      = updateRange(id, Number(min), Number(max));

  if (!updated) return res.status(400).json({ success: false, error: 'Valores inválidos ou provider não encontrado.' });

  console.log(`🎛️  [Painel] Faixa "${id}" → R$ ${updated.min} – R$ ${updated.max}`);
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `🎛️ *PAINEL — FAIXA ALTERADA*\n\n` +
    `🏦 *Gateway:* ${updated.label}\n` +
    `💰 *Nova faixa:* R$ ${formatBRL(updated.min)} – R$ ${formatBRL(updated.max)}\n` +
    `📅 *Data:* ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});

  res.json({ success: true, provider: { id, ...updated } });
});

app.get('/painel/api/stats', panelAuth, (req, res) => {
  res.json({ today: stats.getToday(), history: stats.getHistory(10) });
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
  } catch (e) {
    console.error('[PagNet] Erro:', e.message);
  }
  res.sendStatus(200);
});

app.post('/webhook/fluxopay', (req, res) => {
  console.log('📥 [FluxoPay] Webhook:', JSON.stringify(req.body));
  try {
    const { event, data } = req.body;
    if (event === 'pix_in.completed') {
      _notifyPayment(data.orderId, {
        pagador: data.payer?.name     || null,
        cpf:     data.payer?.document || null,
        txId:    data.idTransaction,
        paidAt:  data.paidAt
      });
    }
  } catch (e) {
    console.error('[FluxoPay] Erro:', e.message);
  }
  res.sendStatus(200);
});

app.post('/webhook/podpay', (req, res) => {
  console.log('📥 [PodPay] Webhook:', JSON.stringify(req.body));
  try {
    const { event, data } = req.body;
    if (event === 'transaction.paid' && data?.status === 'PAID') {
      _notifyPayment(`podpay_${data.id}`, { txId: data.id, paidAt: data.paidAt });
    }
  } catch (e) {
    console.error('[PodPay] Erro:', e.message);
  }
  res.sendStatus(200);
});

app.post('/webhook/sharkbanking', (req, res) => {
  console.log('📥 [SharkBanking] Postback:', JSON.stringify(req.body));
  try {
    const { externalRef, status } = req.body;
    if (status === 'paid' || status === 'approved')     _notifyPayment(externalRef);
    if (status === 'refused' || status === 'cancelled') _notifyFailed(externalRef);
  } catch (e) {
    console.error('[SharkBanking] Erro:', e.message);
  }
  res.sendStatus(200);
});

app.post('/webhook/xpaytech', (req, res) => {
  console.log('📥 [XPayTech] Webhook:', JSON.stringify(req.body));
  try {
    // Payload pode vir com ou sem wrapper "data"
    const body       = req.body?.data || req.body;
    const externalId = body.externalId;
    const status     = body.status;

    if (status === 'FINISHED') {
      _notifyPayment(externalId, { txId: body.id });
    }
    if (status === 'CANCELLED' || status === 'TIMEOUT' || status === 'REVERSED') {
      _notifyFailed(externalId);
    }
  } catch (e) {
    console.error('[XPayTech] Erro:', e.message);
  }
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
  const valorFormatado = formatBRL(amountReais);
  const dataHora       = extra.paidAt ? formatDate(extra.paidAt) : nowBR();

  clientBot.sendMessage(
    chatId,
    `🎉 *PAGAMENTO CONFIRMADO!* ✅\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Valor pago:* R$ ${valorFormatado}\n` +
    `📅 *Data:* ${dataHora}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Seu pagamento foi recebido com sucesso! 🙏\n` +
    `Obrigado por usar o CopyPix! 🚀`,
    { parse_mode: 'Markdown' }
  ).catch(e => console.error('[notify] Erro cliente:', e.message));

  let adminMsg =
    `💸 *NOVO PAGAMENTO RECEBIDO!* 🔥\n\n` +
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
    `❌ *Pagamento não confirmado.*\n\n😕 Sua cobrança foi cancelada ou recusada.\nGere uma nova com /pix se quiser tentar novamente.`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  deleteOrder(orderId);
}

// ══════════════════════════════════
// ROTAS DE SISTEMA
// ══════════════════════════════════

app.post('/bot/telegram', (req, res) => {
  try {
    clientBot.processUpdate(req.body);
  } catch (e) {
    console.error('❌ [Telegram] Erro ao processar update:', e.message);
  }
  res.sendStatus(200);
});

app.get('/',      (req, res) => res.json({ status: 'ok', bot: 'CopyPix', version: '1.0.0' }));
app.get('/ping',  (req, res) => res.status(200).send('pong'));

app.get('/webhook-info', async (req, res) => {
  try {
    const r = await axios.get(`https://api.telegram.org/bot${process.env.CLIENT_BOT_TOKEN}/getWebhookInfo`);
    res.json(r.data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==========================
// INICIALIZAÇÃO
// ==========================
const PORT = process.env.PORT || 3000;

configReady.then(() => {

  app.listen(PORT, () => {
    console.log('\n🤖 ═══════════════════════════════════════');
    console.log('        CopyPix Bot — Iniciado! 🚀');
    console.log('═══════════════════════════════════════════');
    console.log(`🌐 Porta:           ${PORT}`);
    console.log(`🔗 APP_URL:         ${APP_URL || '⚠️ NÃO DEFINIDO'}`);
    console.log(`📅 Horário:         ${nowBR()}`);
    console.log('═══════════════════════════════════════════\n');

    // Registra webhook Telegram
    if (APP_URL) {
      axios.post(`https://api.telegram.org/bot${process.env.CLIENT_BOT_TOKEN}/setWebhook`, {
        url: `${APP_URL}/bot/telegram`,
        drop_pending_updates: true
      })
        .then(r  => console.log('✅ Webhook Telegram registrado!', JSON.stringify(r.data)))
        .catch(e => console.error('❌ Webhook erro:', e.response?.data || e.message));
    }

    // Notifica admin que o servidor (re)iniciou
    const cfg     = getAll();
    const ativos  = Object.values(cfg).filter(p => p.enabled).map(p => `• ${p.label} (R$ ${formatBRL(p.min)}–R$ ${formatBRL(p.max)})`).join('\n');
    const inativos = Object.values(cfg).filter(p => !p.enabled).map(p => `• ${p.label}`).join('\n') || 'Nenhum';

    adminBot.sendMessage(
      ADMIN_CHAT_ID,
      `🟢 *COPYPIX — SERVIDOR INICIADO*\n\n` +
      `📅 *Horário:* ${nowBR()}\n\n` +
      `✅ *Gateways ativos:*\n${ativos}\n\n` +
      `⏹️ *Desativados:*\n${inativos}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    // ── ANTI-SLEEP: self-ping a cada 25s para o Render não dormir ──
    // O request sai pelo APP_URL e volta pelo load balancer do Render,
    // contando como atividade externa e impedindo o spin-down.
    if (APP_URL) {
      setInterval(() => {
        axios.get(`${APP_URL}/ping`, { timeout: 10000 })
          .then(() => {})
          .catch(() => {}); // silencioso — só mantém vivo
      }, 25 * 1000); // 25 segundos
    }

    // Heartbeat: log a cada 10 minutos para confirmar que está vivo
    setInterval(() => {
      console.log(`💓 [Heartbeat] Servidor ativo — ${nowBR()}`);
    }, 10 * 60 * 1000);
  });

}).catch(e => {
  console.error('❌ Erro fatal na inicialização:', e.message);
  process.exit(1);
});

// ==========================
// PROTEÇÃO TOTAL CONTRA CRASHES
// ==========================
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  [unhandledRejection]', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️  [uncaughtException]', err?.message || err);
});
