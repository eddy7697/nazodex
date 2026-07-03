-- Auth.js Prisma adapter requires User.emailVerified.
-- Additive, non-destructive: adds a nullable column.
ALTER TABLE `User` ADD COLUMN `emailVerified` DATETIME(3) NULL;
