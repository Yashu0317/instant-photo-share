// ---- Create Event ----
document.getElementById('eventForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('eventName').value.trim();
  const eventCode = document.getElementById('eventCode').value.trim();
  const eventDate = document.getElementById('eventDate').value;

  const res = await fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, eventCode, eventDate })
  });
  const data = await res.json();
  const resultDiv = document.getElementById('eventResult');

  if (!res.ok) {
    resultDiv.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }

  resultDiv.innerHTML = `
    <p class="success">✅ Event created! Share this QR code at your event:</p>
    <img src="${data.qrImage}" alt="QR code" style="width:180px;">
    <p><a href="${data.galleryUrl}" target="_blank">${data.galleryUrl}</a></p>
    <a class="btn small" href="/api/events/${encodeURIComponent(eventCode)}/qr-pdf" download>⬇ Download Printable QR (PDF)</a>
  `;
  document.getElementById('eventForm').reset();
  document.getElementById('uploadEventCode').value = eventCode;
  loadEvents();
});

// ---- Upload Photos ----
document.getElementById('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventCode = document.getElementById('uploadEventCode').value.trim();
  const category = document.getElementById('category').value;
  const files = document.getElementById('photos').files;

  const formData = new FormData();
  formData.append('category', category);
  for (const f of files) formData.append('photos', f);

  const resultDiv = document.getElementById('uploadResult');
  resultDiv.innerHTML = `<p>Uploading&hellip;</p>`;

  const res = await fetch(`/api/events/${encodeURIComponent(eventCode)}/photos`, {
    method: 'POST',
    body: formData
  });
  const data = await res.json();

  if (!res.ok) {
    resultDiv.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }
  resultDiv.innerHTML = `<p class="success">✅ Uploaded ${data.uploaded} photo(s).</p>`;
  document.getElementById('uploadForm').reset();
  loadEvents();
});

// ---- List Events ----
async function loadEvents() {
  const res = await fetch('/api/events');
  const events = await res.json();
  const list = document.getElementById('eventsList');

  if (!events.length) {
    list.innerHTML = ''; // CSS :empty state shows the placeholder copy
    return;
  }

  list.innerHTML = events.map(ev => `
    <div class="event-item">
      ${ev.qr_image_path ? `<img src="${ev.qr_image_path}" alt="QR code for ${escapeHtml(ev.name)}">` : ''}
      <div class="info">
        <strong>${escapeHtml(ev.name)}</strong>
        ${ev.event_date ? `<span class="event-item__date">${escapeHtml(ev.event_date)}</span>` : ''}
        <br>
        <a href="/gallery.html?event=${encodeURIComponent(ev.event_code)}" target="_blank">
          /gallery.html?event=${escapeHtml(ev.event_code)}
        </a>
        <span class="event-item__count">${ev.photoCount} photo${ev.photoCount === 1 ? '' : 's'}</span>
      </div>
      <div class="event-item__actions">
        <a class="btn small" href="/api/events/${encodeURIComponent(ev.event_code)}/qr-pdf" download>Download QR (PDF)</a>
        <button type="button" class="btn small" data-action="edit" data-code="${escapeAttr(ev.event_code)}">Edit</button>
        <button type="button" class="btn small" data-action="manage-photos" data-code="${escapeAttr(ev.event_code)}">Manage Photos</button>
        <button type="button" class="btn small danger" data-action="delete-event" data-code="${escapeAttr(ev.event_code)}">Delete</button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('[data-action="edit"]').forEach(btn =>
    btn.addEventListener('click', () => openEditEvent(btn.dataset.code, events))
  );
  list.querySelectorAll('[data-action="manage-photos"]').forEach(btn =>
    btn.addEventListener('click', () => openManagePhotos(btn.dataset.code))
  );
  list.querySelectorAll('[data-action="delete-event"]').forEach(btn =>
    btn.addEventListener('click', () => deleteEvent(btn.dataset.code))
  );
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

// ---- Edit Event ----
const editEventModal = document.getElementById('editEventModal');
const editEventForm = document.getElementById('editEventForm');

function openEditEvent(eventCode, events) {
  const ev = events.find(e => e.event_code === eventCode);
  if (!ev) return;
  document.getElementById('editEventCode').value = ev.event_code;
  document.getElementById('editEventName').value = ev.name;
  document.getElementById('editEventDate').value = ev.event_date || '';
  document.getElementById('editEventResult').innerHTML = '';
  editEventModal.classList.remove('hidden');
}
function closeEditEvent() { editEventModal.classList.add('hidden'); }

document.getElementById('editEventClose').addEventListener('click', closeEditEvent);
editEventModal.addEventListener('click', (e) => { if (e.target === editEventModal) closeEditEvent(); });

editEventForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const eventCode = document.getElementById('editEventCode').value;
  const name = document.getElementById('editEventName').value.trim();
  const eventDate = document.getElementById('editEventDate').value;
  const resultDiv = document.getElementById('editEventResult');

  const res = await fetch(`/api/events/${encodeURIComponent(eventCode)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, eventDate })
  });
  const data = await res.json();

  if (!res.ok) {
    resultDiv.innerHTML = `<p class="error">${data.error}</p>`;
    return;
  }
  resultDiv.innerHTML = `<p class="success">✅ Saved.</p>`;
  loadEvents();
  setTimeout(closeEditEvent, 600);
});

// ---- Delete Event ----
async function deleteEvent(eventCode) {
  const confirmed = confirm(
    `Delete this event permanently?\n\nThis removes the event, ALL of its photos, and the QR code. This cannot be undone.`
  );
  if (!confirmed) return;

  const res = await fetch(`/api/events/${encodeURIComponent(eventCode)}`, { method: 'DELETE' });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Failed to delete event.');
    return;
  }
  loadEvents();
}

// ---- Manage Photos ----
const managePhotosModal = document.getElementById('managePhotosModal');
const managePhotosGrid = document.getElementById('managePhotosGrid');
let managePhotosEventCode = null;

async function openManagePhotos(eventCode) {
  managePhotosEventCode = eventCode;
  document.getElementById('managePhotosTitle').textContent = `Photos — ${eventCode}`;
  managePhotosModal.classList.remove('hidden');
  await refreshManagePhotos();
}
function closeManagePhotos() {
  managePhotosModal.classList.add('hidden');
  managePhotosEventCode = null;
}

document.getElementById('managePhotosClose').addEventListener('click', closeManagePhotos);
managePhotosModal.addEventListener('click', (e) => { if (e.target === managePhotosModal) closeManagePhotos(); });

async function refreshManagePhotos() {
  if (!managePhotosEventCode) return;
  managePhotosGrid.innerHTML = `<p>Loading&hellip;</p>`;

  const res = await fetch(`/api/events/${encodeURIComponent(managePhotosEventCode)}/admin-photos`);
  const photos = await res.json();

  if (!res.ok) {
    managePhotosGrid.innerHTML = `<p class="error">${photos.error || 'Could not load photos.'}</p>`;
    return;
  }
  if (!photos.length) {
    managePhotosGrid.innerHTML = `<p class="empty-state">No photos uploaded for this event yet.</p>`;
    return;
  }

  managePhotosGrid.innerHTML = photos.map(p => `
    <div class="manage-photo-card" data-id="${p.id}">
      <img src="${p.url}" alt="Event photo" loading="lazy">
      <select class="manage-photo-card__category" data-id="${p.id}">
        <option value="candid" ${p.category === 'candid' ? 'selected' : ''}>Candid</option>
        <option value="professional" ${p.category === 'professional' ? 'selected' : ''}>Professional</option>
      </select>
      <button type="button" class="btn small danger manage-photo-card__delete" data-id="${p.id}">Delete</button>
    </div>
  `).join('');

  managePhotosGrid.querySelectorAll('.manage-photo-card__category').forEach(sel =>
    sel.addEventListener('change', () => updatePhotoCategory(sel.dataset.id, sel.value))
  );
  managePhotosGrid.querySelectorAll('.manage-photo-card__delete').forEach(btn =>
    btn.addEventListener('click', () => deletePhoto(btn.dataset.id))
  );
}

async function updatePhotoCategory(photoId, category) {
  const res = await fetch(`/api/photos/${photoId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category })
  });
  if (!res.ok) {
    alert('Failed to update category.');
    refreshManagePhotos();
  }
}

async function deletePhoto(photoId) {
  const confirmed = confirm('Delete this photo permanently? This cannot be undone.');
  if (!confirmed) return;

  const card = managePhotosGrid.querySelector(`.manage-photo-card[data-id="${photoId}"]`);
  if (card) card.style.opacity = '.4';

  const res = await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
  if (!res.ok) {
    alert('Failed to delete photo.');
    if (card) card.style.opacity = '1';
    return;
  }
  if (card) card.remove();
  loadEvents(); // photo counts changed
  if (managePhotosGrid.children.length === 0) {
    managePhotosGrid.innerHTML = `<p class="empty-state">No photos uploaded for this event yet.</p>`;
  }
}

loadEvents();
