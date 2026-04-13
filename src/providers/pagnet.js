const axios = require('axios');
const crypto = require('crypto');

// ==========================
// DADOS ALEATÓRIOS
// ==========================
const firstNames = ['Lucas', 'Mariana', 'Rafael', 'Juliana', 'Bruno', 'Camila', 'Gabriel', 'Fernanda', 'Pedro', 'Ana'];
const lastNames  = ['Almeida', 'Santos', 'Ferreira', 'Costa', 'Rodrigues', 'Nogueira', 'Oliveira', 'Pereira'];
const emailDomains = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com'];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCPF() {
  const cpf = Array.from({ length: 9 }, () => Math.floor(Math.random() * 9));
  const calc = (factor) => cpf.reduce((sum, num, i) => sum + num * (factor - i), 0);
  cpf.push((calc(10) * 10) % 11 % 10);
  cpf.push((calc(11) * 10) % 11 % 10);
  return cpf.join('');
}

function generateCustomer() {
  const first = randomItem(firstNames);
  const last  = randomItem(lastNames);
  const hash  = crypto.randomInt(1000, 9999);
  return {
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}+${hash}@${randomItem(emailDomains)}`,
    phone: `11${crypto.randomInt(900000000, 999999999)}`,
    document: { type: 'cpf', number: generateCPF() }
  };
}

// ==========================
// CRIAR PIX — PAGNET
// ==========================
async function createPix(chatId, amountReais) {
  const amountCents = Math.round(amountReais * 100);
  const orderId     = `pagnet_${chatId}_${Date.now()}`;
  const auth        = 'Basic ' + Buffer.from(`${process.env.PAGNET_PUBLIC_KEY}:${process.env.PAGNET_SECRET_KEY}`).toString('base64');
  const customer    = generateCustomer();

  const payload = {
    paymentMethod: 'pix',
    amount: amountCents,
    pix: { expiresInDays: 1 },
    customer,
    externalRef: orderId,
    postbackUrl: process.env.PAGNET_POSTBACK_URL,
    items: [{
      title: 'Pagamento via Telegram',
      quantity: 1,
      tangible: false,
      unitPrice: amountCents
    }],
    metadata: JSON.stringify({
      source: 'copypix_bot',
      chatId,
      generatedAt: new Date().toISOString()
    })
  };

  console.log(`📤 [PagNet] Criando PIX R$ ${amountReais.toFixed(2)} | chatId: ${chatId}`);

  const response = await axios.post(
    'https://api.pagnetbrasil.com/v1/transactions',
    payload,
    { headers: { Authorization: auth, 'Content-Type': 'application/json' } }
  );

  const trx = response.data;
  console.log(`✅ [PagNet] PIX gerado | orderId: ${orderId}`);

  return {
    orderId,
    qrCode:    trx.pix.qrcode,
    expiresIn: '24 horas'
  };
}

module.exports = { createPix };
