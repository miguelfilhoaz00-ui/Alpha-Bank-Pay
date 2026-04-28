const axios = require('axios');

const BASE_URL = 'https://api.veopag.com';

// ==========================
// CACHE DE TOKEN JWT (validade 1h, refresh em 55min)
// ==========================
let cachedToken  = null;
let cachedUntil  = 0;
let loginPromise = null;

async function getToken() {
  const now = Date.now();
  if (cachedToken && now < cachedUntil) return cachedToken;
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    console.log('🔑 [VeoPag] Solicitando novo token...');
    const { data } = await axios.post(`${BASE_URL}/api/auth/login`, {
      client_id:     process.env.VEOPAG_CLIENT_ID,
      client_secret: process.env.VEOPAG_CLIENT_SECRET
    }, { timeout: 10000 });

    cachedToken = data.token;
    cachedUntil = Date.now() + 55 * 60 * 1000;
    console.log('✅ [VeoPag] Token obtido. Válido por 55min.');
    return cachedToken;
  })().finally(() => { loginPromise = null; });

  return loginPromise;
}

// ==========================
// AUTH HELPER — auto-retry em 401
// ==========================
async function authedRequest(method, path, body = null, retried = false) {
  const token = await getToken();
  try {
    const resp = await axios({
      method,
      url:     `${BASE_URL}${path}`,
      data:    body,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json'
      },
      timeout: 30000
    });
    return resp.data;
  } catch (err) {
    if (err.response?.status === 401 && !retried) {
      cachedToken = null;
      cachedUntil = 0;
      return authedRequest(method, path, body, true);
    }
    throw err;
  }
}

// ==========================
// MAPEAR TIPO DE CHAVE PIX → key_type da VeoPag
// ==========================
function mapKeyType(pixKeyType) {
  const map = {
    'CPF':       'CPF',
    'CNPJ':      'CNPJ',
    'EMAIL':     'EMAIL',
    'PHONE':     'PHONE',
    'EVP':       'EVP',
    'COPIAECOLA':'COPIAECOLA'
  };
  return map[(pixKeyType || '').toUpperCase()] || 'EVP';
}

function detectKeyType(pixKey) {
  const k = (pixKey || '').trim();
  if (/^\d{11}$/.test(k)) return 'CPF';
  if (/^\d{14}$/.test(k)) return 'CNPJ';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(k)) return 'EMAIL';
  if (/^(\+?55)?\d{10,11}$/.test(k.replace(/\D/g, ''))) return 'PHONE';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k)) return 'EVP';
  if (k.length > 50 && k.startsWith('00020')) return 'COPIAECOLA';
  return 'EVP';
}

// ==========================
// NORMALIZAR PIX_KEY
// ==========================
function normalizeKey(pixKey, keyType) {
  const k = (pixKey || '').trim();
  if (keyType === 'CPF' || keyType === 'CNPJ') return k.replace(/\D/g, '');
  if (keyType === 'EMAIL') return k.toLowerCase();
  if (keyType === 'PHONE') {
    const digits = k.replace(/\D/g, '');
    return digits.startsWith('55') ? `+${digits}` : `+55${digits}`;
  }
  return k;
}

// ==========================
// MAPEAR STATUS DA VEOPAG → status interno
// ==========================
function mapStatus(s) {
  const map = {
    'PENDING':              'pending',
    'QUEUE':                'pending',
    'PROCESSING':           'pending',
    'COMPLETED':            'completed',
    'FAILED':               'failed',
    'REFUNDED':             'failed',
    'PARTIALLY_REFUNDED':   'failed'
  };
  return map[(s || '').toUpperCase()] || 'pending';
}

// ==========================
// SAQUE PIX — VEOPAG
// ==========================
async function createWithdrawal(pixKey, amountReais, pixKeyType, txId, opts = {}) {
  try {
    if (!process.env.VEOPAG_CLIENT_ID || !process.env.VEOPAG_CLIENT_SECRET) {
      throw new Error('VEOPAG_CLIENT_ID / VEOPAG_CLIENT_SECRET não configurados');
    }
    if (!pixKey || !amountReais || amountReais < 1) {
      throw new Error('Parâmetros inválidos: pixKey e amount obrigatórios');
    }

    const keyType    = mapKeyType(pixKeyType || detectKeyType(pixKey));
    const normalized = normalizeKey(pixKey, keyType);
    const externalId = `veo_out_${txId}_${Date.now()}`;

    const payload = {
      amount:            Number(amountReais.toFixed(2)),
      external_id:       externalId,
      pix_key:           normalized,
      key_type:          keyType,
      description:       opts.description || 'Saque PIX',
      clientCallbackUrl: process.env.VEOPAG_WEBHOOK_URL ||
                         `${(process.env.APP_URL || '').replace(/\/$/, '')}/webhook/veopag`
    };

    // taxId obrigatório para EMAIL, PHONE, EVP, COPIAECOLA
    if (['EMAIL', 'PHONE', 'EVP', 'COPIAECOLA'].includes(keyType)) {
      const taxId = (opts.taxId || '').replace(/\D/g, '');
      if (!taxId) throw new Error(`taxId é obrigatório para chave ${keyType}`);
      payload.taxId = taxId;
    }
    if (opts.name) payload.name = opts.name;

    console.log(`📤 [VeoPag] Saque R$ ${amountReais.toFixed(2)} | externalId: ${externalId} | keyType: ${keyType}`);

    const data = await authedRequest('POST', '/api/withdrawals/withdraw', payload);

    const w = data.withdrawal || data;
    console.log(`✅ [VeoPag] Saque aceito | transactionId: ${w.transaction_id} | status: ${w.status}`);

    return {
      success: true,
      data: {
        id:         w.transaction_id,
        orderId:    externalId,
        status:     mapStatus(w.status),
        amount:     w.amount  ?? amountReais,
        fee:        w.fee     ?? 0,
        total:      w.total   ?? amountReais,
        provider:   'veopag',
        externalId
      }
    };
  } catch (err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    console.error('❌ [VeoPag] Erro saque:', status, body || err.message);

    let msg = 'Erro VeoPag';
    if (status === 401)      msg = 'Autenticação VeoPag falhou — verifique CLIENT_ID/SECRET';
    else if (status === 403) msg = body?.message || 'IP não autorizado na VeoPag';
    else if (status === 400) msg = body?.message || 'Dados inválidos para saque VeoPag';
    else if (status === 429) msg = body?.message || 'Rate limit/cooldown VeoPag';
    else if (body?.message)  msg = body.message;
    else if (err.message)    msg = err.message;

    return { success: false, error: msg, details: body || err.message };
  }
}

// ==========================
// CONSULTAR SAQUE
// ==========================
async function getWithdrawal(externalId) {
  try {
    const data = await authedRequest('GET', `/api/transactions/withdraw?external_id=${encodeURIComponent(externalId)}`);
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

// ==========================
// CONSULTAR SALDO
// ==========================
async function getBalance() {
  try {
    const data = await authedRequest('GET', '/api/accounts/balance');
    return { success: true, data };
  } catch (err) {
    return { success: false, error: err.response?.data?.message || err.message };
  }
}

module.exports = {
  createWithdrawal,
  getWithdrawal,
  getBalance,
  mapStatus,
  detectKeyType
};
