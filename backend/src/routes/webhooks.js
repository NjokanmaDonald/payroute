const express = require("express");
const router = express.Router();
const { handleProviderWebhook, simulateWebhook } = require("../controllers/webhookController");

router.post("/provider", express.raw({ type: "*/*" }), handleProviderWebhook);
router.post("/simulate", simulateWebhook);

module.exports = router;
