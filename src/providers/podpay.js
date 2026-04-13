const axios = require('axios');

const BASE_URL = 'https://api.podpay.app';

// ==========================
// DADOS ALEATÓRIOS
// ==========================
const nomes = [
  'João Silva', 'Maria Oliveira', 'Pedro Santos', 'Ana Costa',
  'Lucas Mendes', 'Fernanda Lima', 'Rafael Souza', 'Camila Rocha',
  'Gabriel Ferreira', 'Beatriz Alves', 'Carlos Pereira', 'Juliana Martins'
];

function gerarCPFValido() {
  let cpf = '';
  for (let i = 0; i < 9; i++) cpf += Math.floor(Math.random() * 10);

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  cpf += resto === 10 ? '0' : String(resto);

  soma = 0;
  for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
  resto = (soma * 10) % 11;
  cpf += resto === 10 ? '0' : String(resto);

  return cpf;
}

function gerarTelefone() {
  const ddds = ['11', '21', '31', '41', '51', '61', '71', '81', '91'];
  const ddd  = ddds[Math.floor(Math.random() * ddds.length)];
  return `${ddd}9${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`;
}

// ==========================
// CRIAR PIX — PODPAY
// ==========================
async function createPix(chatId, amountReais) {
  const amountCents = Math.round(amountReais * 100);
  const nome        = nomes[Math.floor(Math.random() * nomes.length)];
  const cpf         = gerarCPFValido();
  const email       = `${nome.toLowerCase().replace(/\s+/g, '.')}${Math.floor(Math.random() * 900) + 100}@exemplo.com`;
  const telefone    = gerarTelefone();

  const payload = {
    paymentMethod: 'pix',
    amount:        amountCents,
    postbackUrl:   process.env.PODPAY_POSTBACK_URL,
    customer: {
      name:  nome,
      email: email,
      phone: telefone,
      document: {
        type:   'cpf',
        number: cpf
      }
    },
    items: [{
      title:     'Pagamento via Telegram',
      unitPrice: amountCents,
      quantity:  1,
      tangible:  false
    }]
  };

  console.log(`📤 [PodPay] Criando PIX R$ ${amountReais.toFixed(2)} | chatId: ${chatId}`);

  const response = await axios.post(`${BASE_URL}/v1/transactions`, payload, {
    headers: {
      'x-api-key':      process.env.PODPAY_API_KEY,
      'Content-Type':   'application/json'
    },
    timeout: 15000
  });

  const trx = response.data.data;
  // orderId = podpay_<txId> — usado como chave no store e no webhook lookup
  const orderId = `podpay_${trx.id}`;

  console.log(`✅ [PodPay] PIX gerado | txId: ${trx.id} | orderId: ${orderId}`);

  return {
    orderId,
    txId:      trx.id,
    qrCode:    trx.pixQrCode,
    expiresIn: '60 minutos'
  };
}

module.exports = { createPix };
