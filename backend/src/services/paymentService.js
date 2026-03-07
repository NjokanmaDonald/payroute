const prisma = require("../config/db");
const { getQuote } = require("./fxService");
const { submitPayment } = require("./providerService");

const SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

function generateReference() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `PAY-${ts}-${rand}`;
}

function toNum(decimal) {
  return parseFloat(decimal.toString());
}

/**
 * Initiate a payment inside a single DB transaction:
 *   1. FOR UPDATE lock on sender balance row → prevents concurrent overdraft
 *   2. Obtain FX quote
 *   3. Deduct from available balance, add to locked_balance
 *   4. Create transaction record + ledger entries (double-entry)
 *   5. Submit to downstream provider (simulated)
 *   6. Update status to 'processing'
 */
async function initiatePayment({
  senderAccountId,
  recipientName,
  recipientCountry,
  recipientCurrency,
  sourceAmount,
  idempotencyKey,
}) {
  return prisma.$transaction(async (tx) => {
    // 1. Lock the balance row — blocks any concurrent payment for same account
    const [senderBalance] = await tx.$queryRaw`
      SELECT ab.*, a.business_name
      FROM account_balances ab
      JOIN accounts a ON a.id = ab.account_id
      WHERE ab.account_id = ${senderAccountId}::uuid AND ab.currency = 'NGN'
      FOR UPDATE
    `;

    if (!senderBalance) {
      throw new Error("Sender account not found or has no NGN balance");
    }

    const available = parseFloat(senderBalance.balance.toString());
    const amount = parseFloat(sourceAmount);

    if (available < amount) {
      throw new Error(
        `Insufficient balance. Available: ${available} NGN, Required: ${amount} NGN`,
      );
    }

    // 2. Get FX quote
    const quote = await getQuote("NGN", recipientCurrency);
    const destinationAmount = parseFloat(
      (amount * toNum(quote.rate)).toFixed(6),
    );

    // 3. Move funds: deduct from balance, add to locked_balance
    await tx.$executeRaw`
      UPDATE account_balances
      SET balance        = balance - ${amount},
          locked_balance = locked_balance + ${amount},
          updated_at     = NOW()
      WHERE account_id = ${senderAccountId}::uuid AND currency = 'NGN'
    `;

    // 4. Create transaction record
    const reference = generateReference();
    const transaction = await tx.transaction.create({
      data: {
        reference,
        senderAccountId,
        recipientName,
        recipientCountry,
        recipientCurrency: recipientCurrency.toUpperCase(),
        sourceCurrency: "NGN",
        sourceAmount: amount,
        destinationAmount,
        fxRate: toNum(quote.rate),
        fxQuoteId: quote.id,
        idempotencyKey,
        status: "initiated",
      },
    });

    // 5. Status history
    await tx.transactionStatusHistory.create({
      data: {
        transactionId: transaction.id,
        fromStatus: null,
        toStatus: "initiated",
        reason: "Payment initiated by client",
      },
    });

    // 6. Ledger entries — double-entry (net = zero)
    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: transaction.id,
          accountId: senderAccountId,
          currency: "NGN",
          amount: -amount,
          entryType: "debit",
          description: "Payment initiation — debit sender",
        },
        {
          transactionId: transaction.id,
          accountId: SYSTEM_ACCOUNT_ID,
          currency: "NGN",
          amount: amount,
          entryType: "credit",
          description: "Payment initiation — credit system float",
        },
      ],
    });

    // 7. Submit to provider (simulated)
    const providerResult = await submitPayment(transaction);

    // 8. Update to processing
    const updated = await tx.transaction.update({
      where: { id: transaction.id },
      data: {
        status: "processing",
        providerReference: providerResult.provider_reference,
        processingAt: new Date(),
      },
    });

    await tx.transactionStatusHistory.create({
      data: {
        transactionId: transaction.id,
        fromStatus: "initiated",
        toStatus: "processing",
        reason: "Submitted to provider",
      },
    });

    return updated;
  });
}

/**
 * Settle a completed payment.
 * Called inside an existing Prisma transaction (tx).
 */
async function settlePayment(tx, transaction) {
  // Ensure recipient has a balance row for destination currency
  await tx.$executeRaw`
    INSERT INTO account_balances (account_id, currency, balance)
    VALUES (${transaction.senderAccountId}::uuid, ${transaction.recipientCurrency}, 0)
    ON CONFLICT (account_id, currency) DO NOTHING
  `;

  const sourceAmount = toNum(transaction.sourceAmount);
  const destinationAmount = toNum(transaction.destinationAmount);

  // Release locked balance
  await tx.$executeRaw`
    UPDATE account_balances
    SET locked_balance = locked_balance - ${sourceAmount},
        updated_at     = NOW()
    WHERE account_id = ${transaction.senderAccountId}::uuid AND currency = 'NGN'
  `;

  // Credit destination currency to sender (represents recipient receipt)
  await tx.$executeRaw`
    UPDATE account_balances
    SET balance    = balance + ${destinationAmount},
        updated_at = NOW()
    WHERE account_id = ${transaction.senderAccountId}::uuid
      AND currency   = ${transaction.recipientCurrency}
  `;

  // Ledger: debit system float NGN, credit recipient destination currency
  await tx.ledgerEntry.createMany({
    data: [
      {
        transactionId: transaction.id,
        accountId: SYSTEM_ACCOUNT_ID,
        currency: "NGN",
        amount: -sourceAmount,
        entryType: "debit",
        description: "Settlement — release system float NGN",
      },
      {
        transactionId: transaction.id,
        accountId: transaction.senderAccountId,
        currency: transaction.recipientCurrency,
        amount: destinationAmount,
        entryType: "credit",
        description: "Settlement — credit recipient destination currency",
      },
    ],
  });

  await tx.transaction.update({
    where: { id: transaction.id },
    data: { status: "completed", completedAt: new Date() },
  });

  await tx.transactionStatusHistory.create({
    data: {
      transactionId: transaction.id,
      fromStatus: "processing",
      toStatus: "completed",
      reason: "Webhook: provider confirmed completion",
    },
  });
}

/**
 * Reverse a failed payment (compensating entries).
 * Called inside an existing Prisma transaction (tx).
 */
async function reversePayment(tx, transaction, failureReason) {
  const sourceAmount = toNum(transaction.sourceAmount);

  // Return locked funds to available balance
  await tx.$executeRaw`
    UPDATE account_balances
    SET balance        = balance + ${sourceAmount},
        locked_balance = locked_balance - ${sourceAmount},
        updated_at     = NOW()
    WHERE account_id = ${transaction.senderAccountId}::uuid AND currency = 'NGN'
  `;

  // Compensating ledger entries
  await tx.ledgerEntry.createMany({
    data: [
      {
        transactionId: transaction.id,
        accountId: transaction.senderAccountId,
        currency: "NGN",
        amount: sourceAmount,
        entryType: "reversal_credit",
        description: "Reversal — credit sender NGN back",
      },
      {
        transactionId: transaction.id,
        accountId: SYSTEM_ACCOUNT_ID,
        currency: "NGN",
        amount: -sourceAmount,
        entryType: "debit",
        description: "Reversal — debit system float NGN",
      },
    ],
  });

  await tx.transaction.update({
    where: { id: transaction.id },
    data: {
      status: "failed",
      failedAt: new Date(),
      failureReason: failureReason || "Provider reported failure",
    },
  });

  await tx.transactionStatusHistory.create({
    data: {
      transactionId: transaction.id,
      fromStatus: "processing",
      toStatus: "failed",
      reason: failureReason || "Webhook: provider reported failure",
    },
  });
}

async function getTransactionById(id) {
  const transaction = await prisma.transaction.findUnique({
    where: { id },
    include: {
      senderAccount: { select: { businessName: true } },
      ledgerEntries: {
        include: { account: { select: { businessName: true } } },
        orderBy: { createdAt: "asc" },
      },
      statusHistory: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!transaction) return null;

  return {
    ...transaction,
    sender_name: transaction.senderAccount.businessName,
    // ledger_entries: transaction.ledgerEntries.map((e) => ({
    //   ...e,
    //   account_name: e.account.businessName,
    // })),
    // status_history: transaction.statusHistory,
  };
}

async function listTransactions({
  status,
  dateFrom,
  dateTo,
  page = 1,
  limit = 20,
}) {
  const where = {};
  if (status && status !== "all") where.status = status;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }

  const offset = (page - 1) * limit;

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { senderAccount: { select: { businessName: true } } },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    }),
    prisma.transaction.count({ where }),
  ]);

  return {
    data: data.map((t) => ({
      ...t,
      sender_name: t.senderAccount.businessName,
    })),
    total,
    page: parseInt(page, 10),
    limit: parseInt(limit, 10),
  };
}

module.exports = {
  initiatePayment,
  settlePayment,
  reversePayment,
  getTransactionById,
  listTransactions,
};
