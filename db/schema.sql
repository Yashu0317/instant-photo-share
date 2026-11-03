-- ============================================
-- Instant Event Photo Sharing - SQL Schema
-- ============================================

CREATE TABLE IF NOT EXISTS events (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT NOT NULL,
    event_code    TEXT UNIQUE NOT NULL,   -- short code used in QR URL, e.g. "wed-2026-08"
    event_date    TEXT,
    qr_image_path TEXT,                    -- path to generated QR code png
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS photos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id      INTEGER NOT NULL,
    file_name     TEXT NOT NULL,
    thumb_name    TEXT,                    -- optional thumbnail file
    category      TEXT DEFAULT 'candid',   -- 'professional' or 'candid'
    uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

-- One row per face detected inside a photo (a photo can contain many guests).
-- descriptor = 128-number face signature (JSON array) produced by face-api.js,
-- used to compare against a guest's selfie signature. No selfie images are stored.
CREATE TABLE IF NOT EXISTS photo_faces (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id      INTEGER NOT NULL,
    descriptor    TEXT NOT NULL,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_photo_faces_photo ON photo_faces(photo_id);

CREATE TABLE IF NOT EXISTS downloads (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    photo_id      INTEGER NOT NULL,
    downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    guest_ip      TEXT,
    FOREIGN KEY (photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_photos_event ON photos(event_id);
CREATE INDEX IF NOT EXISTS idx_downloads_photo ON downloads(photo_id);
