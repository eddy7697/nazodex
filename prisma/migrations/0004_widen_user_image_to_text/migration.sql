-- LINE 頭像 URL 可超過 VARCHAR(191),放寬為 TEXT(Auth.js adapter createUser 寫入)
ALTER TABLE `User` MODIFY `image` TEXT NULL;
