# 🚀 Deploy Alpha Bank Pay no Render

## ✅ Código Atualizado no GitHub
✨ **Repositório**: https://github.com/miguelfilhoaz00-ui/Alpha-Bank-Pay  
✨ **Commit**: `3034944` - Alpha Bank Pay v2.0 Sistema Completo

## 🎯 Deploy no Render (5 Minutos)

### 1. Acessar Render
- Vá para: https://render.com
- Faça login na sua conta

### 2. Criar Novo Web Service
```
🔗 Connect Repository: https://github.com/miguelfilhoaz00-ui/Alpha-Bank-Pay
📂 Root Directory: (deixe vazio)
🏗️ Build Command: npm install
▶️ Start Command: npm start
```

### 3. Configurações do Serviço
```
Name: alpha-bank-pay
Region: Oregon (US West)
Instance Type: Starter (gratuito)
Auto-Deploy: Yes (deploy automático a cada push)
```

### 4. Variáveis de Ambiente Obrigatórias

⚠️ **CRITICAL**: Configure TODAS essas variáveis antes de fazer deploy!

```env
# ── TELEGRAM BOTS ── 
CLIENT_BOT_TOKEN=SEU_TOKEN_BOT_CLIENTE
ADMIN_BOT_TOKEN=SEU_TOKEN_BOT_ADMIN  
ADMIN_CHAT_ID=SEU_CHAT_ID

# ── XPAYTECH (Principal) ──
XPAYTECH_USERNAME=seu_usuario_xpay
XPAYTECH_PASSWORD=sua_senha_xpay
XPAYTECH_WEBHOOK_URL=https://alpha-bank-pay.onrender.com/webhook/xpaytech

# ── CONFIGURAÇÕES ──
APP_URL=https://alpha-bank-pay.onrender.com
PANEL_PASSWORD=SuaSenhaSuperSegura123!
PORT=3000
NODE_ENV=production

# ── OUTROS GATEWAYS (Opcionais) ──
PODPAY_API_KEY=token_podpay
PODPAY_POSTBACK_URL=https://alpha-bank-pay.onrender.com/webhook/podpay
```

### 5. Deploy!
- Clique em **"Create Web Service"**
- ⏳ Aguarde 2-3 minutos para build
- ✅ Deploy concluído!

## 🎉 Acesso ao Sistema

### URLs do Seu Sistema:
- **🤖 Bot Telegram**: @seubotusername
- **🎛️ Painel Admin**: https://alpha-bank-pay.onrender.com/painel
- **📊 Health Check**: https://alpha-bank-pay.onrender.com/ping

### Credenciais de Acesso:
- **Painel Admin**: Sua `PANEL_PASSWORD`
- **Bot Admin**: Token configurado em `ADMIN_BOT_TOKEN`

## 🧪 Teste Completo

### 1. Verificar Sistema
```bash
# Health Check
curl https://alpha-bank-pay.onrender.com/ping

# Resposta esperada:
{"status":"OK","timestamp":"2026-04-22T..."}
```

### 2. Testar Bot Cliente
```
1. Abrir @seubotusername no Telegram
2. Enviar /start
3. Verificar cadastro automático
4. Testar /saldo
```

### 3. Testar Painel Admin
```
1. Abrir https://alpha-bank-pay.onrender.com/painel
2. Inserir senha configurada
3. Verificar dashboard
4. Teste broadcast
```

### 4. Testar Saque Melhorado
```
1. Bot: /sacar 50
2. Escolher: [📄 CPF]
3. Digite: 60369486382
4. Verificar validação ✅
5. Confirmar saque
```

## 🚨 Resolução de Problemas

### Build Falha
```bash
# Verifique package.json existe
# Verifique NODE_ENV=production
# Logs: Render Dashboard > Logs
```

### Bot Não Responde
```bash
# Verificar CLIENT_BOT_TOKEN
# Verificar webhook URL no BotFather
# Logs do bot no Render
```

### Painel Não Abre
```bash
# Verificar PANEL_PASSWORD configurada
# Verificar APP_URL correto
# Teste: curl https://seuapp.com/painel
```

## 📊 Monitoramento

### Health Check Automático
O sistema já inclui:
- ✅ Endpoint `/ping` para monitoring
- ✅ Auto-restart em caso de falha  
- ✅ Logs estruturados
- ✅ Notificações de erro via Telegram

### Logs Importantes
```bash
# Bot iniciado
🤖 [Bot] Username: @seubot

# Servidor rodando  
🏦 Alpha Bank Pay — Iniciado! 🚀
🌐 Porta: 3000
🔗 APP_URL: https://seuapp.com

# Database OK
🗄️ [DB] Banco de dados inicializado

# Webhooks OK
📥 [Webhook] /webhook/xpaytech configurado
```

## 🎯 Próximos Passos

### 1. Configurar Webhooks dos Gateways
- **XPayTech**: Configurar URL no painel XPay
- **PodPay**: Adicionar webhook no dashboard PodPay

### 2. Personalizar Sistema
- **Logo**: Substitua emoji 🏦 no código
- **Nome**: Altere "Alpha Bank Pay" para sua marca
- **Templates**: Customize templates de broadcast

### 3. Segurança Adicional
- **2FA**: Habilite autenticação de 2 fatores
- **Backup**: Configure backup automático
- **SSL**: Certificado já incluído no Render

## ⚡ Sistema 100% Operacional!

### ✅ **Funcionalidades Ativas:**
- ✅ Bot Telegram com interface melhorada
- ✅ Validação robusta de chaves PIX
- ✅ Sistema de aprovação manual/automática  
- ✅ Bloqueio cautelar para análise
- ✅ Painel administrativo completo
- ✅ Broadcast com templates profissionais
- ✅ Auditoria e logs completos
- ✅ Dashboard em tempo real
- ✅ Múltiplos gateways PIX
- ✅ Sistema de afiliados
- ✅ Segurança empresarial

### 🎖️ **Pronto Para Escala Empresarial!**

O Alpha Bank Pay agora é um sistema de **nível empresarial** com:
- 🛡️ **Segurança bancária**
- 📊 **Controles avançados**  
- 🎛️ **Interface profissional**
- ⚡ **Performance otimizada**
- 📈 **Analytics completos**

**🚀 Seu sistema PIX está PRONTO para processar milhares de transações!**