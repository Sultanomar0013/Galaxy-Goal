-- AlterTable
ALTER TABLE `goal` ADD COLUMN `capsule` TEXT NULL,
    ADD COLUMN `limited` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `why` VARCHAR(500) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `lastSeenAt` DATETIME(3) NULL,
    ADD COLUMN `publicSlug` VARCHAR(40) NULL;

-- CreateTable
CREATE TABLE `GoalStep` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `position` INTEGER NOT NULL,
    `doneAt` DATETIME(3) NULL,
    `pending` BOOLEAN NOT NULL DEFAULT false,
    `suggestedById` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `GoalStep_goalId_idx`(`goalId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoalLink` (
    `id` VARCHAR(191) NOT NULL,
    `fromId` VARCHAR(191) NOT NULL,
    `toId` VARCHAR(191) NOT NULL,

    INDEX `GoalLink_toId_idx`(`toId`),
    UNIQUE INDEX `GoalLink_fromId_toId_key`(`fromId`, `toId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoalNote` (
    `id` VARCHAR(191) NOT NULL,
    `goalId` VARCHAR(191) NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `text` VARCHAR(280) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `readAt` DATETIME(3) NULL,

    INDEX `GoalNote_goalId_createdAt_idx`(`goalId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `GoalShare` (
    `goalId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `GoalShare_userId_idx`(`userId`),
    PRIMARY KEY (`goalId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Visit` (
    `visitorId` VARCHAR(191) NOT NULL,
    `hostId` VARCHAR(191) NOT NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Visit_hostId_at_idx`(`hostId`, `at`),
    PRIMARY KEY (`visitorId`, `hostId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Mentorship` (
    `ownerId` VARCHAR(191) NOT NULL,
    `mentorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Mentorship_mentorId_idx`(`mentorId`),
    PRIMARY KEY (`ownerId`, `mentorId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendGroup` (
    `id` VARCHAR(191) NOT NULL,
    `ownerId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(40) NOT NULL,
    `color` VARCHAR(7) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `FriendGroup_ownerId_idx`(`ownerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `FriendGroupMember` (
    `groupId` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,

    INDEX `FriendGroupMember_userId_idx`(`userId`),
    PRIMARY KEY (`groupId`, `userId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PushSub` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `endpoint` VARCHAR(600) NOT NULL,
    `p256dh` VARCHAR(200) NOT NULL,
    `auth` VARCHAR(100) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PushSub_endpoint_key`(`endpoint`),
    INDEX `PushSub_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `User_publicSlug_key` ON `User`(`publicSlug`);

-- AddForeignKey
ALTER TABLE `GoalStep` ADD CONSTRAINT `GoalStep_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `Goal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalStep` ADD CONSTRAINT `GoalStep_suggestedById_fkey` FOREIGN KEY (`suggestedById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalLink` ADD CONSTRAINT `GoalLink_fromId_fkey` FOREIGN KEY (`fromId`) REFERENCES `Goal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalLink` ADD CONSTRAINT `GoalLink_toId_fkey` FOREIGN KEY (`toId`) REFERENCES `Goal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalNote` ADD CONSTRAINT `GoalNote_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `Goal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalNote` ADD CONSTRAINT `GoalNote_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalShare` ADD CONSTRAINT `GoalShare_goalId_fkey` FOREIGN KEY (`goalId`) REFERENCES `Goal`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `GoalShare` ADD CONSTRAINT `GoalShare_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Visit` ADD CONSTRAINT `Visit_visitorId_fkey` FOREIGN KEY (`visitorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Visit` ADD CONSTRAINT `Visit_hostId_fkey` FOREIGN KEY (`hostId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mentorship` ADD CONSTRAINT `Mentorship_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Mentorship` ADD CONSTRAINT `Mentorship_mentorId_fkey` FOREIGN KEY (`mentorId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroup` ADD CONSTRAINT `FriendGroup_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroupMember` ADD CONSTRAINT `FriendGroupMember_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `FriendGroup`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `FriendGroupMember` ADD CONSTRAINT `FriendGroupMember_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PushSub` ADD CONSTRAINT `PushSub_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

