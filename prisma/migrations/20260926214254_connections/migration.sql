-- AlterTable
ALTER TABLE `goal` ADD COLUMN `isPrivate` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `Connection` (
    `id` VARCHAR(191) NOT NULL,
    `requesterId` VARCHAR(191) NOT NULL,
    `addresseeId` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'ACCEPTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `respondedAt` DATETIME(3) NULL,

    INDEX `Connection_addresseeId_idx`(`addresseeId`),
    UNIQUE INDEX `Connection_requesterId_addresseeId_key`(`requesterId`, `addresseeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Connection` ADD CONSTRAINT `Connection_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Connection` ADD CONSTRAINT `Connection_addresseeId_fkey` FOREIGN KEY (`addresseeId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
