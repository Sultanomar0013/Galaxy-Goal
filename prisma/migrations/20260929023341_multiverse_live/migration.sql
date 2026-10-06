-- AlterTable
ALTER TABLE `multiverse` ADD COLUMN `completedAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `MvActivity` (
    `id` VARCHAR(191) NOT NULL,
    `multiverseId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `kind` ENUM('CREATED', 'JOINED', 'LEFT', 'MILESTONE_ADDED', 'MILESTONE_DONE', 'COMPLETED') NOT NULL,
    `text` VARCHAR(200) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MvActivity_multiverseId_createdAt_idx`(`multiverseId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `MvActivity` ADD CONSTRAINT `MvActivity_multiverseId_fkey` FOREIGN KEY (`multiverseId`) REFERENCES `Multiverse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MvActivity` ADD CONSTRAINT `MvActivity_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
