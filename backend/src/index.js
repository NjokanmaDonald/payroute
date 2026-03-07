require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const prisma = require("./config/db");
const errorHandler = require("./middleware/errorHandler");

const paymentsRouter = require("./routes/payments");
const webhooksRouter = require("./routes/webhooks");
const accountsRouter = require("./routes/accounts");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN || "http://localhost:5173" }));

// Parse JSON for all routes EXCEPT /webhooks/provider,
// which uses express.raw() for HMAC signature verification.
app.use((req, res, next) => {
  if (req.path === "/webhooks/provider") return next();
  express.json()(req, res, next);
});

app.get("/health", (req, res) =>
  res.json({ status: "ok", ts: new Date().toISOString() }),
);

app.use("/api/v1/payments", paymentsRouter);
app.use("/api/v1/webhooks", webhooksRouter);
app.use("/api/v1/accounts", accountsRouter);

app.use(errorHandler);

const PORT = process.env.PORT || 3001;

async function start() {
  try {
    await prisma.$connect();
    app.listen(PORT, () =>
      console.log(`PayRoute API listening on port ${PORT}`),
    );
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

module.exports = app;
