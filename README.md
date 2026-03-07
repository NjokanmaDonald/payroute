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
├── ANALYSIS.md              # Written analysis (Part 4)
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

## Assumptions and Deliberate Tradeoffs

- **FX rates are hardcoded** in `fxService.js`. In production these would come from a live rate provider (e.g., Open Exchange Rates) and be cached with TTL.
- **Recipients are not separate accounts**. For simplicity, "recipient" is modelled as attributes on the transaction. In production, recipients would be a first-class entity with KYC data, bank account details, and compliance checks.
- **The system float account** (`00000000-0000-0000-0000-000000000001`) is used as the counter-entry for all ledger entries. In production this would be split into multiple functional accounts (suspense, nostro, FX P&L).
- **No authentication/authorization**. The API has no auth layer. In production every endpoint would require JWT/API key auth with role-based access.
- **Webhook simulate endpoint** is not protected. In production this would be gated to internal/ops networks only.
- **Tests require a live DB**. Integration tests against a real DB are more valuable than unit tests with mocked queries for payment logic, but they require more setup. A future improvement would be a test container that spins up automatically.
