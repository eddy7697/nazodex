-- CreateTable
CREATE TABLE `MonthlyRevenue` (
    `id` VARCHAR(191) NOT NULL,
    `stockSymbol` VARCHAR(191) NOT NULL,
    `month` DATE NOT NULL,
    `revenue` BIGINT NOT NULL,
    `yoyPct` DOUBLE NULL,

    INDEX `MonthlyRevenue_month_idx`(`month`),
    UNIQUE INDEX `MonthlyRevenue_stockSymbol_month_key`(`stockSymbol`, `month`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `QuarterlyEps` (
    `id` VARCHAR(191) NOT NULL,
    `stockSymbol` VARCHAR(191) NOT NULL,
    `quarter` DATE NOT NULL,
    `eps` DOUBLE NOT NULL,

    UNIQUE INDEX `QuarterlyEps_stockSymbol_quarter_key`(`stockSymbol`, `quarter`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
