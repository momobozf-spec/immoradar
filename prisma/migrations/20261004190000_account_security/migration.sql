-- Accountbeveiliging: sessie-intrekking, inlogvergrendeling en verplichte
-- wachtwoordwijziging na een door een beheerder uitgegeven tijdelijk wachtwoord.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "sessionVersion" INTEGER NOT NULL DEFAULT 0;
