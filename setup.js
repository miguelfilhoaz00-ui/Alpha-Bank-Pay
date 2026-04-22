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

  console.log('\n🏛️ CONFIGURAÇÃO XPAYTECH (Gateway Principal)\n');

  const xpayUsername = await question('👤 XPayTech Username: ');
  const xpayPassword = await question('🔑 XPayTech Password: ');

  console.log('\n⚙️ CONFIGURAÇÃO GERAL\n');

  const appUrl = await question('🌐 URL do seu app (ex: https://seuapp.onrender.com): ');
  const panelPassword = await question('🔒 Senha do painel administrativo: ');

  console.log('\n💳 GATEWAYS OPCIONAIS (Enter para pular)\n');

  const pagnetKey = await question('🟦 PagNet API Key (opcional): ');
  const fluxopayKey = await question('🟦 FluxoPay API Key (opcional): ');
  const sharkKey = await question('🟦 SharkBanking API Key (opcional): ');

  const envContent = `# ══════════════════════════════════
# ALPHA BANK PAY - AUTO-GENERATED
# ══════════════════════════════════

# ── TELEGRAM BOTS ──
CLIENT_BOT_TOKEN=${clientBotToken}
ADMIN_BOT_TOKEN=${adminBotToken}
ADMIN_CHAT_ID=${adminChatId}

# ── XPAYTECH (Gateway Principal) ──
XPAYTECH_USERNAME=${xpayUsername}
XPAYTECH_PASSWORD=${xpayPassword}
XPAYTECH_WEBHOOK_URL=${appUrl}/webhook/xpaytech

# ── CONFIGURAÇÕES GERAIS ──
APP_URL=${appUrl}
PANEL_PASSWORD=${panelPassword}
PORT=3000
NODE_ENV=production

# ── OUTROS GATEWAYS ──
${pagnetKey ? `PAGNET_PUBLIC_KEY=${pagnetKey}` : '# PAGNET_PUBLIC_KEY='}
${pagnetKey ? `PAGNET_POSTBACK_URL=${appUrl}/webhook/pagnet` : '# PAGNET_POSTBACK_URL='}
${fluxopayKey ? `FLUXOPAY_API_KEY=${fluxopayKey}` : '# FLUXOPAY_API_KEY='}
${sharkKey ? `SHARKBANKING_PUBLIC_KEY=${sharkKey}` : '# SHARKBANKING_PUBLIC_KEY='}
${sharkKey ? `SHARKBANKING_POSTBACK_URL=${appUrl}/webhook/sharkbanking` : '# SHARKBANKING_POSTBACK_URL='}

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