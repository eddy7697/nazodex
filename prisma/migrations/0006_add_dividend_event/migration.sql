-- CreateTable
CREATE TABLE `DividendEvent` (
    `id` VARCHAR(191) NOT NULL,
    `stockSymbol` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL,
    `exDate` DATE NOT NULL,
    `perShare` DOUBLE NOT NULL,
    `paymentDate` DATE NULL,
    `year` VARCHAR(191) NOT NULL,

    INDEX `DividendEvent_exDate_idx`(`exDate`),
    UNIQUE INDEX `DividendEvent_stockSymbol_exDate_kind_key`(`stockSymbol`, `exDate`, `kind`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
