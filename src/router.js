const { getAll }  = require('./config');
const { getUser } = require('./users');

// Mapa de módulos disponíveis
const MODULES = {
  pagnet:       require('./providers/pagnet'),
  fluxopay:     require('./providers/fluxopay'),
  podpay:       require('./providers/podpay'),
  sharkbanking: require('./providers/sharkbanking'),
  xpaytech:     require('./providers/xpaytech')
};

/**
 * Retorna o gateway correto para o usuário e valor.
 *
 * Prioridade:
 * 1. Se o usuário tem gatewayOverride definido e esse gateway está ATIVO → usa ele
 * 2. Caso contrário → roteia pelo valor (comportamento padrão)
 *
 * @param {number} amountReais — valor em reais
 * @param {string|number|null} chatId — ID do usuário (opcional)
 * @returns {{ id, label, module } | null}
 */
function getRoute(amountReais, chatId = null) {
  const config = getAll();

  // 1. Gateway preferencial do usuário
  if (chatId) {
    const user = getUser(chatId);
    if (user?.gatewayOverride) {
      const p = config[user.gatewayOverride];
      if (p?.enabled) {
        console.log(`🔀 [Router] chatId ${chatId} → gateway fixo: ${user.gatewayOverride}`);
        return { id: user.gatewayOverride, label: p.label, module: MODULES[user.gatewayOverride] };
      }
    }
  }

  // 2. Roteamento padrão por faixa de valor
  for (const [id, p] of Object.entries(config)) {
    if (p.enabled && amountReais >= p.min && amountReais <= p.max) {
      return { id, label: p.label, module: MODULES[id] };
    }
  }

  return null;
}

module.exports = { getRoute };
