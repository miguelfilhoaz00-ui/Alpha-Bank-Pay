const axios = require('axios');

const BASE_URL = 'https://api.fluxopay.com.br/api';

// ==========================
// DADOS ALEATÓRIOS
// ==========================
const nomes = [
  'João Silva', 'Maria Oliveira', 'Pedro Santos', 'Ana Costa',
  'Lucas Mendes', 'Fernanda Lima', 'Rafael Souza', 'Camila Rocha',
  'Gabriel Ferreira', 'Beatriz Alves'
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

// ==========================
// CRIAR PIX — FLUXOPAY
// ==========================
async function createPix(chatId, amountReais) {
  const amountCents = Math.round(amountReais * 100);
  const orderId     = `fluxo_${chatId}_${Date.now()}`;
  const nome        = nomes[Math.floor(Math.random() * nomes.length)];
  const cpf         = gerarCPFValido();

  const payload = {
    amount:        amountCents,
    partyName:     nome,
    partyDocument: cpf,
    partyEmail:    `${nome.toLowerCase().replace(/\s+/g, '')}${Math.floor(Math.random() * 900) + 100}@exemplo.com`,
    description:   'Pagamento via Telegram',
    orderId,
    expiresIn:     3600
  };

  console.log(`📤 [FluxoPay] Criando PIX R$ ${amountReais.toFixed(2)} | chatId: ${chatId}`);

  const response = await axios.post(`${BASE_URL}/pix/in`, payload, {
    headers: {
      'x-api-key':    process.env.FLUXOPAY_API_KEY,
      'x-api-secret': process.env.FLUXOPAY_API_SECRET,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  const pix = response.data.data || response.data;
  console.log(`✅ [FluxoPay] PIX gerado | orderId: ${orderId}`);

  return {
    orderId,
    qrCode:    pix.qrCode,
    expiresIn: '60 minutos'
  };
}

module.exports = { createPix };
