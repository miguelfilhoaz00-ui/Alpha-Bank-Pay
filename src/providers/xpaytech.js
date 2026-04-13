const axios = require('axios');

const BASE_URL = 'https://api.xpaytech.com.br';

// ==========================
// CACHE DE TOKEN
// Evita fazer login a cada PIX — o token dura 3600s
// ==========================
let _token       = null;
let _tokenExpiry = 0; // timestamp em ms

async function getToken() {
  const now = Date.now();

  // Renova se não tiver token ou se faltar menos de 5 minutos para expirar
  if (_token && now < _tokenExpiry - 5 * 60 * 1000) {
    return _token;
  }

  console.log('🔑 [XPayTech] Fazendo login para obter token...');

  const response = await axios.post(
    `${BASE_URL}/api/account/login`,
    {
      username: process.env.XPAYTECH_USERNAME,
      password: process.env.XPAYTECH_PASSWORD
    },
    {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      timeout: 15000
    }
  );

  _token       = response.data.access_token;
  const expiresIn = response.data.expires_in || 3600; // segundos
  _tokenExpiry = now + expiresIn * 1000;

  console.log(`✅ [XPayTech] Token obtido. Válido por ${expiresIn}s.`);
  return _token;
}

// ==========================
// CRIAR PIX — XPAYTECH
// ==========================
async function createPix(chatId, amountReais) {
  const orderId = `xpay_${chatId}_${Date.now()}`;
  const token   = await getToken();

  const payload = {
    amount:      amountReais,          // API aceita valor em reais (number)
    webhook:     process.env.XPAYTECH_WEBHOOK_URL,
    externalId:  orderId,
    description: 'Pagamento via Telegram'
  };

  console.log(`📤 [XPayTech] Criando PIX R$ ${amountReais.toFixed(2)} | chatId: ${chatId} | orderId: ${orderId}`);

  const response = await axios.post(
    `${BASE_URL}/api/order/pay-in`,
    payload,
    {
      headers: {
        Authorization:  `Bearer ${token}`,
        Accept:         'application/json',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  const data = response.data?.data || response.data;
  console.log(`✅ [XPayTech] PIX gerado | orderId: ${orderId} | id: ${data.id}`);

  return {
    orderId,
    qrCode:    data.brcode,   // código copia e cola
    expiresIn: '30 minutos'
  };
}

module.exports = { createPix };
