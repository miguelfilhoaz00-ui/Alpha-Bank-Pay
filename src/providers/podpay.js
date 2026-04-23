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

// ==========================
// SAQUES PIX — PODPAY
// ==========================
const API_KEY = process.env.PODPAY_API_KEY;
const WEBHOOK_URL = process.env.PODPAY_WEBHOOK_URL || `${process.env.APP_URL}/webhook/podpay`;

/**
 * Criar saque PIX na PodPay
 */
async function createWithdrawal(pixKey, amount, pixKeyType = 'evp', orderId, description = 'Saque PIX') {
  try {
    console.log('🏦 [PodPay] Criando saque:', {
      pixKey: pixKey.replace(/(\d{3})\d{6}(\d{2})/, '$1***$2'), // Mascarar CPF
      amount,
      orderId,
      pixKeyType
    });

    if (!API_KEY) {
      throw new Error('PODPAY_API_KEY não configurada');
    }

    if (!pixKey || !amount || amount < 1) {
      throw new Error('Parâmetros inválidos: pixKey e amount são obrigatórios');
    }

    // Converter valor para centavos (PodPay usa centavos)
    const amountInCents = Math.round(amount * 100);

    // Detectar tipo de chave PIX automaticamente se não fornecido
    const detectedPixKeyType = pixKeyType || detectPixKeyType(pixKey);

    // Payload da requisição
    const payload = {
      method: 'fiat',                    // Saque PIX
      amount: amountInCents,             // Valor em centavos
      pixKey: pixKey.trim(),             // Chave PIX
      pixKeyType: detectedPixKeyType,    // Tipo da chave
      netPayout: false                   // Taxa incluída no valor
    };

    console.log('📡 [PodPay] Payload saque:', { ...payload, pixKey: '***' });

    // Fazer requisição para PodPay
    const response = await axios.post(`${BASE_URL}/v1/withdrawals`, payload, {
      headers: {
        'x-api-key': API_KEY,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': orderId // Usar orderId como chave de idempotência
      },
      timeout: 30000
    });

    console.log('✅ [PodPay] Resposta saque:', response.data);

    // Processar resposta
    if (response.data.success && response.data.data) {
      const withdrawal = response.data.data;

      return {
        success: true,
        data: {
          id: withdrawal.id,
          status: mapStatus(withdrawal.status),
          amount: withdrawal.amount / 100, // Converter de volta para reais
          fee: withdrawal.fee ? withdrawal.fee / 100 : 0,
          netAmount: withdrawal.netAmount ? withdrawal.netAmount / 100 : (withdrawal.amount / 100),
          pixKey,
          pixKeyType: detectedPixKeyType,
          orderId,
          provider: 'podpay',
          createdAt: withdrawal.createdAt || new Date().toISOString(),
          externalId: withdrawal.id,
          webhookUrl: WEBHOOK_URL
        }
      };
    } else {
      throw new Error(response.data.error?.message || 'Resposta inválida da PodPay');
    }

  } catch (error) {
    console.error('❌ [PodPay] Erro ao criar saque:', error.message);

    let errorMessage = 'Erro interno da PodPay';

    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;

      console.error('❌ [PodPay] Erro HTTP:', status, data);

      if (status === 401) {
        errorMessage = 'Erro de autenticação PodPay - verifique API_KEY';
      } else if (status === 400) {
        errorMessage = data?.error?.message || 'Dados inválidos para saque';
      } else if (status === 429) {
        errorMessage = 'Rate limit excedido - tente novamente em alguns segundos';
      } else if (status >= 500) {
        errorMessage = 'Erro temporário da PodPay - tente novamente';
      } else {
        errorMessage = data?.error?.message || `Erro PodPay (${status})`;
      }
    } else if (error.code === 'TIMEOUT' || error.code === 'ECONNABORTED') {
      errorMessage = 'Timeout na comunicação com PodPay';
    } else if (error.code === 'ECONNREFUSED') {
      errorMessage = 'PodPay indisponível - tente novamente';
    }

    return {
      success: false,
      error: errorMessage,
      details: error.response?.data || error.message
    };
  }
}

/**
 * Detectar automaticamente o tipo de chave PIX
 */
function detectPixKeyType(pixKey) {
  if (!pixKey) return 'evp';

  const key = pixKey.trim();

  // CPF: 11 dígitos numéricos
  if (/^\d{11}$/.test(key)) return 'cpf';

  // CNPJ: 14 dígitos numéricos
  if (/^\d{14}$/.test(key)) return 'cnpj';

  // Telefone: +55 + DDD + número
  if (/^(\+55)?[1-9]{2}9?\d{8}$/.test(key.replace(/\D/g, ''))) return 'phone';

  // Email: contém @ e domínio
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) return 'email';

  // Chave aleatória: UUID ou string específica
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
    return 'evp';
  }

  // Copy-paste: muito longo (QR Code)
  if (key.length > 50) return 'copypaste';

  // Default: chave aleatória
  return 'evp';
}

/**
 * Mapear status da PodPay para nosso sistema
 */
function mapStatus(podpayStatus) {
  const statusMap = {
    'pending': 'pending',
    'pending_approval': 'pending',
    'processing': 'pending',
    'completed': 'completed',
    'paid': 'completed',
    'failed': 'failed',
    'cancelled': 'failed',
    'canceled': 'failed'
  };

  return statusMap[podpayStatus] || 'pending';
}

module.exports = {
  createPix,           // Função para depósitos
  createWithdrawal,    // Função para saques
  detectPixKeyType     // Detectar tipo automaticamente
};