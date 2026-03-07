require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

async function main() {
  await prisma.account.upsert({
    where: { id: SYSTEM_ACCOUNT_ID },
    update: {},
    create: {
      id: SYSTEM_ACCOUNT_ID,
      businessName: "PayRoute System Float",
      email: "system@payroute.internal",
      balances: {
        create: [
          { currency: "NGN", balance: 0 },
          { currency: "USD", balance: 0 },
          { currency: "GBP", balance: 0 },
          { currency: "EUR", balance: 0 },
        ],
      },
    },
  });

  const demoAccounts = [
    {
      id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      businessName: "Acme Imports Ltd",
      email: "acme@example.com",
      balances: [
        { currency: "NGN", balance: 5000000 },
        { currency: "USD", balance: 0 },
      ],
    },
    {
      id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      businessName: "Global Traders Co",
      email: "global@example.com",
      balances: [
        { currency: "NGN", balance: 10000000 },
        { currency: "USD", balance: 500 },
      ],
    },
    {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      businessName: "Sunrise Exporters",
      email: "sunrise@example.com",
      balances: [
        { currency: "NGN", balance: 2500000 },
        { currency: "EUR", balance: 0 },
      ],
    },
  ];

  for (const account of demoAccounts) {
    await prisma.account.upsert({
      where: { id: account.id },
      update: {},
      create: {
        id: account.id,
        businessName: account.businessName,
        email: account.email,
        balances: { create: account.balances },
      },
    });
  }

  console.log("Seed complete");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
