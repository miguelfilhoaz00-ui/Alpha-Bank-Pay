const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const DATA_DIR    = process.env.DATA_DIR || path.join(__dirname, '../data');
const STATS_FILE  = path.join(DATA_DIR, 'stats.json');
const MAX_HISTORY = 50;

// ==========================
// ESTRUTURA PADRÃO
// ==========================
function emptyDay(date) {
  return { date, count: 0, total: 0 };
}

function todayStr() {
  return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

let data = {
  today:   emptyDay(todayStr()),
  history: []
};

// ==========================
// CLOUD BACKUP — Upstash Redis (opcional, mesmo do config.js)
// ==========================
const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CLOUD_KEY     = 'copypix_stats';

async function cloudSave(payload) {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return;
  try {
    await axios.post(
      UPSTASH_URL,
      ['SET', CLOUD_KEY, JSON.stringify(payload)],
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, timeout: 5000 }
    );
  } catch (e) {
    console.warn('⚠️  [Stats] Falha no backup cloud:', e.message);
  }
}

async function cloudLoad() {
  if (!UPSTASH_URL || !UPSTASH_TOKEN) return null;
  try {
    const r = await axios.post(
      UPSTASH_URL,
      ['GET', CLOUD_KEY],
      { headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }, timeout: 5000 }
    );
    if (r.data?.result) return JSON.parse(r.data.result);
  } catch (e) {
    console.warn('⚠️  [Stats] Falha ao carregar cloud:', e.message);
  }
  return null;
}

// ==========================
// PERSISTÊNCIA LOCAL
// ==========================
function loadFromFile() {
  try {
    if (fs.existsSync(STATS_FILE)) {
      data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
      return true;
    }
  } catch (e) {
    console.warn('⚠️  [Stats] Erro ao carregar disco:', e.message);
  }
  return false;
}

function saveToFile() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    console.warn('⚠️  [Stats] Erro ao salvar disco:', e.message);
  }
}

function save() {
  saveToFile();
  cloudSave(data).catch(() => {});
}

// Inicialização
(async () => {
  const foundLocally = loadFromFile();
  if (!foundLocally) {
    const cloud = await cloudLoad();
    if (cloud) {
      data = cloud;
      saveToFile();
      console.log('☁️  [Stats] Stats restauradas do cloud!');
    }
  }
})();

// ==========================
// REGISTRAR PAGAMENTO
// ==========================
function record({ amountReais, provider, chatId, paidAt }) {
  const today = todayStr();

  if (data.today.date !== today) {
    data.today = emptyDay(today);
  }

  data.today.count += 1;
  data.today.total += amountReais;

  data.history.unshift({
    amountReais,
    provider,
    chatId:  String(chatId),
    paidAt:  paidAt || new Date().toISOString()
  });

  if (data.history.length > MAX_HISTORY) {
    data.history = data.history.slice(0, MAX_HISTORY);
  }

  save();
  console.log(`📊 [Stats] +R$ ${amountReais.toFixed(2)} | Hoje: ${data.today.count} pagamentos | Total: R$ ${data.today.total.toFixed(2)}`);
}

// ==========================
// CONSULTAS
// ==========================
function getToday() {
  const today = todayStr();
  if (data.today.date !== today) {
    data.today = emptyDay(today);
  }
  return data.today;
}

function getHistory(limit = 10) {
  return data.history.slice(0, limit);
}

module.exports = { record, getToday, getHistory };
