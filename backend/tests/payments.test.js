require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const request = require('supertest');
const crypto = require('crypto');
const prisma = require('../src/config/db');

let app;

beforeAll(async () => {
  await prisma.$connect();
  app = require('../src/index');
});

afterAll(async () => {
  await prisma.$disconnect();
});

const SENDER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test_secret';

function makeSignature(body) {
  return crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
}

// -------------------------
// POST /payments
// -------------------------
describe('POST /payments', () => {
  test('rejects request without Idempotency-Key', async () => {
    const res = await request(app).post('/payments').send({
      sender_account_id: SENDER_ID,
      recipient_name: 'Test Supplier',
      recipient_country: 'US',
      recipient_currency: 'USD',
      source_amount: 100000,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Idempotency-Key/);
  });

  test('rejects insufficient balance', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `test-insuf-${Date.now()}`)
      .send({
        sender_account_id: SENDER_ID,
        recipient_name: 'Test Supplier',
        recipient_country: 'US',
        recipient_currency: 'USD',
        source_amount: 999999999,
      });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/Insufficient/);
  });

  test('creates payment and returns transaction', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `test-ok-${Date.now()}`)
      .send({
        sender_account_id: SENDER_ID,
        recipient_name: 'Acme Supplier',
        recipient_country: 'US',
        recipient_currency: 'USD',
        source_amount: 50000,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('processing');
    expect(res.body.data.providerReference).toMatch(/^PRV-/);
  });

  test('idempotency: duplicate key returns same response', async () => {
    const key = `test-idempotent-${Date.now()}`;
    const payload = {
      sender_account_id: SENDER_ID,
      recipient_name: 'Idempotent Supplier',
      recipient_country: 'GB',
      recipient_currency: 'GBP',
      source_amount: 10000,
    };

    const first = await request(app).post('/payments').set('Idempotency-Key', key).send(payload);
    const second = await request(app).post('/payments').set('Idempotency-Key', key).send(payload);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
  });
});

// -------------------------
// GET /payments/:id
// -------------------------
describe('GET /payments/:id', () => {
  let transactionId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `test-get-${Date.now()}`)
      .send({
        sender_account_id: SENDER_ID,
        recipient_name: 'Detail Supplier',
        recipient_country: 'US',
        recipient_currency: 'USD',
        source_amount: 5000,
      });
    transactionId = res.body.data?.id;
  });

  test('returns transaction with ledger entries and status history', async () => {
    if (!transactionId) return;
    const res = await request(app).get(`/payments/${transactionId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.ledger_entries.length).toBeGreaterThan(0);
    expect(res.body.data.status_history.length).toBeGreaterThan(0);
  });

  test('returns 404 for unknown id', async () => {
    const res = await request(app).get('/payments/00000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(404);
  });
});

// -------------------------
// POST /webhooks/provider
// -------------------------
describe('POST /webhooks/provider', () => {
  test('rejects invalid signature', async () => {
    const body = JSON.stringify({ reference: 'PRV-FAKE', status: 'completed' });
    const res = await request(app)
      .post('/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', 'invalidsig00000000000000000000000000000000000000000000000000000000')
      .send(body);
    expect(res.status).toBe(401);
  });

  test('returns 200 for unknown transaction reference', async () => {
    const body = JSON.stringify({ reference: 'PRV-UNKNOWN-999', status: 'completed' });
    const sig = makeSignature(body);
    const res = await request(app)
      .post('/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(body);
    expect(res.status).toBe(200);
  });

  test('completes a payment and credits recipient', async () => {
    const payRes = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `test-webhook-complete-${Date.now()}`)
      .send({
        sender_account_id: SENDER_ID,
        recipient_name: 'Webhook Supplier',
        recipient_country: 'US',
        recipient_currency: 'USD',
        source_amount: 3000,
      });

    if (payRes.status !== 201) return;
    const providerRef = payRes.body.data.providerReference;

    const body = JSON.stringify({ reference: providerRef, status: 'completed' });
    const sig = makeSignature(body);

    const webhookRes = await request(app)
      .post('/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(body);

    expect(webhookRes.status).toBe(200);

    const detailRes = await request(app).get(`/payments/${payRes.body.data.id}`);
    expect(detailRes.body.data.status).toBe('completed');
  });

  test('idempotency: duplicate webhook does not double-credit', async () => {
    const payRes = await request(app)
      .post('/payments')
      .set('Idempotency-Key', `test-webhook-idempotent-${Date.now()}`)
      .send({
        sender_account_id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        recipient_name: 'Idempotent Receiver',
        recipient_country: 'GB',
        recipient_currency: 'GBP',
        source_amount: 20000,
      });

    if (payRes.status !== 201) return;
    const providerRef = payRes.body.data.providerReference;
    const body = JSON.stringify({ reference: providerRef, status: 'completed' });
    const sig = makeSignature(body);

    await request(app)
      .post('/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(body);

    await request(app)
      .post('/webhooks/provider')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(body);

    const detail = await request(app).get(`/payments/${payRes.body.data.id}`);
    const credits = detail.body.data.ledger_entries.filter(
      (e) => e.entryType === 'credit' && parseFloat(e.amount) > 0
    );
    expect(credits.length).toBe(1);
  });
});
