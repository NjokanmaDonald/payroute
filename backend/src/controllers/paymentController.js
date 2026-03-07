const prisma = require("../config/db");
const { getQuote } = require("../services/fxService");
const { initiatePayment, getTransactionById, listTransactions } = require("../services/paymentService");

async function createPayment(req, res, next) {
  try {
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey) {
      return res.status(400).json({ error: "Idempotency-Key header is required" });
    }

    const existing = await prisma.idempotencyKey.findUnique({ where: { idempotencyKey } });
    if (existing) {
      return res.status(existing.responseStatus).json(existing.responseBody);
    }

    const { sender_account_id, recipient_name, recipient_country, recipient_currency, source_amount } = req.body;

    if (!sender_account_id || !recipient_name || !recipient_country || !recipient_currency || !source_amount) {
      return res.status(400).json({
        error: "Missing required fields: sender_account_id, recipient_name, recipient_country, recipient_currency, source_amount",
      });
    }

    if (isNaN(parseFloat(source_amount)) || parseFloat(source_amount) <= 0) {
      return res.status(400).json({ error: "source_amount must be a positive number" });
    }

    const transaction = await initiatePayment({
      senderAccountId: sender_account_id,
      recipientName: recipient_name,
      recipientCountry: recipient_country,
      recipientCurrency: recipient_currency,
      sourceAmount: parseFloat(source_amount),
      idempotencyKey,
    });

    const responseBody = { data: transaction };

    try {
      await prisma.idempotencyKey.create({
        data: { idempotencyKey, responseStatus: 201, responseBody },
      });
    } catch (e) {
      if (e.code !== "P2002") console.error("Idempotency key storage failed:", e.message);
    }

    return res.status(201).json(responseBody);
  } catch (err) {
    if (
      err.message.includes("Insufficient balance") ||
      err.message.includes("not found") ||
      err.message.includes("Unsupported currency") ||
      err.message.includes("expired")
    ) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
}

async function getPaymentQuote(req, res, next) {
  try {
    const { source_currency = "NGN", destination_currency, amount } = req.query;

    if (!destination_currency) {
      return res.status(400).json({ error: "destination_currency is required" });
    }

    const quote = await getQuote(source_currency, destination_currency);
    const convertedAmount = amount ? parseFloat(amount) * parseFloat(quote.rate.toString()) : null;

    return res.json({
      data: {
        ...quote,
        converted_amount: convertedAmount ? convertedAmount.toFixed(6) : null,
      },
    });
  } catch (err) {
    if (err.message.includes("Unsupported")) {
      return res.status(422).json({ error: err.message });
    }
    next(err);
  }
}

async function listPayments(req, res, next) {
  try {
    const { status, date_from, date_to, page = 1, limit = 20 } = req.query;
    const result = await listTransactions({
      status,
      dateFrom: date_from,
      dateTo: date_to,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 100),
    });
    return res.json(result);
  } catch (err) {
    next(err);
  }
}

async function getPayment(req, res, next) {
  try {
    const transaction = await getTransactionById(req.params.id);
    if (!transaction) return res.status(404).json({ error: "Transaction not found" });
    return res.json({ data: transaction });
  } catch (err) {
    next(err);
  }
}

module.exports = { createPayment, getPaymentQuote, listPayments, getPayment };
