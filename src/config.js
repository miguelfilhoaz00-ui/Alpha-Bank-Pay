const fs    = require('fs');
const path  = require('path');
const axios = require('axios');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '../data');
const CONFIG_FILE = path.join(DATA_DIR, 'providers.json');

// ==========================
// CONFIGURAÇÃO PADRÃO
// ==========================
const DEFAULT_CONFIG = {
  pagnet: {
    label: 'PagNet', min: 100, max: 1999, enabled: true, color: '#3b82f6'
  },
  fluxopay: {
    label: 'FluxoPay', min: 5001, max: 14999, enabled: true, color: '#8b5cf6'
  },
  podpay: {
    label: 'PodPay', min: 5001, max: 14999, enabled: false, color: '#f59e0b'
  },
  sharkbanking: {
    label: 'SharkBanking', min: 2000, max: 4000, enabled: true, color: '#06b6d4'
  },
  xpaytech: {
    label: 'XPayTech', min: 15000, max: 99999, enabled: false, color: '#10b981'
  }
};

let config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

// ==========================
// TELEGRAM COMO BANCO DE DADOS
// — Armazena config como mensagem fixada num canal/grupo privado
// — Não precisa de nenhum serviço externo, 100% gratuito
// — Para ativar: crie canal privado, add o admin bot como admin
//   e defina TELEGRAM_STORAGE_CHANNEL no Render
// ==========================
const TG_CHANNEL  = process.env.TELEGRAM_STORAGE_CHANNEL;
const TG_TOKEN    = process.env.ADMIN_BOT_TOKEN;
const TG_PREFIX   = '📦COPYPIX_CONFIG\n';
const TG_API      = (method) => `https://api.telegram.org/bot${TG_TOKEN}/${method}`;

let _pinnedMsgId = null; // ID da mensagem fixada no canal

async function telegramSave(data) {
  if (!TG_CHANNEL || !TG_TOKEN) return;
  const text = TG_PREFIX + JSON.stringify(data);

  try {
    if (_pinnedMsgId) {
      // Atualiza a mensagem já existente
      await axios.post(TG_API('editMessageText'), {
        chat_id:    TG_CHANNEL,
        message_id: _pinnedMsgId,
        text
      }, { timeout: 8000 });
    } else {
      // Primeira vez: envia e fixa
      const sent = await axios.post(TG_API('sendMessage'), {
        chat_id:              TG_CHANNEL,
        text,
        disable_notification: true
      }, { timeout: 8000 });
      _pinnedMsgId = sent.data.result.message_id;
      await axios.post(TG_API('pinChatMessage'), {
        chat_id:              TG_CHANNEL,
        message_id:           _pinnedMsgId,
        disable_notification: true
      }, { timeout: 8000 });
    }
    console.log('📌 [Config] Backup salvo no Telegram.');
  } catch (e) {
    console.warn('⚠️  [Config] Falha ao salvar no Telegram:', e.response?.data?.description || e.message);
  }
}

async function telegramLoad() {
  if (!TG_CHANNEL || !TG_TOKEN) return null;
  try {
    const r = await axios.get(TG_API('getChat'), {
      params:  { chat_id: TG_CHANNEL },
      timeout: 8000
    });
    const pinned = r.data.result?.pinned_message;
    if (pinned?.text?.startsWith(TG_PREFIX)) {
      _pinnedMsgId = pinned.message_id;
      const parsed = JSON.parse(pinned.text.slice(TG_PREFIX.length));
      console.log('📌 [Config] Restaurada do Telegram com sucesso!');
      return parsed;
    }
  } catch (e) {
    console.warn('⚠️  [Config] Falha ao carregar do Telegram:', e.response?.data?.description || e.message);
  }
  return null;
}

// ==========================
// UPSTASH REDIS (backup opcional adicional)
// ==========================
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

async function upstashSave(data) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await axios.post(UPSTASH_URL, ['SET', 'copypix_providers', JSON.stringify(data)], {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, timeout: 5000
    });
  } catch (e) {
    console.warn('⚠️  [Config] Upstash save falhou:', e.message);
  }
}

async function upstashLoad() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await axios.post(UPSTASH_URL, ['GET', 'copypix_providers'], {
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, timeout: 5000
    });
    if (r.data?.result) return JSON.parse(r.data.result);
  } catch (e) {
    console.warn('⚠️  [Config] Upstash load falhou:', e.message);
  }
  return null;
}

// ==========================
// DISCO LOCAL
// ==========================
function loadFromFile() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const saved = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      for (const id of Object.keys(config)) {
        if (saved[id]) {
          if (typeof saved[id].enabled === 'boolean') config[id].enabled = saved[id].enabled;
          if (typeof saved[id].min     === 'number')  config[id].min     = saved[id].min;
          if (typeof saved[id].max     === 'number')  config[id].max     = saved[id].max;
        }
      }
      console.log('📂 [Config] Carregada do disco.');
      return true;
    }
  } catch (e) {
    console.warn('⚠️  [Config] Disco:', e.message);
  }
  return false;
}

function saveToFile() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️  [Config] Erro ao salvar disco:', e.message);
  }
}

function applyData(source) {
  for (const id of Object.keys(config)) {
    if (source[id]) {
      if (typeof source[id].enabled === 'boolean') config[id].enabled = source[id].enabled;
      if (typeof source[id].min     === 'number')  config[id].min     = source[id].min;
      if (typeof source[id].max     === 'number')  config[id].max     = source[id].max;
    }
  }
}

// ==========================
// INICIALIZAÇÃO
// Ordem de prioridade:
// 1. Disco local (rápido, válido enquanto container viver)
// 2. Telegram (persiste para sempre, 100% grátis)
// 3. Upstash Redis (se configurado)
// 4. Config padrão
// ==========================
const readyPromise = (async () => {
  const foundOnDisk = loadFromFile();

  if (!foundOnDisk) {
    console.log('ℹ️  [Config] Disco vazio, tentando restaurar backup...');

    const tgData = await telegramLoad();
    if (tgData) {
      applyData(tgData);
      saveToFile();
      console.log('✅ [Config] Restaurada do Telegram e salva em disco.');
      return;
    }

    const upData = await upstashLoad();
    if (upData) {
      applyData(upData);
      saveToFile();
      console.log('✅ [Config] Restaurada do Upstash e salva em disco.');
      return;
    }

    console.log('ℹ️  [Config] Usando configuração padrão.');
  }
})();

// ==========================
// SALVAR (disco + Telegram + Upstash)
// ==========================
function save() {
  saveToFile();
  telegramSave(config).catch(() => {});
  upstashSave(config).catch(() => {});
}

// ==========================
// API PÚBLICA
// ==========================
function getAll() { return config; }

function toggle(id) {
  if (!config[id]) return null;
  config[id].enabled = !config[id].enabled;
  save();
  console.log(`🔄 [Config] "${id}" → ${config[id].enabled ? '✅ LIGADO' : '❌ DESLIGADO'}`);
  return config[id];
}

function updateRange(id, min, max) {
  if (!config[id]) return null;
  if (isNaN(min) || isNaN(max) || min < 1 || max <= min) return null;
  config[id].min = Math.round(min);
  config[id].max = Math.round(max);
  save();
  console.log(`📐 [Config] "${id}" faixa → R$ ${min} – R$ ${max}`);
  return config[id];
}

module.exports = { getAll, toggle, updateRange, ready: readyPromise };
