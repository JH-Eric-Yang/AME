import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const BcryptRounds = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  const name = process.env.ADMIN_NAME ?? "Platform Admin";

  if (!email || !password) {
    console.log("Skipping admin seed: ADMIN_EMAIL and ADMIN_PASSWORD not set");
    return;
  }

  const existing = await prisma.experimenter.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin account already exists: ${email}`);
    return;
  }

  const hashed = await bcrypt.hash(password, BcryptRounds);
  await prisma.experimenter.create({
    data: { email, password: hashed, name, role: "ADMIN", status: "APPROVED" },
  });

  console.log(`Admin account created: ${email}`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
