const express = require("express");
const router = express.Router();
const { createPayment, getPaymentQuote, listPayments, getPayment } = require("../controllers/paymentController");

router.post("/", createPayment);
router.get("/quote", getPaymentQuote);
router.get("/", listPayments);
router.get("/:id", getPayment);

module.exports = router;
