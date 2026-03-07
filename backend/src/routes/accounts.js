const express = require("express");
const router = express.Router();
const { listAccounts } = require("../controllers/accountController");

router.get("/", listAccounts);

module.exports = router;
