# PayRoute — Cross-Border Payment Processing

A simplified cross-border payment processing service for Nigerian businesses sending payments to overseas suppliers.

## Stack

| Layer | Technology |
|---|---|
| Backend | Node.js 20, Express, JavaScript |
| Frontend | React 18, Vite |
| Database | PostgreSQL 16 |
| Containerization | Docker + docker-compose |

---

## Quick Start

```bash
# Clone and start everything
git clone <repo-url>
cd payroute
docker-compose up --build
```

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:3001
- **Health check**: http://localhost:3001/health

The database schema is applied automatically on first startup (migrations run in the backend's startup sequence). Seed data (3 demo accounts with NGN balances) is included.

---

## Environment Variables

Copy `.env.example` and adjust as needed. Never commit real secrets.

```bash
cp .env.example .env
```

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URL` | PostgreSQL connection string | `postgres://payroute:payroute_pass@db:5432/payroute` |
| `PORT` | Backend port | `3001` |
| `WEBHOOK_SECRET` | HMAC-SHA256 secret for webhook verification | required |
| `CORS_ORIGIN` | Allowed frontend origin | `http://localhost:5173` |

---

## API Reference

### `POST /payments`
Initiate a cross-border payment.

**Headers**: `Idempotency-Key: <unique-string>`

**Body**:
```json
{
  "sender_account_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  "recipient_name": "Acme Supplies Inc",
  "recipient_country": "US",
  "recipient_currency": "USD",
  "source_amount": 500000
}
```

### `GET /payments/:id`
Full transaction details with ledger entries and status timeline.

### `GET /payments`
Paginated list. Query params: `status`, `date_from`, `date_to`, `page`, `limit`.

### `GET /payments/quote`
Fetch a live FX quote. Query params: `destination_currency`, `amount`.

### `POST /webhooks/provider`
Receive async status callbacks from the downstream provider.

**Headers**: `X-Webhook-Signature: <hmac-sha256>`

### `POST /webhooks/simulate`
**Test helper** — manually trigger a webhook for a payment to demo the full lifecycle.

```json
{
  "provider_reference": "PRV-XXXXXXXXXX",
  "status": "completed"
}
```

### `GET /accounts`
List all demo accounts with balances.

---

## Running Tests

```bash
cd backend
npm install
DATABASE_URL=postgres://payroute:payroute_pass@localhost:5432/payroute \
WEBHOOK_SECRET=test_secret \
npm test
```

Tests require a running PostgreSQL instance. With docker-compose running, the DB is available on `localhost:5432`.

---

## Project Structure

```
payroute/
├── backend/
│   ├── src/
│   │   ├── config/         # DB pool, migration runner
│   │   ├── db/migrations/  # SQL migration files
│   │   ├── middleware/      # Error handler
│   │   ├── routes/          # payments, webhooks, accounts
│   │   └── services/        # Business logic (payment, fx, provider)
│   └── tests/
├── frontend/
│   └── src/
│       ├── api/             # Axios client
│       ├── components/      # StatusBadge, Pagination, LedgerEntries
│       ├── pages/           # TransactionList, PaymentForm, TransactionDetail
│       └── utils/
├── docker-compose.yml
└── README.md
```

---

## Demo Walkthrough

1. Open http://localhost:3000
2. Click **New Payment** — select a sender account, fill in recipient details, observe the live FX quote with 30s countdown
3. Submit — the payment moves to `processing` status (funds locked)
4. Open the transaction detail page — click **Mark Completed** or **Mark Failed** to simulate the provider webhook
5. Observe the status timeline and ledger entries update

---
