#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');

console.log(`
🏦 ═══════════════════════════════════
   ALPHA BANK PAY - SETUP AUTOMÁTICO
═══════════════════════════════════

✨ Configuração interativa do sistema
🚀 Deploy ready em poucos minutos!

`);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function setup() {
  console.log('🔧 CONFIGURAÇÃO DE TOKENS TELEGRAM\n');

  const clientBotToken = await question('📱 Token do Bot Cliente (@BotFather): ');
  const adminBotToken = await question('🛡️ Token do Bot Admin (@BotFather): ');
  const adminChatId = await question('👤 Seu Chat ID (@userinfobot): ');

  console.log('\n⚙️ CONFIGURAÇÃO GERAL\n');

  const appUrl = await question('🌐 URL do seu app (ex: https://seuapp.onrender.com): ');
  const panelPassword = await question('🔒 Senha do painel administrativo: ');

  console.log('\n💳 GATEWAYS DE PAGAMENTO\n');

  const podpayKey         = await question('🟦 PodPay API Key (depósitos): ');
  const veopagClientId    = await question('🟢 VeoPag Client ID (saques): ');
  const veopagClientSecret= await question('🟢 VeoPag Client Secret (saques): ');
  const veopagSignature   = await question('🔏 VeoPag Webhook Signature (opcional): ');

  const envContent = `# ══════════════════════════════════
# ALPHA BANK PAY - AUTO-GENERATED
# ══════════════════════════════════

# ── TELEGRAM BOTS ──
CLIENT_BOT_TOKEN=${clientBotToken}
ADMIN_BOT_TOKEN=${adminBotToken}
ADMIN_CHAT_ID=${adminChatId}

# ── CONFIGURAÇÕES GERAIS ──
APP_URL=${appUrl}
PANEL_PASSWORD=${panelPassword}
PORT=3000
NODE_ENV=production

# ── PODPAY (Depósitos) ──
${podpayKey ? `PODPAY_API_KEY=${podpayKey}` : '# PODPAY_API_KEY='}
${podpayKey ? `PODPAY_POSTBACK_URL=${appUrl}/webhook/podpay` : '# PODPAY_POSTBACK_URL='}

# ── VEOPAG (Saques) ──
${veopagClientId     ? `VEOPAG_CLIENT_ID=${veopagClientId}`         : '# VEOPAG_CLIENT_ID='}
${veopagClientSecret ? `VEOPAG_CLIENT_SECRET=${veopagClientSecret}` : '# VEOPAG_CLIENT_SECRET='}
${veopagClientId     ? `VEOPAG_WEBHOOK_URL=${appUrl}/webhook/veopag`: '# VEOPAG_WEBHOOK_URL='}
${veopagSignature    ? `VEOPAG_WEBHOOK_SIGNATURE=${veopagSignature}`: '# VEOPAG_WEBHOOK_SIGNATURE='}

# ── SEGURANÇA ──
JWT_SECRET=${generateRandomString(32)}
WEBHOOK_SECRET=${generateRandomString(16)}

# ── MONITORAMENTO ──
HEALTH_CHECK_URL=${appUrl}/ping
HEARTBEAT_INTERVAL=600000
`;

  fs.writeFileSync('.env', envContent);

  console.log(`
✅ CONFIGURAÇÃO CONCLUÍDA!

📄 Arquivo .env criado com sucesso
🔐 Credenciais configuradas
🌐 Webhooks mapeados

🚀 PRÓXIMOS PASSOS:

1. 📤 Upload para GitHub:
   git add .
   git commit -m "Configure environment"
   git push origin main

2. 🌐 Deploy no Render:
   - Conecte seu repositório GitHub
   - Configure as variáveis de ambiente do .env
   - Deploy automático!

3. 🧪 Teste seu sistema:
   - Bot: ${clientBotToken ? '@' + clientBotToken.split(':')[0] : 'SEU_BOT'}
   - Painel: ${appUrl}/painel
   - Senha: ${panelPassword}

💡 Dica: Mantenha suas credenciais seguras!

🎉 Alpha Bank Pay pronto para produção!
  `);

  rl.close();
}

function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Executar setup
if (require.main === module) {
  setup().catch(console.error);
}

module.exports = { setup };