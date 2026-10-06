// Creates (or updates) the super admin account from SEED_ADMIN_* in .env.
// Run with: npm run db:seed
import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME?.trim() || "Super Admin";

  if (!email || !password) {
    throw new Error("Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD in .env before seeding.");
  }
  if (password.length < 8) {
    throw new Error("SEED_ADMIN_PASSWORD must be at least 8 characters.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const admin = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role: Role.SUPERADMIN, isActive: true, emailVerifiedAt: new Date() },
    create: { name, email, passwordHash, role: Role.SUPERADMIN, emailVerifiedAt: new Date() },
  });

  // a re-seed resets the password, so drop any sessions made with the old one
  await prisma.session.deleteMany({ where: { userId: admin.id } });

  console.log(`Super admin ready: ${admin.email} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
