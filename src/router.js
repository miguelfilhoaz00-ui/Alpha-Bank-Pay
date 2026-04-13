const { getAll } = require('./config');

// Mapa de módulos de providers disponíveis
const MODULES = {
  pagnet:       require('./providers/pagnet'),
  fluxopay:     require('./providers/fluxopay'),
  podpay:       require('./providers/podpay'),
  sharkbanking: require('./providers/sharkbanking'),
  xpaytech:     require('./providers/xpaytech')
};

/**
 * Retorna o primeiro provider ATIVO que cobre a faixa do valor.
 * A ordem no DEFAULT_CONFIG define a prioridade quando dois providers
 * cobrem a mesma faixa e ambos estão ativos.
 *
 * @param {number} amountReais — valor em reais (ex: 500)
 * @returns {{ id, label, module } | null}
 */
function getRoute(amountReais) {
  const config = getAll();

  for (const [id, p] of Object.entries(config)) {
    if (p.enabled && amountReais >= p.min && amountReais <= p.max) {
      return { id, label: p.label, module: MODULES[id] };
    }
  }

  return null;
}

module.exports = { getRoute };
