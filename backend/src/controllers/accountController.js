const prisma = require("../config/db");

const SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

async function listAccounts(req, res, next) {
  try {
    const accounts = await prisma.account.findMany({
      where: { id: { not: SYSTEM_ACCOUNT_ID } },
      include: { balances: { orderBy: { currency: "asc" } } },
      orderBy: { businessName: "asc" },
    });

    return res.json({
      data: accounts.map((a) => ({
        id: a.id,
        business_name: a.businessName,
        email: a.email,
        balances: a.balances.map((b) => ({
          currency: b.currency,
          balance: b.balance,
          locked_balance: b.lockedBalance,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
}

module.exports = { listAccounts };
