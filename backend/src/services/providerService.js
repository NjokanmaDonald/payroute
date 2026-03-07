const { v4: uuidv4 } = require('uuid');

/**
 * Simulated downstream payment provider.
 * In production this would be an HTTP call to a real provider API.
 *
 * Returns immediately with a provider_reference (ACK).
 * The final outcome arrives later via webhook (POST /webhooks/provider).
 */
async function submitPayment(transaction) {
  // Simulate a network call delay
  await new Promise((resolve) => setTimeout(resolve, 100));

  const providerReference = `PRV-${uuidv4().slice(0, 12).toUpperCase()}`;

  return {
    provider_reference: providerReference,
    status: 'accepted',
    submitted_at: new Date().toISOString(),
  };
}

module.exports = { submitPayment };
