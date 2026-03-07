const prisma = require('../config/db');

const RATES = {
  NGN: { NGN: 1, USD: 0.00065, GBP: 0.00052, EUR: 0.00060 },
  USD: { NGN: 1538.46, USD: 1, GBP: 0.79, EUR: 0.92 },
  GBP: { NGN: 1923.08, USD: 1.27, GBP: 1, EUR: 1.17 },
  EUR: { NGN: 1666.67, USD: 1.09, GBP: 0.86, EUR: 1 },
};

const QUOTE_TTL_SECONDS = 30;

async function getQuote(sourceCurrency, destinationCurrency) {
  const src = sourceCurrency.toUpperCase();
  const dst = destinationCurrency.toUpperCase();

  if (!RATES[src] || RATES[src][dst] === undefined) {
    throw new Error(`Unsupported currency pair: ${src}/${dst}`);
  }

  const rate = RATES[src][dst];
  const expiresAt = new Date(Date.now() + QUOTE_TTL_SECONDS * 1000);

  const quote = await prisma.fxQuote.create({
    data: { sourceCurrency: src, destinationCurrency: dst, rate, expiresAt },
  });

  return quote;
}

async function validateQuote(quoteId) {
  const quote = await prisma.fxQuote.findUnique({ where: { id: quoteId } });
  if (!quote) throw new Error('FX quote not found');
  if (new Date(quote.expiresAt) < new Date()) {
    throw new Error('FX quote has expired. Please request a new quote.');
  }
  return quote;
}

module.exports = { getQuote, validateQuote };
