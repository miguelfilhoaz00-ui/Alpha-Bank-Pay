require('dotenv').config();

const express     = require('express');
const path        = require('path');
const axios       = require('axios');
const TelegramBot = require('node-telegram-bot-api');

const { getRoute }                                        = require('./src/router');
const { saveOrder, getOrder, deleteOrder }                = require('./src/store');
const { getAll, toggle, updateRange, ready: configReady } = require('./src/config');
const stats                                               = require('./src/stats');
const { getUser, getUserByReferralCode, upsertUser, setPixKey, setGatewayOverride, setBanned, setDepositFee, setCommissionRate, setReferralFee, setReferredBy, getAllUsers, getAffiliates, getManagers, setReferrer } = require('./src/users');
const { createDepositTx, completeDeposit, createWithdrawalTx, completeWithdrawal, failWithdrawal, adminAdjust, getUserTransactions, getAllTransactions } = require('./src/wallet');
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
// TAXA PENDENTE DE APLICAÇÃO
// Map: managerChatId (string) → { taxa }
// ==========================
const pendingTaxaApply = new Map();

// Username dinâmico do bot cliente (preenchido no startup)
let CLIENT_BOT_USERNAME = '';

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
// Validação robusta de CPF
function isValidCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, '');

  // Verificar se tem 11 dígitos e não é sequência repetida
  if (cleaned.length !== 11 || /^(\d)\1{10}$/.test(cleaned)) {
    return false;
  }

  // Calcular primeiro dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (10 - i);
  }
  let digit1 = 11 - (sum % 11);
  if (digit1 > 9) digit1 = 0;

  // Calcular segundo dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * (11 - i);
  }
  let digit2 = 11 - (sum % 11);
  if (digit2 > 9) digit2 = 0;

  // Verificar se os dígitos conferem
  return cleaned[9] == digit1 && cleaned[10] == digit2;
}

// Validação robusta de CNPJ
function isValidCNPJ(cnpj) {
  const cleaned = cnpj.replace(/\D/g, '');

  // Verificar se tem 14 dígitos e não é sequência repetida
  if (cleaned.length !== 14 || /^(\d)\1{13}$/.test(cleaned)) {
    return false;
  }

  // Calcular primeiro dígito verificador
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i]) * weights1[i];
  }
  let digit1 = 11 - (sum % 11);
  if (digit1 < 2) digit1 = 0;

  // Calcular segundo dígito verificador
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cleaned[i]) * weights2[i];
  }
  let digit2 = 11 - (sum % 11);
  if (digit2 < 2) digit2 = 0;

  // Verificar se os dígitos conferem
  return cleaned[12] == digit1 && cleaned[13] == digit2;
}

// Validação robusta de email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 77; // Limite PIX
}

// Validação robusta de telefone
function isValidPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');

  // Aceitar formatos: 11999999999, 5511999999999
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return true; // Celular com DDD
  }
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    return cleaned.substring(2, 4) >= '11' && cleaned.substring(2, 4) <= '99'; // Brasil + DDD
  }

  return false;
}

// Validação robusta de chave EVP (aleatória)
function isValidEVP(key) {
  // Chave EVP: 32 caracteres hexadecimais separados por hífens
  const evpRegex = /^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$/;
  return evpRegex.test(key);
}

// Detectar e validar tipo de chave PIX
function detectAndValidatePixKey(key, expectedType = null) {
  if (!key || typeof key !== 'string') {
    return { valid: false, type: null, error: 'Chave inválida' };
  }

  const trimmedKey = key.trim();

  // Se tipo foi especificado, validar apenas esse tipo
  if (expectedType) {
    switch (expectedType.toUpperCase()) {
      case 'CPF':
        return isValidCPF(trimmedKey)
          ? { valid: true, type: 'CPF', formatted: formatCPF(trimmedKey) }
          : { valid: false, type: 'CPF', error: 'CPF inválido. Verifique os dígitos.' };

      case 'CNPJ':
        return isValidCNPJ(trimmedKey)
          ? { valid: true, type: 'CNPJ', formatted: formatCNPJ(trimmedKey) }
          : { valid: false, type: 'CNPJ', error: 'CNPJ inválido. Verifique os dígitos.' };

      case 'EMAIL':
        return isValidEmail(trimmedKey)
          ? { valid: true, type: 'EMAIL', formatted: trimmedKey }
          : { valid: false, type: 'EMAIL', error: 'Email inválido.' };

      case 'PHONE':
        return isValidPhone(trimmedKey)
          ? { valid: true, type: 'PHONE', formatted: formatPhone(trimmedKey) }
          : { valid: false, type: 'PHONE', error: 'Telefone inválido. Use formato: +5511999999999' };

      case 'EVP':
        return isValidEVP(trimmedKey)
          ? { valid: true, type: 'EVP', formatted: trimmedKey }
          : { valid: false, type: 'EVP', error: 'Chave aleatória inválida.' };
    }
  }

  // Auto-detecção (fallback)
  if (trimmedKey.includes('@') && isValidEmail(trimmedKey)) {
    return { valid: true, type: 'EMAIL', formatted: trimmedKey };
  }

  const cleaned = trimmedKey.replace(/\D/g, '');

  if (cleaned.length === 11 && isValidCPF(trimmedKey)) {
    return { valid: true, type: 'CPF', formatted: formatCPF(cleaned) };
  }

  if (cleaned.length === 14 && isValidCNPJ(trimmedKey)) {
    return { valid: true, type: 'CNPJ', formatted: formatCNPJ(cleaned) };
  }

  if ((cleaned.length === 11 || cleaned.length === 13) && isValidPhone(trimmedKey)) {
    return { valid: true, type: 'PHONE', formatted: formatPhone(cleaned) };
  }

  if (isValidEVP(trimmedKey)) {
    return { valid: true, type: 'EVP', formatted: trimmedKey };
  }

  return { valid: false, type: null, error: 'Formato de chave PIX não reconhecido.' };
}

// Funções de formatação
function formatCPF(cpf) {
  const cleaned = cpf.replace(/\D/g, '');
  return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
}

function formatCNPJ(cnpj) {
  const cleaned = cnpj.replace(/\D/g, '');
  return cleaned.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
}

function formatPhone(phone) {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return `+55${cleaned}`;
  }
  if (cleaned.length === 13 && cleaned.startsWith('55')) {
    return `+${cleaned}`;
  }
  return `+55${cleaned}`;
}

// Função legacy mantida para compatibilidade
function detectPixKeyType(key) {
  const result = detectAndValidatePixKey(key);
  return result.type || 'EVP';
}

// Emoji por tipo de chave PIX
function getPixTypeEmoji(type) {
  const emojis = {
    CPF: '📄',
    CNPJ: '🏢',
    EMAIL: '📧',
    PHONE: '📱',
    EVP: '🔐'
  };
  return emojis[type] || '🔑';
}

// Obter documento (CPF/CNPJ) do usuário ou chave para XPayTech
function getDocumentForWithdrawal(user, pixKey, pixKeyType) {
  // Se a chave é CPF ou CNPJ, usar ela como documento
  if (pixKeyType === 'CPF') {
    return pixKey.replace(/\D/g, '');
  }

  if (pixKeyType === 'CNPJ') {
    return pixKey.replace(/\D/g, '');
  }

  // Se o usuário tem CPF cadastrado, usar ele
  if (user.pixKey && user.pixKeyType === 'CPF') {
    return user.pixKey.replace(/\D/g, '');
  }

  // Fallback: usar CPF padrão (pode ser melhorado pedindo CPF do usuário)
  return '60369486382'; // CPF válido fornecido pelo usuário
}

// Mascara chave para exibição segura
function maskPixKey(key) {
  if (!key || key.length <= 6) return key;
  return key.slice(0, 3) + '***' + key.slice(-3);
}

// ==========================
// BOT CLIENTE — /start [codigo_indicacao]
// ==========================
clientBot.onText(/\/start(?:\s+(.+))?/, (msg, match) => {
  const chatId    = msg.chat.id;
  const firstName = msg.from?.first_name || 'Cliente';
  const refCode   = match[1]?.trim().toUpperCase() || null;

  const { isNew } = upsertUser(chatId, {
    firstName: msg.from?.first_name,
    lastName:  msg.from?.last_name,
    username:  msg.from?.username
  });

  // Processar código de indicação (só para novos usuários)
  if (isNew && refCode) {
    const referrer = getUserByReferralCode(refCode);
    if (referrer && String(referrer.chatId) !== String(chatId)) {
      setReferredBy(chatId, referrer.chatId);
      console.log(`🔗 [Indicação] ${chatId} indicado por ${referrer.chatId} (código: ${refCode})`);
      clientBot.sendMessage(
        chatId,
        `🎉 *Você foi indicado por ${referrer.firstName || 'um amigo'}!*\n\n` +
        `Faça seu primeiro depósito e ele receberá um bônus especial. 🎁`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }
  }

  // Notificar admin sobre novo usuário
  if (isNew) {
    adminBot.sendMessage(
      ADMIN_CHAT_ID,
      `👤 *NOVO USUÁRIO REGISTRADO*\n\n` +
      `👤 *Nome:* ${firstName}\n` +
      `🆔 *Chat ID:* \`${chatId}\`\n` +
      `${refCode ? `🔗 *Indicado por:* código \`${refCode}\`\n` : ''}` +
      `📅 *Data:* ${nowBR()}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  clientBot.sendMessage(
    chatId,
    `🏦 *Bem-vindo ao Alpha Bank Pay, ${firstName}!* 🚀\n\n` +
    `Sua carteira digital PIX. Deposite, gerencie seu saldo e saque quando quiser!\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `📌 *Comandos:*\n\n` +
    `💰 /pix <valor> — Gerar PIX para depósito\n` +
    `💳 /saldo — Ver seu saldo atual\n` +
    `💸 /sacar <valor> — Sacar para qualquer chave PIX\n` +
    `📋 /extrato — Histórico de transações\n` +
    `🤝 /indicar — Seu link de indicação\n` +
    `⚙️ /taxa <percent> — Definir taxa dos seus clientes (gerentes)\n` +
    `👥 /afiliados — Listar seus clientes indicados (gerentes)\n` +
    `🆘 /ajuda — Ajuda completa\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `_Para sacar, use /sacar e informe sua chave PIX na hora._`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /indicar
// ==========================
clientBot.onText(/\/indicar/, (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user) {
    return clientBot.sendMessage(chatId, `❌ Use /start primeiro para criar sua conta.`).catch(() => {});
  }

  const code      = user.referralCode || '—';
  const botUser   = CLIENT_BOT_USERNAME;
  const link      = botUser ? `https://t.me/${botUser}?start=${code}` : null;
  const isManager = user.commissionRate > 0;

  // Bloqueia gerente sem taxa definida
  if (isManager && (!user.referralFee || user.referralFee <= 0)) {
    return clientBot.sendMessage(
      chatId,
      `⚠️ *Configure sua taxa primeiro!*\n\n` +
      `Você é gerente com taxa base de *${user.commissionRate}%*, mas ainda não definiu a taxa dos seus clientes.\n\n` +
      `Use o comando abaixo para configurar:\n\`/taxa ${(user.commissionRate + 5).toFixed(0)}\`\n\n` +
      `_A taxa deve ser maior que ${user.commissionRate}% — o spread é o seu lucro._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  let texto =
    `🤝 *${isManager ? 'Painel do Gerente' : 'Sistema de Indicação'}*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  if (isManager) {
    const spread     = (user.referralFee - user.commissionRate).toFixed(2);
    const affiliates = getAffiliates(chatId);
    texto +=
      `📊 *Sua taxa base:* ${user.commissionRate}%\n` +
      `💸 *Taxa dos seus clientes:* ${user.referralFee}%\n` +
      `💰 *Seu lucro por depósito:* ${spread}%\n` +
      `👥 *Clientes indicados:* ${affiliates.length}\n` +
      `\n_Use /taxa para alterar a taxa. Use /afiliados para ver seus clientes._\n\n`;
  } else {
    texto += `🎁 *Como funciona:*\nQuando alguém entrar pelo seu link e depositar, você recebe comissão automaticamente!\n\n`;
  }

  texto +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 *Seu código:* \`${code}\`\n` +
    (link ? `🌐 *Seu link:*\n\`${link}\`\n\n` : '\n') +
    `💰 *Total ganho em comissões:* R$ ${formatBRL(user.referralEarned || 0)}\n` +
    `━━━━━━━━━━━━━━━━━━━━`;

  clientBot.sendMessage(chatId, texto, { parse_mode: 'Markdown' }).catch(() => {});
});

// ==========================
// BOT CLIENTE — /taxa <percent>
// Somente gerentes (commissionRate > 0) podem usar
// Define a taxa cobrada dos seus clientes indicados
// Deve ser >= commissionRate (taxa base do dono)
// ==========================
clientBot.onText(/\/taxa(?:\s+(.+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user) {
    return clientBot.sendMessage(chatId, `❌ Use /start primeiro para criar sua conta.`).catch(() => {});
  }

  // Somente quem tem commissionRate > 0 é gerente
  if (!user.commissionRate || user.commissionRate <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Acesso negado.*\n\nEste comando é exclusivo para gerentes.\nEntre em contato com o suporte para solicitar acesso.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const input = match[1]?.trim().replace(',', '.');
  const taxa  = parseFloat(input);

  // Sem argumento — mostra configuração atual
  if (!input || isNaN(taxa)) {
    const spread = user.referralFee > 0 ? (user.referralFee - user.commissionRate).toFixed(2) : '—';
    return clientBot.sendMessage(
      chatId,
      `⚙️ *Configuração de Gerente*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *Taxa base (dono):* ${user.commissionRate}%\n` +
      `💸 *Sua taxa atual p/ clientes:* ${user.referralFee > 0 ? user.referralFee + '%' : 'Não definida'}\n` +
      `💰 *Seu spread (lucro):* ${spread !== '—' ? spread + '%' : '—'}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `Para alterar, use:\n\`/taxa <percent>\`\n\n` +
      `⚠️ _A taxa deve ser maior que ${user.commissionRate}% (sua taxa base)._`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // Validações
  if (taxa < 0 || taxa > 100) {
    return clientBot.sendMessage(
      chatId, `❌ Taxa inválida. Use um valor entre 0 e 100.`, { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (taxa <= user.commissionRate) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Taxa muito baixa!*\n\n` +
      `Sua taxa base é *${user.commissionRate}%*.\n` +
      `Você precisa definir uma taxa *acima* de ${user.commissionRate}% para ter lucro.\n\n` +
      `Ex: \`/taxa ${(user.commissionRate + 5).toFixed(0)}\``,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const spread = (taxa - user.commissionRate).toFixed(2);
  setReferralFee(chatId, taxa);
  console.log(`⚙️  [Taxa] Gerente ${chatId} definiu taxa de clientes: ${taxa}% (spread: ${spread}%)`);

  const affiliates = getAffiliates(chatId);
  const baseMsg =
    `✅ *Taxa atualizada com sucesso!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 *Taxa dos seus clientes:* ${taxa}%\n` +
    `📊 *Taxa base (dono):* ${user.commissionRate}%\n` +
    `💰 *Seu lucro por depósito:* ${spread}%\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (affiliates.length > 0) {
    pendingTaxaApply.set(String(chatId), { taxa });
    clientBot.sendMessage(
      chatId,
      baseMsg +
      `📊 Você tem *${affiliates.length} cliente(s)* existente(s).\nDeseja aplicar a nova taxa a eles também?`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: `✅ Aplicar a todos (${affiliates.length})`, callback_data: `taxa_apply_${chatId}` },
            { text: '❌ Somente novos',                          callback_data: `taxa_skip_${chatId}` }
          ]]
        }
      }
    ).catch(() => {});
  } else {
    clientBot.sendMessage(
      chatId,
      baseMsg +
      `_Novos clientes que entrarem pelo seu link pagarão ${taxa}% de taxa._\n` +
      `_Você receberá ${spread}% de cada depósito deles automaticamente!_ 🚀`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // Notificar admin
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `⚙️ *GERENTE ATUALIZOU TAXA*\n\n` +
    `👤 *Gerente:* ${user.firstName || chatId}\n` +
    `💸 *Nova taxa clientes:* ${taxa}%\n` +
    `📊 *Taxa base:* ${user.commissionRate}%\n` +
    `💰 *Spread do gerente:* ${spread}%\n` +
    `📅 ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /afiliados
// Lista clientes indicados pelo gerente
// ==========================
clientBot.onText(/\/afiliados/, (msg) => {
  const chatId = msg.chat.id;
  const user   = getUser(chatId);

  if (!user || !user.commissionRate || user.commissionRate <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Acesso negado.*\n\nEste comando é exclusivo para gerentes.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const affiliates = getAffiliates(chatId);

  if (!affiliates.length) {
    return clientBot.sendMessage(
      chatId,
      `📊 *Seus Afiliados*\n\n💤 Nenhum cliente indicado ainda.\n\n` +
      `Compartilhe seu link via /indicar para começar a ganhar!`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  const linhas = affiliates.map((a, i) => {
    const nome = [a.firstName, a.lastName].filter(Boolean).join(' ') || `ID ${a.chatId}`;
    const taxa = a.depositFee || 0;
    return `${i + 1}. *${nome}*\n   Taxa: ${taxa}% · Saldo: R$ ${formatBRL(a.balance)}`;
  }).join('\n\n');

  clientBot.sendMessage(
    chatId,
    `📊 *Seus Afiliados — ${affiliates.length} cliente(s)*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `${linhas}\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💸 *Taxa cobrada:* ${user.referralFee || 0}%\n` +
    `💰 *Total ganho em comissões:* R$ ${formatBRL(user.referralEarned || 0)}`,
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
    `💰 */pix <valor>*\n` +
    `  Gera um PIX para depositar na sua conta\n` +
    `  Ex: \`/pix 500\`\n\n` +
    `💳 */saldo*\n` +
    `  Exibe seu saldo disponível\n\n` +
    `💸 */sacar <valor>*\n` +
    `  Solicita saque para qualquer chave PIX\n` +
    `  O bot pedirá a chave na hora — sem necessidade de cadastro!\n` +
    `  Ex: \`/sacar 200\`\n\n` +
    `📋 */extrato*\n` +
    `  Últimas 10 transações\n\n` +
    `━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
});

// ==========================
// BOT CLIENTE — /pix
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

  // Verificar ban
  const userCheck = getUser(chatId);
  if (userCheck?.banned) {
    return clientBot.sendMessage(
      chatId, `🚫 *Sua conta está bloqueada.*\n\nEntre em contato com o suporte.`, { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  if (!input || isNaN(valor) || valor <= 0) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Valor inválido!*\n\nUse: \`/pix <valor>\`\nExemplo: \`/pix 500\``,
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
    console.warn('[/pix] Erro ao enviar loading:', e.message);
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
    ).catch(e => console.warn('[/pix] Erro ao enviar QR:', e.message));

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

clientBot.onText(/\/pix(?:\s+(.+))?/, handleDepositar);

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
    `💰 /pix — Adicionar saldo\n` +
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
      `📋 *Seu Extrato*\n\n💤 Nenhuma transação ainda.\n\nUse /pix para adicionar saldo!`,
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

  if (user.banned) {
    return clientBot.sendMessage(
      chatId, `🚫 *Sua conta está bloqueada.*\n\nEntre em contato com o suporte.`, { parse_mode: 'Markdown' }
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

  if (user.balance < valor) {
    return clientBot.sendMessage(
      chatId,
      `❌ *Saldo insuficiente!*\n\n` +
      `💰 *Saldo disponível:* R$ ${formatBRL(user.balance)}\n` +
      `💸 *Valor solicitado:* R$ ${formatBRL(valor)}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  // Aguarda seleção do tipo de chave PIX
  pendingWithdrawals.set(String(chatId), { amount: valor, step: 'selecting_type' });

  clientBot.sendMessage(
    chatId,
    `💸 *Saque de R$ ${formatBRL(valor)}*\n\n` +
    `🔑 Escolha o tipo da sua *chave PIX*:`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📄 CPF', callback_data: `pix_type_cpf_${chatId}` },
            { text: '🏢 CNPJ', callback_data: `pix_type_cnpj_${chatId}` }
          ],
          [
            { text: '📧 E-mail', callback_data: `pix_type_email_${chatId}` },
            { text: '📱 Telefone', callback_data: `pix_type_phone_${chatId}` }
          ],
          [
            { text: '🔐 Chave Aleatória', callback_data: `pix_type_evp_${chatId}` }
          ],
          [
            { text: '❌ Cancelar', callback_data: `cancel_wd_${chatId}` }
          ]
        ]
      }
    }
  ).catch(() => {});
});

// ==========================
// CALLBACK — seleção de tipo PIX e confirmação de saque
// ==========================
clientBot.on('callback_query', async (query) => {
  const chatId = String(query.message.chat.id);
  const data   = query.data;

  clientBot.answerCallbackQuery(query.id).catch(() => {});

  // Seleção de tipo de chave PIX
  if (data.startsWith('pix_type_')) {
    const type = data.split('_')[2].toUpperCase(); // cpf, cnpj, email, phone, evp
    const pending = pendingWithdrawals.get(chatId);

    if (!pending || pending.step !== 'selecting_type') {
      return clientBot.sendMessage(chatId, `❌ Solicitação expirada. Use /sacar novamente.`).catch(() => {});
    }

    // Atualizar pendingWithdrawals com o tipo selecionado
    pendingWithdrawals.set(chatId, {
      ...pending,
      step: 'awaiting_key',
      selectedType: type
    });

    // Mensagens personalizadas por tipo
    const typeMessages = {
      CPF: `📄 *Digite seu CPF:*\n\nFormatos aceitos:\n• \`123.456.789-00\`\n• \`12345678900\`\n\n_Será validado automaticamente._`,
      CNPJ: `🏢 *Digite seu CNPJ:*\n\nFormatos aceitos:\n• \`12.345.678/0001-90\`\n• \`12345678000190\`\n\n_Será validado automaticamente._`,
      EMAIL: `📧 *Digite seu e-mail:*\n\nExemplo:\n• \`seuemail@gmail.com\`\n\n_Certifique-se de que está correto._`,
      PHONE: `📱 *Digite seu telefone:*\n\nFormatos aceitos:\n• \`11999999999\`\n• \`+5511999999999\`\n• \`(11) 99999-9999\``,
      EVP: `🔐 *Digite sua chave aleatória:*\n\nFormato:\n• \`12345678-1234-1234-1234-123456789012\`\n\n_Cole exatamente como aparece no seu app._`
    };

    clientBot.editMessageText(
      `💸 *Saque de R$ ${formatBRL(pending.amount)}*\n\n${typeMessages[type]}`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '← Voltar', callback_data: `back_to_type_${chatId}` },
            { text: '❌ Cancelar', callback_data: `cancel_wd_${chatId}` }
          ]]
        }
      }
    ).catch(() => {});

    return;
  }

  // Voltar à seleção de tipo
  if (data === `back_to_type_${chatId}`) {
    const pending = pendingWithdrawals.get(chatId);
    if (!pending) return;

    pendingWithdrawals.set(chatId, { amount: pending.amount, step: 'selecting_type' });

    clientBot.editMessageText(
      `💸 *Saque de R$ ${formatBRL(pending.amount)}*\n\n🔑 Escolha o tipo da sua *chave PIX*:`,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📄 CPF', callback_data: `pix_type_cpf_${chatId}` },
              { text: '🏢 CNPJ', callback_data: `pix_type_cnpj_${chatId}` }
            ],
            [
              { text: '📧 E-mail', callback_data: `pix_type_email_${chatId}` },
              { text: '📱 Telefone', callback_data: `pix_type_phone_${chatId}` }
            ],
            [
              { text: '🔐 Chave Aleatória', callback_data: `pix_type_evp_${chatId}` }
            ],
            [
              { text: '❌ Cancelar', callback_data: `cancel_wd_${chatId}` }
            ]
          ]
        }
      }
    ).catch(() => {});

    return;
  }

  // Cancelar saque
  if (data === `cancel_wd_${chatId}`) {
    pendingWithdrawals.delete(chatId);
    clientBot.editMessageText(
      `❌ Saque cancelado.`,
      {
        chat_id: chatId,
        message_id: query.message.message_id
      }
    ).catch(() => {});
    return;
  }

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

    // Verificar se precisa aprovação ANTES de debitar
    const needsApproval = checkTransactionNeedsApproval(chatId, pending.amount, pending.pixKey);

    if (needsApproval) {
      // Criar registro de controle para aprovação
      const transactionId = generateTransactionId();

      db.prepare(`
        INSERT INTO transaction_controls (transactionId, chatId, amount, pixKey, status)
        VALUES (?, ?, ?, ?, 'pending')
      `).run(transactionId, chatId, pending.amount, pending.pixKey);

      clientBot.editMessageText(
        `⏳ *Saque Enviado para Aprovação*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
        `🔑 *Chave PIX:* \`${maskPixKey(pending.pixKey)}\` _(${pending.pixKeyType})_\n` +
        `📋 *ID:* #${transactionId}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `🔍 Sua transação está em análise e será processada em breve.\n\n` +
        `⏰ Você receberá uma notificação quando for aprovada.`,
        { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
      ).catch(() => {});

      // Notificar admin
      adminBot.sendMessage(
        ADMIN_CHAT_ID,
        `🔔 *NOVA TRANSAÇÃO PARA APROVAÇÃO*\n\n` +
        `👤 *Usuário:* ${user.firstName || chatId}\n` +
        `💰 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
        `🔑 *Chave:* \`${pending.pixKey}\` (${pending.pixKeyType})\n` +
        `📋 *ID:* #${transactionId}\n` +
        `📅 *Data:* ${nowBR()}\n\n` +
        `Acesse o painel para aprovar ou rejeitar.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      return;
    }

    // Obter gateway preferido do usuário
    const userGateway = user.preferred_gateway || 'XPayTech';

    // Aprovação automática - processar imediatamente
    const withdrawal = createWithdrawalTx(chatId, pending.amount, userGateway);
    if (!withdrawal) {
      return clientBot.sendMessage(
        chatId, `❌ *Saldo insuficiente.* Use /saldo para verificar.`, { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    try {
      const pixKey     = pending.pixKey;
      const pixKeyType = pending.pixKeyType;
      const document   = getDocumentForWithdrawal(user, pixKey, pixKeyType);

      let result;

      // Usar gateway específico do usuário
      switch (userGateway) {
        case 'XPayTech':
          result = await xpaytech.withdraw(chatId, pending.amount, pixKey, pixKeyType, document);
          break;
        case 'PagNet':
          // TODO: Implementar PagNet withdraw quando disponível
          result = await xpaytech.withdraw(chatId, pending.amount, pixKey, pixKeyType, document);
          break;
        case 'FluxoPay':
          // TODO: Implementar FluxoPay withdraw quando disponível
          result = await xpaytech.withdraw(chatId, pending.amount, pixKey, pixKeyType, document);
          break;
        default:
          result = await xpaytech.withdraw(chatId, pending.amount, pixKey, pixKeyType, document);
      }

      completeWithdrawal(withdrawal.txId, result.orderId);

      clientBot.editMessageText(
        `✅ *Saque Enviado com Sucesso!*\n\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `💸 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
        `🔑 *Destino:* \`${maskPixKey(pixKey)}\` _(${pixKeyType})_\n` +
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
        `🔑 *Chave:* \`${pixKey}\` (${pixKeyType})\n` +
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

  } else if (data === `taxa_apply_${chatId}`) {
    const pending = pendingTaxaApply.get(chatId);
    if (!pending) {
      return clientBot.editMessageText(
        `⚠️ Sessão expirada. Use /taxa novamente.`,
        { chat_id: chatId, message_id: query.message.message_id }
      ).catch(() => {});
    }
    pendingTaxaApply.delete(chatId);

    const affiliates = getAffiliates(chatId);
    for (const affiliate of affiliates) {
      setDepositFee(affiliate.chatId, pending.taxa);
    }
    console.log(`⚙️  [Taxa] Gerente ${chatId} aplicou ${pending.taxa}% a ${affiliates.length} afiliado(s).`);

    clientBot.editMessageText(
      `✅ *Taxa aplicada a ${affiliates.length} cliente(s)!*\n\n` +
      `Todos agora pagarão *${pending.taxa}%* nos seus depósitos.`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});

  } else if (data === `taxa_skip_${chatId}`) {
    pendingTaxaApply.delete(chatId);
    clientBot.editMessageText(
      `✅ *Taxa salva!*\n\nSomente novos clientes indicados pagarão a nova taxa.`,
      { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' }
    ).catch(() => {});
  }
});

// ==========================
// MENSAGENS SEM COMANDO
// Captura chave PIX quando usuário está em fluxo de saque
// ==========================
clientBot.on('message', (msg) => {
  if (!msg.text || msg.text.startsWith('/') || msg.via_bot) return;

  const chatId  = String(msg.chat.id);
  const pending = pendingWithdrawals.get(chatId);

  // Fluxo de saque — aguardando chave PIX
  if (pending && pending.step === 'awaiting_key') {
    const pixKey = msg.text.trim();
    const user = getUser(chatId);

    if (!user) return;

    // Validar chave PIX com base no tipo selecionado
    const validation = detectAndValidatePixKey(pixKey, pending.selectedType);

    if (!validation.valid) {
      return clientBot.sendMessage(
        chatId,
        `❌ *${validation.error}*\n\n` +
        `Tente novamente ou use /sacar para recomeçar.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    // Verificar se o usuário tem saldo suficiente (pode ter mudado)
    if (user.balance < pending.amount) {
      pendingWithdrawals.delete(chatId);
      return clientBot.sendMessage(
        chatId,
        `❌ *Saldo insuficiente!*\n\n` +
        `💰 *Saldo atual:* R$ ${formatBRL(user.balance)}\n` +
        `💸 *Valor solicitado:* R$ ${formatBRL(pending.amount)}`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    // Atualizar pending com a chave validada
    pendingWithdrawals.set(chatId, {
      amount: pending.amount,
      pixKey: validation.formatted,
      pixKeyType: validation.type,
      step: 'confirming'
    });

    // Mensagem de confirmação com dados validados
    clientBot.sendMessage(
      chatId,
      `⚠️ *Confirmar Saque?*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💸 *Valor:* R$ ${formatBRL(pending.amount)}\n` +
      `📋 *Tipo:* ${getPixTypeEmoji(validation.type)} ${validation.type}\n` +
      `🔑 *Chave PIX:* \`${maskPixKey(validation.formatted)}\`\n` +
      `💳 *Saldo após saque:* R$ ${formatBRL(user.balance - pending.amount)}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n\n` +
      `_Confirme os dados antes de prosseguir._`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Confirmar saque', callback_data: `confirm_wd_${chatId}` }
            ],
            [
              { text: '🔙 Alterar chave', callback_data: `back_to_type_${chatId}` },
              { text: '❌ Cancelar', callback_data: `cancel_wd_${chatId}` }
            ]
          ]
        }
      }
    ).catch(() => {});

    return;
  }

  // Mensagem comum sem contexto
  clientBot.sendMessage(
    chatId,
    `👋 Use os comandos:\n\n💰 /pix <valor>\n💳 /saldo\n💸 /sacar <valor>\n📋 /extrato\n🆘 /ajuda`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
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

// Banir / desbanir usuário
app.post('/painel/api/users/:chatId/ban', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const banned  = req.body.banned ? 1 : 0;
  const updated = setBanned(req.params.chatId, banned);
  console.log(`🚫 [Painel] chatId ${req.params.chatId} → ${banned ? 'BANIDO' : 'DESBANIDO'}`);
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `${banned ? '🚫' : '✅'} *USUÁRIO ${banned ? 'BANIDO' : 'DESBANIDO'}*\n` +
    `👤 *Nome:* ${user.firstName || user.chatId}\n` +
    `🆔 *Chat ID:* \`${user.chatId}\`\n` +
    `📅 ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  res.json({ success: true, user: updated });
});

// Definir taxa base do gerente (commissionRate) — % que o dono garante
app.post('/painel/api/users/:chatId/commission', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const rate = parseFloat(req.body.commissionRate);
  if (isNaN(rate) || rate < 0 || rate > 100) return res.status(400).json({ success: false, error: 'Taxa inválida (0-100).' });
  const updated = setCommissionRate(req.params.chatId, rate);
  console.log(`⚙️  [Painel] commissionRate do chatId ${req.params.chatId} → ${rate}%`);
  // Notificar gerente se ele acabou de virar gerente
  if (rate > 0 && (!user.commissionRate || user.commissionRate === 0)) {
    clientBot.sendMessage(
      req.params.chatId,
      `🎉 *Você agora é um Gerente!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `📊 *Sua taxa base:* ${rate}%\n\n` +
      `Para começar, defina a taxa dos seus clientes:\n\`/taxa <percent>\`\n\n` +
      `_A taxa dos clientes deve ser maior que ${rate}% — o spread é o seu lucro._\n\n` +
      `Use /indicar para obter seu link de indicação.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }
  res.json({ success: true, user: updated });
});

// Definir taxa de depósito por usuário
app.post('/painel/api/users/:chatId/fee', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const fee = parseFloat(req.body.fee);
  if (isNaN(fee) || fee < 0 || fee > 100) return res.status(400).json({ success: false, error: 'Taxa inválida (0-100).' });
  const updated = setDepositFee(req.params.chatId, fee);
  console.log(`💸 [Painel] Taxa do chatId ${req.params.chatId} → ${fee}%`);
  res.json({ success: true, user: updated });
});

// Ajuste manual de saldo
app.post('/painel/api/users/:chatId/balance', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });
  const amount = parseFloat(req.body.amount);
  const note   = String(req.body.note || 'Ajuste manual pelo painel').slice(0, 200);
  if (isNaN(amount) || amount === 0) return res.status(400).json({ success: false, error: 'Valor inválido.' });
  const updated = adminAdjust(req.params.chatId, amount, note);
  console.log(`💰 [Painel] Ajuste manual | chatId: ${req.params.chatId} | R$ ${amount}`);
  adminBot.sendMessage(
    ADMIN_CHAT_ID,
    `💰 *AJUSTE MANUAL DE SALDO*\n` +
    `👤 *Usuário:* ${user.firstName || user.chatId}\n` +
    `${amount > 0 ? '➕' : '➖'} *Valor:* R$ ${formatBRL(Math.abs(amount))}\n` +
    `📝 *Nota:* ${note}\n` +
    `💳 *Novo saldo:* R$ ${formatBRL(updated.balance)}\n` +
    `📅 ${nowBR()}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  // Notificar o usuário
  clientBot.sendMessage(
    req.params.chatId,
    `💰 *Saldo atualizado pelo administrador*\n\n` +
    `${amount > 0 ? '➕ *Crédito:* R$' : '➖ *Débito:* R$'} ${formatBRL(Math.abs(amount))}\n` +
    `📝 *Motivo:* ${note}\n` +
    `💳 *Saldo atual:* R$ ${formatBRL(updated.balance)}`,
    { parse_mode: 'Markdown' }
  ).catch(() => {});
  res.json({ success: true, user: updated });
});

// Broadcast para todos os usuários - VERSÃO CORRIGIDA
app.post('/painel/api/broadcast', panelAuth, async (req, res) => {
  const message = String(req.body.message || '').trim();
  const useTemplate = req.body.template || null;

  // Validações melhoradas
  if (!message && !useTemplate) {
    return res.status(400).json({ success: false, error: 'Mensagem vazia.' });
  }

  if (message && message.length > 4000) {
    return res.status(400).json({ success: false, error: 'Mensagem muito longa (máx 4000 caracteres).' });
  }

  // Usar template se especificado
  let finalMessage = message;
  if (useTemplate) {
    const templates = getBroadcastTemplates();
    const template = templates.find(t => t.id === useTemplate);
    if (template) {
      finalMessage = template.content;
    }
  }

  const users = getAllUsers().filter(u => !u.banned);
  let sent = 0, failed = 0;
  const failedUsers = [];

  console.log(`📢 [Broadcast] Iniciando envio para ${users.length} usuários`);

  // Processar em lotes para evitar travamento
  const batchSize = 20;
  for (let i = 0; i < users.length; i += batchSize) {
    const batch = users.slice(i, i + batchSize);

    const batchPromises = batch.map(async (u) => {
      try {
        await Promise.race([
          clientBot.sendMessage(u.chatId, `📢 *Mensagem da Alpha Bank Pay:*\n\n${finalMessage}`, { parse_mode: 'Markdown' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 10000))
        ]);
        sent++;
        return { chatId: u.chatId, success: true };
      } catch (e) {
        failed++;
        console.error(`❌ [Broadcast] Falha para ${u.chatId}:`, e.message);
        failedUsers.push({ chatId: u.chatId, error: e.message });
        return { chatId: u.chatId, success: false, error: e.message };
      }
    });

    await Promise.all(batchPromises);

    // Delay entre lotes
    if (i + batchSize < users.length) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // Salvar histórico do broadcast
  const broadcastId = saveBroadcastHistory(finalMessage, sent, failed, failedUsers);

  console.log(`📢 [Broadcast] Concluído - ID: ${broadcastId} | Enviado: ${sent} | Falhou: ${failed}`);

  res.json({
    success: true,
    sent,
    failed,
    broadcastId,
    failedUsers: failedUsers.slice(0, 10) // Apenas primeiros 10 para não sobrecarregar
  });
});

// Obter templates de broadcast
function getBroadcastTemplates() {
  return [
    {
      id: 'manutencao',
      name: '🔧 Manutenção Programada',
      content: `🔧 *MANUTENÇÃO PROGRAMADA*

⏰ **Horário:** Hoje das 02:00 às 04:00
🚫 **Serviços afetados:** PIX e Saques temporariamente indisponíveis

✅ **Depósitos:** Funcionando normalmente
💰 **Consulta de saldo:** Disponível

Agradecemos a compreensão!`
    },
    {
      id: 'promocao',
      name: '🎉 Promoção Especial',
      content: `🎉 *PROMOÇÃO ESPECIAL!*

💰 **Cashback dobrado** em todos os PIX
📅 **Válido até:** Final do mês
🎯 **Mínimo:** R$ 100

Aproveite para fazer seus PIX e ganhar mais!

💸 Quanto mais usar, mais ganhar!`
    },
    {
      id: 'nova_funcionalidade',
      name: '🆕 Nova Funcionalidade',
      content: `🆕 *NOVIDADE NA PLATAFORMA!*

✨ Agora você pode:
• ⚡ Saques mais rápidos
• 🔄 Consultar histórico completo
• 📊 Ver relatórios detalhados

Digite /menu para conhecer as novidades!

🚀 Alpha Bank Pay sempre evoluindo!`
    },
    {
      id: 'aviso_importante',
      name: '⚠️ Aviso Importante',
      content: `⚠️ *AVISO IMPORTANTE*

🔐 **Segurança em primeiro lugar:**
• Nunca compartilhe suas chaves PIX
• Não clique em links suspeitos
• Sempre confirme dados antes de sacar

❓ **Dúvidas?** Fale com nosso suporte

🛡️ Sua segurança é nossa prioridade!`
    },
    {
      id: 'feliz_natal',
      name: '🎄 Feliz Natal',
      content: `🎄 *FELIZ NATAL!*

🎁 A equipe Alpha Bank Pay deseja a você e sua família um Natal repleto de:
• ❤️ Amor
• 🕊️ Paz
• 💰 Prosperidade
• ✨ Realizações

Obrigado por confiar em nossos serviços!

🎅 Ho ho ho! Feliz Natal! 🎄`
    },
    {
      id: 'ano_novo',
      name: '🎆 Feliz Ano Novo',
      content: `🎆 *FELIZ ANO NOVO!*

✨ **2026 chegou com tudo!**

🎯 Que este novo ano traga:
• 📈 Muito sucesso
• 💰 Prosperidade
• 🚀 Novas conquistas
• 💪 Força para realizar seus sonhos

Obrigado por fazer parte da nossa jornada!

🥳 Feliz 2026! 🎉`
    }
  ];
}

// Salvar histórico de broadcast
function saveBroadcastHistory(message, sent, failed, failedUsers) {
  const result = db.prepare(`
    INSERT INTO broadcast_history (message, sent_count, failed_count, failed_users, created_at)
    VALUES (?, ?, ?, ?, datetime('now'))
  `).run(message, sent, failed, JSON.stringify(failedUsers));

  return result.lastInsertRowid;
}

// Listar templates de broadcast
app.get('/painel/api/broadcast/templates', panelAuth, (req, res) => {
  res.json(getBroadcastTemplates());
});

// Histórico de broadcasts
app.get('/painel/api/broadcast/history', panelAuth, (req, res) => {
  const history = db.prepare(`
    SELECT * FROM broadcast_history
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  res.json(history);
});

// Afiliados de um gerente
app.get('/painel/api/users/:chatId/affiliates', panelAuth, (req, res) => {
  const affiliates = getAffiliates(req.params.chatId);
  res.json(affiliates);
});

// Vincular / desvincular cliente a um gerente (admin)
app.post('/painel/api/users/:chatId/referrer', panelAuth, (req, res) => {
  const user = getUser(req.params.chatId);
  if (!user) return res.status(404).json({ success: false, error: 'Usuário não encontrado.' });

  const managerChatId = req.body.managerChatId || null;

  if (managerChatId) {
    const manager = getUser(managerChatId);
    if (!manager) return res.status(404).json({ success: false, error: 'Gerente não encontrado.' });
    if (!manager.commissionRate || manager.commissionRate <= 0)
      return res.status(400).json({ success: false, error: 'Usuário não é gerente.' });
  }

  const updated = setReferrer(req.params.chatId, managerChatId);
  console.log(`🔗 [Painel] Vínculo | cliente: ${req.params.chatId} → gerente: ${managerChatId || 'nenhum'}`);
  res.json({ success: true, user: updated });
});

// Aplicar taxa do gerente a todos os afiliados existentes
app.post('/painel/api/users/:chatId/apply-taxa', panelAuth, (req, res) => {
  const manager = getUser(req.params.chatId);
  if (!manager) return res.status(404).json({ success: false, error: 'Gerente não encontrado.' });
  if (!manager.referralFee || manager.referralFee <= 0)
    return res.status(400).json({ success: false, error: 'Gerente não tem taxa definida.' });

  const affiliates = getAffiliates(req.params.chatId);
  for (const affiliate of affiliates) {
    setDepositFee(affiliate.chatId, manager.referralFee);
  }

  console.log(`📊 [Painel] Taxa ${manager.referralFee}% aplicada a ${affiliates.length} afiliado(s) do gerente ${req.params.chatId}`);
  res.json({ success: true, count: affiliates.length, fee: manager.referralFee });
});

// Transações com filtros e totais
app.get('/painel/api/transactions', panelAuth, (req, res) => {
  const { type, status, gateway, period, limit = 100 } = req.query;

  let whereConditions = [];
  let params = [];

  // Filtro por tipo
  if (type) {
    whereConditions.push('type = ?');
    params.push(type);
  }

  // Filtro por status
  if (status) {
    whereConditions.push('status = ?');
    params.push(status);
  }

  // Filtro por gateway
  if (gateway) {
    whereConditions.push('gateway = ?');
    params.push(gateway);
  }

  // Filtro por período
  if (period) {
    switch (period) {
      case 'today':
        whereConditions.push("date(createdAt) = date('now')");
        break;
      case 'week':
        whereConditions.push("createdAt >= datetime('now', '-7 days')");
        break;
      case 'month':
        whereConditions.push("createdAt >= datetime('now', '-30 days')");
        break;
    }
  }

  const whereClause = whereConditions.length > 0 ? 'WHERE ' + whereConditions.join(' AND ') : '';

  // Buscar transações
  const transactions = db.prepare(`
    SELECT t.*, u.firstName, u.username
    FROM transactions t
    LEFT JOIN users u ON t.chatId = u.chatId
    ${whereClause}
    ORDER BY t.createdAt DESC
    LIMIT ?
  `).all(...params, parseInt(limit));

  // Calcular totais por categoria
  const totals = {
    all: db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM transactions').get().total,
    deposits: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'deposit' AND status = 'completed'").get().total,
    withdrawals: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE type = 'withdrawal' AND status = 'completed'").get().total,
    pending: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'pending'").get().total,
    completed: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'completed'").get().total,
    failed: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE status = 'failed'").get().total,
    today: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE date(createdAt) = date('now')").get().total,
    week: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE createdAt >= datetime('now', '-7 days')").get().total,
    month: db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE createdAt >= datetime('now', '-30 days')").get().total
  };

  // Totais por gateway
  const gateways = db.prepare("SELECT gateway, COALESCE(SUM(amount), 0) as total FROM transactions WHERE gateway IS NOT NULL GROUP BY gateway").all();
  gateways.forEach(gw => {
    totals[`gateway_${gw.gateway}`] = gw.total;
  });

  res.json({
    transactions,
    totals,
    count: transactions.length
  });
});

// ══════════════════════════════════
// NOVAS FUNCIONALIDADES DE CONTROLE
// ══════════════════════════════════

// Listar transações pendentes de aprovação
app.get('/painel/api/transactions/pending', panelAuth, (req, res) => {
  const pending = db.prepare(`
    SELECT tc.*, u.firstName, u.username
    FROM transaction_controls tc
    JOIN users u ON tc.chatId = u.chatId
    WHERE tc.status = 'pending'
    ORDER BY tc.created_at DESC
  `).all();

  res.json(pending);
});

// Listar bloqueios cautelares ativos
app.get('/painel/api/transactions/cautionary', panelAuth, (req, res) => {
  const cautionary = db.prepare(`
    SELECT tc.*, u.firstName, u.username
    FROM transaction_controls tc
    JOIN users u ON tc.chatId = u.chatId
    WHERE tc.status = 'cautionary' AND tc.cautionary_until > datetime('now')
    ORDER BY tc.created_at DESC
  `).all();

  res.json(cautionary);
});

// Aprovar transação
app.post('/painel/api/transactions/:id/approve', panelAuth, async (req, res) => {
  const { id } = req.params;
  const { notes = '' } = req.body;

  try {
    const transaction = db.prepare(`
      SELECT * FROM transaction_controls WHERE id = ?
    `).get(id);

    if (!transaction) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    if (transaction.status !== 'pending' && transaction.status !== 'cautionary') {
      return res.status(400).json({ error: 'Transação já processada' });
    }

    // Verificar se usuário ainda tem saldo (no caso de transação muito antiga)
    const user = getUser(transaction.chatId);
    if (user.balance < transaction.amount) {
      return res.status(400).json({ error: 'Usuário não tem saldo suficiente' });
    }

    // Processar o saque usando função existente
    const success = await processWithdrawalNow(transaction.chatId, transaction.amount, transaction.pixKey);

    if (success) {
      // Atualizar status da transação
      db.prepare(`
        UPDATE transaction_controls
        SET status = 'approved', admin_action_at = datetime('now'), admin_notes = ?
        WHERE id = ?
      `).run(notes, id);

      // Audit log
      auditLog('APPROVE_TRANSACTION', req.user?.id || 'admin', transaction.chatId, {
        transactionId: id,
        amount: transaction.amount,
        notes
      });

      // Notificar cliente
      clientBot.sendMessage(transaction.chatId,
        `✅ *Saque Aprovado!*\n\nSeu saque de R$ ${transaction.amount.toFixed(2)} foi aprovado e está sendo processado.\n\n💰 PIX será enviado em alguns minutos.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});

      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Erro ao processar saque' });
    }
  } catch (error) {
    console.error('Erro ao aprovar transação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Aplicar bloqueio cautelar
app.post('/painel/api/transactions/:id/cautionary', panelAuth, (req, res) => {
  const { id } = req.params;
  const { reason = 'Análise de segurança', hours = 4 } = req.body;

  try {
    const transaction = db.prepare(`
      SELECT * FROM transaction_controls WHERE id = ?
    `).get(id);

    if (!transaction) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    const cautionaryUntil = new Date(Date.now() + hours * 60 * 60 * 1000);

    db.prepare(`
      UPDATE transaction_controls
      SET status = 'cautionary', admin_notes = ?, cautionary_until = ?, admin_action_at = datetime('now')
      WHERE id = ?
    `).run(reason, cautionaryUntil.toISOString(), id);

    // Audit log
    auditLog('CAUTIONARY_BLOCK', req.user?.id || 'admin', transaction.chatId, {
      transactionId: id,
      reason,
      hours
    });

    // Notificar cliente
    const user = getUser(transaction.chatId);
    const userName = user.firstName || 'Cliente';

    clientBot.sendMessage(transaction.chatId,
      `🔒 *TRANSAÇÃO EM ANÁLISE*\n\nOlá ${userName}, seu saque de R$ ${transaction.amount.toFixed(2)} está em análise cautelar.\n\n⏱️ **Prazo:** até ${hours} horas\n📋 **Motivo:** ${reason}\n👤 **Dúvidas:** Fale com seu gerente\n\n📱 Transação ID: #${id}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao aplicar bloqueio cautelar:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Rejeitar transação
app.post('/painel/api/transactions/:id/reject', panelAuth, (req, res) => {
  const { id } = req.params;
  const { reason = 'Transação rejeitada pela administração' } = req.body;

  try {
    const transaction = db.prepare(`
      SELECT * FROM transaction_controls WHERE id = ?
    `).get(id);

    if (!transaction) {
      return res.status(404).json({ error: 'Transação não encontrada' });
    }

    db.prepare(`
      UPDATE transaction_controls
      SET status = 'rejected', admin_notes = ?, admin_action_at = datetime('now')
      WHERE id = ?
    `).run(reason, id);

    // Audit log
    auditLog('REJECT_TRANSACTION', req.user?.id || 'admin', transaction.chatId, {
      transactionId: id,
      reason
    });

    // Devolver saldo se já foi debitado (não deveria acontecer, mas por segurança)
    addBalance(transaction.chatId, transaction.amount);

    // Notificar cliente
    clientBot.sendMessage(transaction.chatId,
      `❌ *Saque Rejeitado*\n\nSeu saque de R$ ${transaction.amount.toFixed(2)} foi rejeitado.\n\n📋 **Motivo:** ${reason}\n💰 **Saldo devolvido:** R$ ${transaction.amount.toFixed(2)}\n\n👤 Para esclarecimentos, fale com o suporte.`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao rejeitar transação:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar usuários para controle (paginado)
app.get('/painel/api/users/control', panelAuth, (req, res) => {
  const { search, limit = 50, offset = 0 } = req.query;

  let whereClause = '';
  let params = [];

  if (search) {
    whereClause = 'WHERE chatId LIKE ? OR firstName LIKE ? OR username LIKE ?';
    params = [`%${search}%`, `%${search}%`, `%${search}%`];
  }

  const users = db.prepare(`
    SELECT chatId, firstName, lastName, username, balance, createdAt, banned,
           (SELECT COUNT(*) FROM transactions WHERE transactions.chatId = users.chatId) as transactionCount
    FROM users
    ${whereClause}
    ORDER BY createdAt DESC
    LIMIT ? OFFSET ?
  `).all(...params, parseInt(limit), parseInt(offset));

  const totalCount = db.prepare(`SELECT COUNT(*) as count FROM users ${whereClause}`).get(...params).count;

  res.json({
    users,
    totalCount,
    hasMore: parseInt(offset) + parseInt(limit) < totalCount
  });
});

// Configurações de usuário
app.get('/painel/api/user/:chatId/settings', panelAuth, (req, res) => {
  const { chatId } = req.params;

  let settings = db.prepare(`
    SELECT * FROM user_settings WHERE chatId = ?
  `).get(chatId);

  if (!settings) {
    // Criar configurações padrão
    db.prepare(`
      INSERT INTO user_settings (chatId) VALUES (?)
    `).run(chatId);

    settings = db.prepare(`
      SELECT * FROM user_settings WHERE chatId = ?
    `).get(chatId);
  }

  res.json(settings);
});

app.post('/painel/api/user/:chatId/settings', panelAuth, (req, res) => {
  const { chatId } = req.params;
  const settings = req.body;

  try {
    db.prepare(`
      INSERT OR REPLACE INTO user_settings
      (chatId, auto_approve_limit, requires_manual_approval, withdrawals_blocked,
       daily_limit, monthly_limit, alert_high_value, alert_new_pix_key,
       alert_multiple_withdrawals, alert_night_hours, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      chatId,
      settings.auto_approve_limit || 1000,
      settings.requires_manual_approval ? 1 : 0,
      settings.withdrawals_blocked ? 1 : 0,
      settings.daily_limit || 10000,
      settings.monthly_limit || 50000,
      settings.alert_high_value || 5000,
      settings.alert_new_pix_key ? 1 : 0,
      settings.alert_multiple_withdrawals ? 1 : 0,
      settings.alert_night_hours ? 1 : 0
    );

    // Audit log
    auditLog('UPDATE_USER_SETTINGS', req.user?.id || 'admin', chatId, settings);

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao salvar configurações:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Definir gateway preferido do usuário
app.post('/painel/api/user/:chatId/set-gateway', panelAuth, (req, res) => {
  const { chatId } = req.params;
  const { gateway } = req.body;

  const validGateways = ['XPayTech', 'PagNet', 'FluxoPay', 'SharkBanking', 'PodPay'];

  if (!validGateways.includes(gateway)) {
    return res.status(400).json({ error: 'Gateway inválido' });
  }

  try {
    db.prepare(`
      UPDATE users SET preferred_gateway = ? WHERE chatId = ?
    `).run(gateway, chatId);

    // Audit log
    auditLog('SET_PREFERRED_GATEWAY', req.user?.id || 'admin', chatId, { gateway });

    res.json({ success: true, gateway });
  } catch (error) {
    console.error('Erro ao definir gateway:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Obter gateway preferido do usuário
app.get('/painel/api/user/:chatId/gateway', panelAuth, (req, res) => {
  const { chatId } = req.params;

  try {
    const user = db.prepare('SELECT preferred_gateway FROM users WHERE chatId = ?').get(chatId);

    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }

    res.json({ gateway: user.preferred_gateway || 'XPayTech' });
  } catch (error) {
    console.error('Erro ao buscar gateway:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Listar gateways disponíveis
app.get('/painel/api/gateways/available', panelAuth, (req, res) => {
  const gateways = [
    { id: 'XPayTech', name: 'XPayTech', active: true },
    { id: 'PagNet', name: 'PagNet', active: true },
    { id: 'FluxoPay', name: 'FluxoPay', active: true },
    { id: 'SharkBanking', name: 'SharkBanking', active: true },
    { id: 'PodPay', name: 'PodPay', active: true }
  ];

  res.json(gateways);
});

// Bloquear/desbloquear saques de usuário
app.post('/painel/api/user/:chatId/toggle-withdrawals', panelAuth, (req, res) => {
  const { chatId } = req.params;
  const { blocked, reason = '' } = req.body;

  try {
    db.prepare(`
      INSERT OR REPLACE INTO user_settings
      (chatId, withdrawals_blocked, updated_at)
      VALUES (?, ?, datetime('now'))
    `).run(chatId, blocked ? 1 : 0);

    // Audit log
    auditLog(blocked ? 'BLOCK_WITHDRAWALS' : 'UNBLOCK_WITHDRAWALS', req.user?.id || 'admin', chatId, { reason });

    // Notificar cliente
    const user = getUser(chatId);
    if (blocked) {
      clientBot.sendMessage(chatId,
        `🚫 *Saques Temporariamente Bloqueados*\n\nOlá ${user.firstName || 'Cliente'}, seus saques foram temporariamente suspensos.\n\n📋 **Motivo:** ${reason}\n👤 **Contato:** Fale com seu gerente\n\n🔓 Esta medida é temporária e será revista em breve.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    } else {
      clientBot.sendMessage(chatId,
        `✅ *Saques Liberados*\n\nOlá ${user.firstName || 'Cliente'}, seus saques foram liberados!\n\nVocê já pode fazer saques normalmente.\n\n💰 Use /sacar para sacar seu saldo.`,
        { parse_mode: 'Markdown' }
      ).catch(() => {});
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao alterar bloqueio de saques:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Logs de auditoria
app.get('/painel/api/audit', panelAuth, (req, res) => {
  const { limit = 100, chatId } = req.query;

  let query = `
    SELECT a.*, u.firstName, u.username
    FROM admin_audit a
    LEFT JOIN users u ON a.target_chatId = u.chatId
    ORDER BY a.created_at DESC
    LIMIT ?
  `;

  let params = [parseInt(limit)];

  if (chatId) {
    query = `
      SELECT a.*, u.firstName, u.username
      FROM admin_audit a
      LEFT JOIN users u ON a.target_chatId = u.chatId
      WHERE a.target_chatId = ?
      ORDER BY a.created_at DESC
      LIMIT ?
    `;
    params = [chatId, parseInt(limit)];
  }

  const logs = db.prepare(query).all(...params);
  res.json(logs);
});

// Dashboard stats
app.get('/painel/api/dashboard', panelAuth, (req, res) => {
  try {
    const stats = {
      totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get().count,
      activeToday: db.prepare(`
        SELECT COUNT(*) as count FROM users
        WHERE last_activity > datetime('now', '-24 hours')
      `).get().count,
      totalBalance: db.prepare('SELECT SUM(balance) as sum FROM users').get().sum || 0,
      pendingApprovals: db.prepare(`
        SELECT COUNT(*) as count FROM transaction_controls WHERE status = 'pending'
      `).get().count,
      cautionaryBlocks: db.prepare(`
        SELECT COUNT(*) as count FROM transaction_controls
        WHERE status = 'cautionary' AND cautionary_until > datetime('now')
      `).get().count,
      blockedUsers: db.prepare(`
        SELECT COUNT(*) as count FROM user_settings WHERE withdrawals_blocked = 1
      `).get().count,
      todayDeposits: getTodayDeposits(),
      todayWithdrawals: getTodayWithdrawals(),
      thisMonthRevenue: getMonthRevenue()
    };

    res.json(stats);
  } catch (error) {
    console.error('Erro ao buscar estatísticas:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
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
  const depositResult     = completeDeposit(orderId);
  const novoSaldo         = depositResult?.user?.balance ?? null;
  const feeAmount         = depositResult?.tx?.fee || 0;
  const netAmount         = depositResult?.tx?.netAmount ?? amountReais;
  const commissionResult  = depositResult?.commissionResult || null;
  // Mantém compatibilidade com código anterior que usava referralBonus
  const referralBonus     = null;

  const valorFormatado = formatBRL(amountReais);
  const dataHora       = extra.paidAt ? formatDate(extra.paidAt) : nowBR();

  let msgCliente =
    `🎉 *DEPÓSITO CONFIRMADO!* ✅\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Valor pago:* R$ ${valorFormatado}\n`;

  if (feeAmount > 0) {
    msgCliente += `📊 *Taxa:* R$ ${formatBRL(feeAmount)}\n`;
    msgCliente += `✅ *Valor creditado:* R$ ${formatBRL(netAmount)}\n`;
  }

  msgCliente += `📅 *Data:* ${dataHora}\n`;

  if (novoSaldo !== null) {
    msgCliente += `💳 *Saldo atual:* R$ ${formatBRL(novoSaldo)}\n`;
  }

  msgCliente +=
    `━━━━━━━━━━━━━━━━━━━━\n\n` +
    `Use /saldo para ver sua conta ou /sacar para retirar. 🚀`;

  clientBot.sendMessage(chatId, msgCliente, { parse_mode: 'Markdown' })
    .catch(e => console.error('[notify] Erro cliente:', e.message));

  // Notificar gerente sobre comissão recebida
  if (commissionResult) {
    const managerUser = getUser(commissionResult.managerId);
    const novoSaldoGerente = managerUser?.balance ?? 0;
    clientBot.sendMessage(
      commissionResult.managerId,
      `💰 *Comissão Recebida!*\n\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 *Cliente:* ${depositResult.user?.firstName || chatId}\n` +
      `💵 *Depósito do cliente:* R$ ${valorFormatado}\n` +
      `📊 *Taxa cobrada:* ${commissionResult.feePct}%\n` +
      `📊 *Taxa base (dono):* ${commissionResult.commissionRatePct}%\n` +
      `💰 *Sua comissão (spread):* R$ ${formatBRL(commissionResult.managerCommission)}\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `💳 *Seu saldo atual:* R$ ${formatBRL(novoSaldoGerente)}`,
      { parse_mode: 'Markdown' }
    ).catch(() => {});
  }

  let adminMsg =
    `💸 *NOVO DEPÓSITO RECEBIDO!*\n\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `💰 *Valor:* R$ ${valorFormatado}\n` +
    `🏦 *Gateway:* ${provider}\n` +
    `👤 *Chat ID:* \`${chatId}\`\n`;

  if (feeAmount > 0) adminMsg += `📊 *Taxa total:* R$ ${formatBRL(feeAmount)} (${depositResult?.user?.depositFee || 0}%)\n`;
  if (extra.pagador)  adminMsg += `👤 *Pagador:* ${extra.pagador}\n`;
  if (extra.cpf)      adminMsg += `📄 *CPF:* \`${extra.cpf}\`\n`;
  if (extra.txId)     adminMsg += `🆔 *ID:* \`${extra.txId}\`\n`;
  if (commissionResult) {
    adminMsg += `🤝 *Gerente:* ${commissionResult.managerName || commissionResult.managerId}` +
                ` — comissão R$ ${formatBRL(commissionResult.managerCommission)}` +
                ` | dono R$ ${formatBRL(commissionResult.ownerCut)}\n`;
  }
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
    `❌ *Depósito não confirmado.*\n\n😕 Sua cobrança foi cancelada ou expirou.\nGere uma nova com /pix se quiser tentar novamente.`,
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

// ══════════════════════════════════
// FUNÇÕES AUXILIARES PARA CONTROLES
// ══════════════════════════════════

// Verificar se transação precisa de aprovação
function checkTransactionNeedsApproval(chatId, amount, pixKey) {
  const settings = db.prepare(`
    SELECT * FROM user_settings WHERE chatId = ?
  `).get(chatId);

  if (!settings) return false; // Sem configurações = aprovação automática

  if (settings.withdrawals_blocked) return true;
  if (settings.requires_manual_approval) return true;
  if (amount > settings.auto_approve_limit) return true;

  // Verificar alertas adicionais
  if (settings.alert_high_value && amount > settings.alert_high_value) return true;

  // Verificar se é chave PIX nova (se habilitado)
  if (settings.alert_new_pix_key) {
    const previousWithdraw = db.prepare(`
      SELECT COUNT(*) as count FROM transactions
      WHERE chatId = ? AND type = 'withdrawal' AND note LIKE ?
      AND status = 'completed'
    `).get(chatId, `%${pixKey}%`);

    if (previousWithdraw.count === 0) return true; // Chave nova
  }

  // Verificar múltiplos saques no dia (se habilitado)
  if (settings.alert_multiple_withdrawals) {
    const todayWithdraws = db.prepare(`
      SELECT COUNT(*) as count FROM transactions
      WHERE chatId = ? AND type = 'withdrawal'
      AND date(createdAt) = date('now')
    `).get(chatId);

    if (todayWithdraws.count >= 5) return true; // Mais de 5 saques hoje
  }

  // Verificar horário noturno (se habilitado)
  if (settings.alert_night_hours) {
    const hour = new Date().getHours();
    if (hour >= 23 || hour <= 5) return true; // Entre 23h e 5h
  }

  return false;
}

// Gerar ID único para transação
function generateTransactionId() {
  return `tx_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

// Processar saque imediatamente (para aprovações)
async function processWithdrawalNow(chatId, amount, pixKey) {
  try {
    // Usar a função existente de saque
    const result = await createWithdrawalTx(chatId, amount, pixKey);
    return result !== null;
  } catch (error) {
    console.error('Erro ao processar saque:', error);
    return false;
  }
}

// Função de auditoria
function auditLog(action, adminUser, targetChatId, details) {
  try {
    db.prepare(`
      INSERT INTO admin_audit (admin_user, action, target_chatId, details, created_at)
      VALUES (?, ?, ?, ?, datetime('now'))
    `).run(adminUser || 'system', action, targetChatId, JSON.stringify(details));
  } catch (error) {
    console.error('Erro ao salvar audit log:', error);
  }
}

// Estatísticas auxiliares
function getTodayDeposits() {
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions
    WHERE type = 'deposit' AND status = 'completed'
    AND date(createdAt) = date('now')
  `).get();

  return result.total || 0;
}

function getTodayWithdrawals() {
  const result = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions
    WHERE type = 'withdrawal' AND status = 'completed'
    AND date(createdAt) = date('now')
  `).get();

  return result.total || 0;
}

function getMonthRevenue() {
  // Calcular receita do mês (taxas de depósito)
  const result = db.prepare(`
    SELECT COALESCE(SUM(fee), 0) as total FROM transactions
    WHERE status = 'completed'
    AND strftime('%Y-%m', createdAt) = strftime('%Y-%m', 'now')
  `).get();

  return result.total || 0;
}

// Verificar limites diários de saque
function checkDailyWithdrawLimit(chatId, amount) {
  const settings = db.prepare(`
    SELECT daily_limit FROM user_settings WHERE chatId = ?
  `).get(chatId);

  const dailyLimit = settings?.daily_limit || 10000;

  const todayWithdraws = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total FROM transactions
    WHERE chatId = ? AND type = 'withdrawal' AND status = 'completed'
    AND date(createdAt) = date('now')
  `).get(chatId);

  return (todayWithdraws.total + amount) <= dailyLimit;
}

// ==========================
// INICIALIZAÇÃO
// ==========================
const PORT = process.env.PORT || 3000;

configReady.then(() => {
  // Busca username dinâmico do bot cliente
  clientBot.getMe().then(me => {
    CLIENT_BOT_USERNAME = me.username || '';
    console.log(`🤖 [Bot] Username: @${CLIENT_BOT_USERNAME}`);
  }).catch(e => console.warn('⚠️  Não foi possível obter username do bot:', e.message));

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
