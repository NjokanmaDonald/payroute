const crypto = require("crypto");
const prisma = require("../config/db");
const { settlePayment, reversePayment } = require("../services/paymentService");

const VALID_TRANSITIONS = { processing: ["completed", "failed"] };

async function handleProviderWebhook(req, res) {
  const rawBody =
    req.body instanceof Buffer ? req.body.toString("utf8") : JSON.stringify(req.body);
  const signature = req.headers["x-webhook-signature"];

  const webhookSecret = process.env.WEBHOOK_SECRET;
  if (!webhookSecret) return res.status(500).send("Server configuration error");

  const expected = crypto
    .createHmac("sha256", webhookSecret)
    .update(rawBody)
    .digest("hex");

  if (
    !signature ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  ) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  // Log raw event BEFORE any processing — always, regardless of what follows
  let webhookEventId;
  try {
    const event = await prisma.webhookEvent.create({
      data: {
        providerReference: payload.reference || null,
        rawHeaders: req.headers,
        rawBody,
        signature,
        processingStatus: "received",
      },
    });
    webhookEventId = event.id;
  } catch (logErr) {
    console.error("[Webhook] Failed to log raw event:", logErr);
  }

  // Return 200 for unknown references — see ANALYSIS.md for reasoning
  const transaction = await prisma.transaction.findFirst({
    where: { providerReference: payload.reference },
  });

  if (!transaction) {
    await markWebhook(webhookEventId, "ignored", "Unknown provider_reference");
    return res.status(200).json({ message: "Acknowledged" });
  }

  const allowed = VALID_TRANSITIONS[transaction.status] || [];
  if (!allowed.includes(payload.status)) {
    const note = `Invalid transition: ${transaction.status} -> ${payload.status}`;
    await markWebhook(webhookEventId, "ignored", note);
    return res.status(200).json({ message: "Acknowledged", note });
  }

  try {
    await prisma.$transaction(async (tx) => {
      // Re-fetch with FOR UPDATE lock — guards against concurrent webhook delivery
      const [locked] = await tx.$queryRaw`
        SELECT * FROM transactions WHERE id = ${transaction.id}::uuid FOR UPDATE
      `;

      // Idempotency: already in target status means duplicate delivery
      if (locked.status === payload.status) {
        await markWebhook(webhookEventId, "ignored", "Duplicate webhook — already in target status");
        return;
      }

      const txData = {
        id: locked.id,
        senderAccountId: locked.sender_account_id,
        recipientCurrency: locked.recipient_currency,
        sourceAmount: locked.source_amount,
        destinationAmount: locked.destination_amount,
      };

      if (payload.status === "completed") {
        await settlePayment(tx, txData);
      } else {
        await reversePayment(tx, txData, payload.failure_reason);
      }
    });

    await markWebhook(webhookEventId, "processed", null);
    return res.status(200).json({ message: "Processed" });
  } catch (err) {
    console.error("[Webhook] Processing error:", err);
    await markWebhook(webhookEventId, "failed", err.message);
    return res.status(200).json({ message: "Acknowledged (processing error — logged)" });
  }
}

async function simulateWebhook(req, res, next) {
  try {
    const { provider_reference, status, failure_reason } = req.body;

    if (!provider_reference || !["completed", "failed"].includes(status)) {
      return res.status(400).json({
        error: "provider_reference and status (completed|failed) are required",
      });
    }

    const payload = JSON.stringify({
      reference: provider_reference,
      status,
      failure_reason: failure_reason || null,
      simulated: true,
    });

    const signature = crypto
      .createHmac("sha256", process.env.WEBHOOK_SECRET)
      .update(payload)
      .digest("hex");

    const baseUrl = `http://localhost:${process.env.PORT || 3001}/api/v1`;
    const response = await fetch(`${baseUrl}/webhooks/provider`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
      body: payload,
    });

    return res.json({
      message: "Webhook simulated",
      webhook_response: await response.json(),
    });
  } catch (err) {
    next(err);
  }
}

async function markWebhook(id, status, error) {
  if (!id) return;
  await prisma.webhookEvent.update({
    where: { id },
    data: {
      processingStatus: status,
      processingError: error || null,
      processedAt: status === "processed" ? new Date() : null,
    },
  });
}

module.exports = { handleProviderWebhook, simulateWebhook };
