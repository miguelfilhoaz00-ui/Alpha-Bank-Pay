# 🏦 Alpha Bank Pay

Sistema completo de pagamentos PIX via Telegram com painel administrativo profissional e controles avançados de segurança empresarial.

## ✨ Funcionalidades Principais

### 🤖 Bot Telegram (@alphaprimepay_bot)
- **💰 Depósitos PIX**: Geração automática de QR codes
- **💸 Saques PIX**: Sistema inteligente com validação robusta de chaves
- **💳 Consulta de Saldo**: Em tempo real
- **📋 Histórico**: Extrato completo de transações
- **🤝 Sistema de Afiliados**: Indicações com comissões automáticas

### 🎛️ Painel Administrativo Avançado
- **📊 Dashboard**: Estatísticas em tempo real
- **⏳ Controle de Transações**: Aprovação/rejeição manual
- **🔒 Bloqueio Cautelar**: Análise temporária de transações suspeitas
- **👤 Gestão de Usuários**: Configurações individuais e limites personalizados
- **📢 Broadcast Profissional**: Templates prontos para comunicação
- **📝 Auditoria Completa**: Logs detalhados de todas as ações

### 🛡️ Segurança Empresarial
- **Validação PIX Robusta**: CPF, CNPJ, Email, Telefone e Chave Aleatória
- **Sistema de Aprovações**: Automático ou manual por valor/perfil
- **Rate Limiting**: Proteção contra spam e ataques
- **Auditoria Total**: Rastreamento completo para compliance
- **Múltiplos Gateways**: XPayTech, PodPay

## 🚀 Deploy Rápido

### Render (Recomendado)

1. **Fork este repositório**
2. **Conecte ao Render**
3. **Configure as variáveis de ambiente**
4. **Deploy automático ativado! 🎉**

### Variáveis de Ambiente Obrigatórias

```env
# Bots Telegram
CLIENT_BOT_TOKEN=seu_token_do_bot_cliente
ADMIN_BOT_TOKEN=seu_token_do_bot_admin
ADMIN_CHAT_ID=seu_chat_id_admin

# XPayTech (Gateway Principal)
XPAYTECH_USERNAME=seu_usuario
XPAYTECH_PASSWORD=sua_senha
XPAYTECH_WEBHOOK_URL=https://seuapp.onrender.com/webhook/xpaytech

# Outros Gateways (Opcionais)
PODPAY_TOKEN=token_podpay

# Configurações
APP_URL=https://seuapp.onrender.com
PANEL_PASSWORD=sua_senha_super_segura
PORT=3000
```

## 📱 Como Usar

### Para Clientes:
1. **Iniciar**: `/start` no @alphaprimepay_bot
2. **Depositar**: `/pix 100` → Pagar QR code → Saldo creditado
3. **Sacar**: `/sacar 50` → Escolher tipo de chave → Confirmar

### Para Administradores:
1. **Acessar**: `https://seuapp.com/painel`
2. **Monitorar**: Dashboard com métricas em tempo real
3. **Controlar**: Aprovar/rejeitar transações pendentes
4. **Configurar**: Definir limites e regras por usuário
5. **Comunicar**: Enviar broadcasts com templates profissionais

## 🎯 Diferenciais Técnicos

### Interface Intuitiva de Saque
```
💸 Saque de R$ 500,00

🔑 Escolha o tipo da sua chave PIX:
[📄 CPF] [🏢 CNPJ] [📧 E-mail] [📱 Telefone] [🔐 Aleatória]
```

### Validação Robusta
- **CPF/CNPJ**: Dígitos verificadores calculados
- **Email**: Regex avançado + limite de caracteres
- **Telefone**: Múltiplos formatos aceitos
- **Chave Aleatória**: Formato UUID validado

### Controle Granular
```javascript
// Configurações por usuário
{
  auto_approve_limit: 1000,     // Aprovação automática até R$ 1.000
  daily_limit: 10000,           // Limite diário R$ 10.000
  alert_high_value: 5000,       // Alertar valores > R$ 5.000
  alert_new_pix_key: true,      // Alertar chaves PIX novas
  alert_night_hours: true       // Alertar saques madrugada
}
```

## 🏗️ Arquitetura

### Backend
- **Node.js + Express**: API REST robusta
- **SQLite**: Banco de dados embarcado (zero config)
- **Telegraf**: Framework Telegram otimizado
- **Axios**: Cliente HTTP com retry automático

### Segurança
- **JWT Authentication**: Tokens seguros para painel
- **Rate Limiting**: Express-rate-limit
- **Input Validation**: Joi schema validation
- **SQL Injection**: Prepared statements
- **CORS Protection**: Configuração restritiva

### Integrações
- **Telegram Bot API**: Webhooks e polling
- **PIX Gateways**: APIs REST padronizadas
- **Render Deploy**: CI/CD automático
- **Uptime Monitoring**: Health checks integrados

## 📊 Métricas e Analytics

### Dashboard em Tempo Real
- 👥 **Usuários Totais**: Crescimento da base
- 💰 **Volume Transacionado**: Receita e volume
- ⏳ **Pendências**: Filas de aprovação
- 🚨 **Alertas**: Transações que requerem atenção

### Relatórios Detalhados
- 📈 **Crescimento Diário**: Novos usuários e transações
- 💸 **Top Usuários**: Maior volume de transações
- 🔍 **Análise de Fraude**: Padrões suspeitos
- 📊 **Performance**: Tempos de resposta e uptime

## 🛠️ Desenvolvimento

### Instalação Local
```bash
git clone https://github.com/seuuser/alpha-bank-pay.git
cd alpha-bank-pay
npm install
cp .env.example .env
# Configure as variáveis de ambiente
npm start
```

### Estrutura do Projeto
```
📁 alpha-bank-pay/
├── 📄 server.js              # Servidor principal
├── 📁 src/
│   ├── 📄 database.js        # Configuração SQLite
│   ├── 📄 users.js           # Gestão de usuários
│   ├── 📄 wallet.js          # Lógica de transações
│   └── 📁 providers/         # Integrações PIX
├── 📁 panel/
│   └── 📄 index.html         # Interface administrativa
└── 📁 data/                  # Banco de dados (auto-criado)
```

### Scripts Disponíveis
- `npm start`: Inicia o servidor
- `npm run dev`: Modo desenvolvimento (nodemon)
- `npm test`: Executa testes unitários
- `npm run lint`: Verifica qualidade do código

## 🔒 Segurança e Compliance

### Proteções Implementadas
- ✅ **Validação de Entrada**: Todos os inputs sanitizados
- ✅ **Rate Limiting**: Proteção contra spam/ataques
- ✅ **Auditoria Completa**: Logs imutáveis de ações
- ✅ **Criptografia**: Dados sensíveis protegidos
- ✅ **Backup Automático**: Sincronização de dados

### Compliance
- 📋 **LGPD**: Proteção de dados pessoais
- 🏛️ **BACEN**: Regulamentações PIX
- 📊 **SOX**: Controles financeiros (auditoria)
- 🔍 **AML**: Anti-lavagem de dinheiro

## 🎮 Casos de Uso

### E-commerce
- Gateway de pagamento PIX
- Checkout simplificado
- Conciliação automática

### Fintechs
- Carteira digital completa
- Sistema de afiliados
- Gestão de liquidez

### Marketplaces
- Split de pagamentos
- Comissões automáticas
- Relatórios financeiros

## 📞 Suporte

- 📧 **Email**: suporte@alphabankpay.com
- 💬 **Telegram**: @alphabankpay_suporte
- 📚 **Docs**: https://docs.alphabankpay.com
- 🐛 **Issues**: GitHub Issues

## 📄 Licença

MIT License - Veja [LICENSE](LICENSE) para detalhes.

## 🌟 Contribuições

Contribuições são bem-vindas! Veja nosso [CONTRIBUTING.md](CONTRIBUTING.md) para guidelines.

---

**🚀 Pronto para revolucionar pagamentos PIX? Deploy em 5 minutos!**