// ============================================
// Instant Event Photo Sharing - Server
// Node.js + Express + SQLite (better-sqlite3)
// ============================================

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const QRCode = require('qrcode');
const PDFDocument = require('pdfkit');
const archiver = require('archiver');
const Database = require('better-sqlite3');
const faceRec = require('./faceRecognition');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- Config ----
// Change this to your real domain when you deploy (used inside the QR code URL)
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// ---- DB setup ----

const DATA_DIR = process.env.DATA_DIR || __dirname;

fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, 'photoshare.db');

// Copy the existing database on first deployment, if available
if (
  !fs.existsSync(dbPath) &&
  fs.existsSync(path.join(__dirname, 'db', 'photoshare.db'))
) {
  fs.copyFileSync(
    path.join(__dirname, 'db', 'photoshare.db'),
    dbPath
  );
}

const db = new Database(dbPath);

db.pragma('foreign_keys = ON');
const schema = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
db.exec(schema);

// ---- Uploads folder ----
const uploadsDir = path.join(DATA_DIR, 'uploads');

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Store files under public/uploads/<event_code>/
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const eventCode = req.params.eventCode;
    const dir = path.join(uploadsDir, eventCode);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } }); // 25MB/photo

// Separate in-memory upload for guest selfies (never written to disk)
const selfieUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(express.json());

// Serve uploaded photos from persistent storage
app.use('/uploads', express.static(uploadsDir));

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// ADMIN API
// ============================================

// Create a new event -> also generates its QR code
app.post('/api/events', (req, res) => {
  const { name, eventCode, eventDate } = req.body;
  if (!name || !eventCode) {
    return res.status(400).json({ error: 'name and eventCode are required' });
  }
  try {
    const stmt = db.prepare(
      `INSERT INTO events (name, event_code, event_date) VALUES (?, ?, ?)`
    );
    const info = stmt.run(name, eventCode, eventDate || null);

    // Generate QR code pointing to the guest gallery page
    const galleryUrl = `${BASE_URL}/gallery.html?event=${encodeURIComponent(eventCode)}`;
    const qrDir = path.join(uploadsDir, eventCode);
    if (!fs.existsSync(qrDir)) fs.mkdirSync(qrDir, { recursive: true });
    const qrFileName = 'qr.png';
    const qrFilePath = path.join(qrDir, qrFileName);

    QRCode.toFile(qrFilePath, galleryUrl, { width: 500 }, (err) => {
      if (err) console.error('QR generation failed:', err);
    });

    const qrPublicPath = `/uploads/${eventCode}/${qrFileName}`;
    db.prepare(`UPDATE events SET qr_image_path = ? WHERE id = ?`)
      .run(qrPublicPath, info.lastInsertRowid);

    res.json({
      id: info.lastInsertRowid,
      name,
      eventCode,
      galleryUrl,
      qrImage: qrPublicPath
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Generate a printable, ready-to-display PDF for an event's QR code.
// Pulls the event's own name/date/code (no extra input needed) and streams
// a single-page A4 PDF back — the same link works for "Download" buttons.
function formatEventDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

app.get('/api/events/:eventCode/qr-pdf', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const qrFilePath = path.join(uploadsDir, event.event_code, 'qr.png');
  if (!fs.existsSync(qrFilePath)) {
    return res.status(404).json({ error: 'QR code image not found for this event yet' });
  }

  const galleryUrl = `${BASE_URL}/gallery.html?event=${encodeURIComponent(event.event_code)}`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${event.event_code}-qr-code.pdf"`);

  const doc = new PDFDocument({ size: 'A4', margin: 0 });
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const contentX = 60;
  const contentWidth = pageWidth - contentX * 2;

  // Top / bottom accent bands
  doc.rect(0, 0, pageWidth, 16).fill('#1a1a1a');
  doc.rect(0, pageHeight - 16, pageWidth, 16).fill('#1a1a1a');

  // Eyebrow
  doc.fillColor('#8a8a8a')
    .font('Helvetica-Bold')
    .fontSize(11)
    .text('INSTANT PHOTO SHARE', contentX, 64, {
      width: contentWidth, align: 'center', characterSpacing: 2
    });

  // Event name
  doc.fillColor('#1a1a1a')
    .font('Helvetica-Bold')
    .fontSize(28)
    .text(event.name, contentX, 96, { width: contentWidth, align: 'center' });

  // Event date (optional)
  let cursorY = doc.y + 6;
  const formattedDate = formatEventDate(event.event_date);
  if (formattedDate) {
    doc.fillColor('#666666')
      .font('Helvetica')
      .fontSize(13)
      .text(formattedDate, contentX, cursorY, { width: contentWidth, align: 'center' });
    cursorY = doc.y;
  }

  // QR code, framed
  const qrSize = 300;
  const qrX = (pageWidth - qrSize) / 2;
  const qrY = cursorY + 40;
  doc.roundedRect(qrX - 24, qrY - 24, qrSize + 48, qrSize + 48, 8)
    .strokeColor('#dddddd').lineWidth(1).stroke();
  doc.image(qrFilePath, qrX, qrY, { width: qrSize, height: qrSize });

  // Caption + link
  doc.fillColor('#1a1a1a')
    .font('Helvetica-Bold')
    .fontSize(17)
    .text('Scan to view & share photos', contentX, qrY + qrSize + 50, {
      width: contentWidth, align: 'center'
    });

  doc.fillColor('#777777')
    .font('Helvetica')
    .fontSize(11)
    .text(galleryUrl, contentX, doc.y + 6, { width: contentWidth, align: 'center' });

  // Footer instructions
  doc.fillColor('#999999')
    .font('Helvetica')
    .fontSize(10)
    .text('Point your phone camera at the QR code — no app or sign-in needed.', contentX, pageHeight - 70, {
      width: contentWidth, align: 'center'
    });

  doc.end();
});

// List all events (admin)
app.get('/api/events', (req, res) => {
  const events = db.prepare(`SELECT * FROM events ORDER BY created_at DESC`).all();
  const withCounts = events.map(ev => ({
    ...ev,
    photoCount: db.prepare(`SELECT COUNT(*) AS c FROM photos WHERE event_id = ?`).get(ev.id).c
  }));
  res.json(withCounts);
});

// Update an event's name / date (event_code is immutable — it's baked into the QR code)
app.put('/api/events/:eventCode', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const { name, eventDate } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  db.prepare(`UPDATE events SET name = ?, event_date = ? WHERE id = ?`)
    .run(name.trim(), eventDate || null, event.id);

  const updated = db.prepare(`SELECT * FROM events WHERE id = ?`).get(event.id);
  res.json(updated);
});

// Delete an event entirely: DB rows (cascades to photos/photo_faces/downloads) + files on disk
app.delete('/api/events/:eventCode', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  db.prepare(`DELETE FROM events WHERE id = ?`).run(event.id); // cascades via FK

  const eventDir = path.join(uploadsDir, event.event_code);
  fs.rm(eventDir, { recursive: true, force: true }, (err) => {
    if (err) console.error(`Failed to remove upload folder for ${event.event_code}:`, err.message);
  });

  res.json({ deleted: true, eventCode: event.event_code });
});

// Upload photos to an event
app.post('/api/events/:eventCode/photos', upload.array('photos', 50), async (req, res) => {
  const { eventCode } = req.params;
  const category = req.body.category === 'professional' ? 'professional' : 'candid';

  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const insert = db.prepare(
    `INSERT INTO photos (event_id, file_name, category) VALUES (?, ?, ?)`
  );
  const insertFace = db.prepare(
    `INSERT INTO photo_faces (photo_id, descriptor) VALUES (?, ?)`
  );

  const inserted = [];
  for (const file of req.files) {
    const info = insert.run(event.id, file.filename, category);
    const photoId = info.lastInsertRowid;
    inserted.push({ id: photoId, file: file.filename });

    // Detect faces in the photo and store their descriptors for later matching.
    // Runs async per photo but we await sequentially to keep memory use predictable.
    try {
      const descriptors = await faceRec.getFaceDescriptors(file.path);
      for (const descriptor of descriptors) {
        insertFace.run(photoId, JSON.stringify(descriptor));
      }
    } catch (err) {
      console.error(`Face detection failed for ${file.filename}:`, err.message);
    }
  }
  res.json({ uploaded: inserted.length, files: inserted });
});

// Admin: list photos for an event (used by the "Manage Photos" panel)
app.get('/api/events/:eventCode/admin-photos', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const photos = db.prepare(
    `SELECT * FROM photos WHERE event_id = ? ORDER BY uploaded_at DESC`
  ).all(event.id);

  const withUrls = photos.map(p => ({
    ...p,
    url: `/uploads/${event.event_code}/${p.file_name}`
  }));
  res.json(withUrls);
});

// Admin: change a photo's category (move between Professional / Candid)
app.put('/api/photos/:photoId', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });

  const category = req.body.category === 'professional' ? 'professional' : 'candid';
  db.prepare(`UPDATE photos SET category = ? WHERE id = ?`).run(category, photo.id);
  res.json({ ...photo, category });
});

// Admin: delete a single photo (DB row + face data via cascade + file on disk)
app.delete('/api/photos/:photoId', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.photoId);
  if (!photo) return res.status(404).json({ error: 'Photo not found' });
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(photo.event_id);

  db.prepare(`DELETE FROM photos WHERE id = ?`).run(photo.id); // cascades to photo_faces/downloads

  const filePath = path.join(uploadsDir, event.event_code, photo.file_name);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== 'ENOENT') console.error(`Failed to remove file ${filePath}:`, err.message);
  });

  res.json({ deleted: true, photoId: photo.id });
});

// Guest "Find My Photos": upload a selfie, get back only photos containing that face.
// The selfie itself is never saved - only used in memory to compute a signature.
app.post('/api/events/:eventCode/find-my-photos', selfieUpload.single('selfie'), async (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  if (!req.file) return res.status(400).json({ error: 'No selfie provided' });

  let selfieDescriptor;
  try {
    selfieDescriptor = await faceRec.getSelfieDescriptor(req.file.buffer);
  } catch (err) {
    return res.status(500).json({ error: 'Could not process selfie' });
  }
  if (!selfieDescriptor) {
    return res.status(422).json({ error: 'No clear face detected in selfie. Try better lighting and face the camera directly.' });
  }

  const rows = db.prepare(`
    SELECT pf.photo_id, pf.descriptor, p.file_name, p.category
    FROM photo_faces pf
    JOIN photos p ON p.id = pf.photo_id
    WHERE p.event_id = ?
  `).all(event.id);

  const matchedPhotoIds = new Map(); // photo_id -> best (lowest) distance
  for (const row of rows) {
    const distance = faceRec.euclideanDistance(selfieDescriptor, JSON.parse(row.descriptor));
    if (distance <= faceRec.MATCH_THRESHOLD) {
      const existing = matchedPhotoIds.get(row.photo_id);
      if (existing === undefined || distance < existing) {
        matchedPhotoIds.set(row.photo_id, distance);
      }
    }
  }

  const results = [...matchedPhotoIds.entries()]
    .sort((a, b) => a[1] - b[1]) // best matches first
    .map(([photoId, distance]) => {
      const photo = rows.find(r => r.photo_id === photoId);
      return {
        id: photoId,
        url: `/uploads/${event.event_code}/${photo.file_name}`,
        category: photo.category,
        confidence: Math.round((1 - distance / faceRec.MATCH_THRESHOLD) * 100)
      };
    });

  res.json({ matched: results.length, photos: results });
});

// ============================================
// GUEST-FACING API (used by gallery.html)
// ============================================

// Get event info by code
app.get('/api/events/:eventCode', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });
  res.json(event);
});

// Get all photos for an event (optionally filter by category)
app.get('/api/events/:eventCode/photos', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).json({ error: 'Event not found' });

  const { category } = req.query;
  let photos;
  if (category) {
    photos = db.prepare(
      `SELECT * FROM photos WHERE event_id = ? AND category = ? ORDER BY uploaded_at DESC`
    ).all(event.id, category);
  } else {
    photos = db.prepare(
      `SELECT * FROM photos WHERE event_id = ? ORDER BY uploaded_at DESC`
    ).all(event.id);
  }

  const withUrls = photos.map(p => ({
    ...p,
    url: `/uploads/${event.event_code}/${p.file_name}`
  }));
  res.json(withUrls);
});

// Log + serve a single download (keeps a counter of downloads per photo)
app.get('/api/photos/:photoId/download', (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(req.params.photoId);
  if (!photo) return res.status(404).send('Photo not found');
  const event = db.prepare(`SELECT * FROM events WHERE id = ?`).get(photo.event_id);

  db.prepare(`INSERT INTO downloads (photo_id, guest_ip) VALUES (?, ?)`)
    .run(photo.id, req.ip);

  const filePath = path.join(uploadsDir, event.event_code, photo.file_name);
  res.download(filePath, photo.file_name);
});

// Download ALL photos for an event as a single zip (streamed, no temp file)
app.get('/api/events/:eventCode/download-all', (req, res) => {
  const event = db.prepare(`SELECT * FROM events WHERE event_code = ?`).get(req.params.eventCode);
  if (!event) return res.status(404).send('Event not found');
  const photos = db.prepare(`SELECT * FROM photos WHERE event_id = ?`).all(event.id);

  res.attachment(`${event.event_code}-photos.zip`);
  const archive = archiver('zip', { zlib: { level: 9 } });
  archive.pipe(res);
  for (const p of photos) {
    const filePath = path.join(uploadsDir, event.event_code, p.file_name);
    if (fs.existsSync(filePath)) archive.file(filePath, { name: p.file_name });
  }
  archive.finalize();
});


let faceModelsReady = false;

// Health check for Render
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    faceModelsReady
  });
});

// Start Express immediately
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`Instant Photo Share running on port ${PORT}`);
  console.log(`Public URL: ${BASE_URL}`);

  // Load face recognition models in the background
  faceRec.loadModels()
    .then(() => {
      faceModelsReady = true;
      console.log('Face recognition models loaded successfully.');
    })
    .catch(err => {
      console.error('Face recognition model loading failed:', err);
      console.error(err.stack);
      console.log('Website will continue running without face recognition.');
    });
});

// Handle unexpected server errors
server.on('error', (err) => {
  console.error('Server startup error:', err);
  process.exit(1);
});
