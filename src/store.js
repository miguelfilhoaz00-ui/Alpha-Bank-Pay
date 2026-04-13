/**
 * Store em memória: orderId → { chatId, amountReais, provider }
 * Usado para saber quem notificar quando o webhook de pagamento chegar.
 */
const orders = new Map();

function saveOrder(orderId, chatId, amountReais, provider) {
  orders.set(orderId, { chatId, amountReais, provider, createdAt: new Date() });
  console.log(`💾 [Store] Salvo | orderId: ${orderId} | chatId: ${chatId} | R$ ${amountReais.toFixed(2)}`);
}

function getOrder(orderId) {
  return orders.get(orderId) || null;
}

function deleteOrder(orderId) {
  orders.delete(orderId);
  console.log(`🗑️  [Store] Removido | orderId: ${orderId}`);
}

module.exports = { saveOrder, getOrder, deleteOrder };
