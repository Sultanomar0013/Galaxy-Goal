-- CreateTable
CREATE TABLE `Multiverse` (
    `id` VARCHAR(191) NOT NULL,
    `creatorId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `category` VARCHAR(100) NOT NULL DEFAULT 'General',
    `importance` ENUM('HIGH', 'MEDIUM', 'LOW') NOT NULL DEFAULT 'MEDIUM',
    `targetDate` DATE NOT NULL,
    `status` ENUM('ONGOING', 'DONE', 'NOT_DONE') NOT NULL DEFAULT 'ONGOING',
    `notes` MEDIUMTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Multiverse_creatorId_idx`(`creatorId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MultiverseMember` (
    `id` VARCHAR(191) NOT NULL,
    `multiverseId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `status` ENUM('INVITED', 'ACTIVE') NOT NULL DEFAULT 'INVITED',
    `color` VARCHAR(7) NOT NULL,
    `invitedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `joinedAt` DATETIME(3) NULL,

    INDEX `MultiverseMember_userId_idx`(`userId`),
    UNIQUE INDEX `MultiverseMember_multiverseId_userId_key`(`multiverseId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Milestone` (
    `id` VARCHAR(191) NOT NULL,
    `multiverseId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `position` INTEGER NOT NULL,
    `doneAt` DATETIME(3) NULL,
    `doneById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Milestone_multiverseId_idx`(`multiverseId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ChangeRequest` (
    `id` VARCHAR(191) NOT NULL,
    `multiverseId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `kind` ENUM('GOAL_UPDATE', 'MILESTONE_ADD', 'MILESTONE_EDIT', 'MILESTONE_DELETE', 'MILESTONE_DONE', 'MILESTONE_UNDONE') NOT NULL,
    `milestoneId` VARCHAR(191) NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `decidedAt` DATETIME(3) NULL,

    INDEX `ChangeRequest_multiverseId_status_idx`(`multiverseId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Multiverse` ADD CONSTRAINT `Multiverse_creatorId_fkey` FOREIGN KEY (`creatorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MultiverseMember` ADD CONSTRAINT `MultiverseMember_multiverseId_fkey` FOREIGN KEY (`multiverseId`) REFERENCES `Multiverse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MultiverseMember` ADD CONSTRAINT `MultiverseMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Milestone` ADD CONSTRAINT `Milestone_multiverseId_fkey` FOREIGN KEY (`multiverseId`) REFERENCES `Multiverse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Milestone` ADD CONSTRAINT `Milestone_doneById_fkey` FOREIGN KEY (`doneById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChangeRequest` ADD CONSTRAINT `ChangeRequest_multiverseId_fkey` FOREIGN KEY (`multiverseId`) REFERENCES `Multiverse`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ChangeRequest` ADD CONSTRAINT `ChangeRequest_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
