ALTER TABLE reviews DROP COLUMN app_icon_url;
ALTER TABLE reviews DROP COLUMN app_category;

PRAGMA optimize;
