const params = new URLSearchParams(window.location.search);
const eventCode = params.get('event');

const galleryEl = document.getElementById('gallery');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxDownload = document.getElementById('lightboxDownload');

let currentFilter = 'all';
let matchedPhotos = null; // null = showing all photos; array = showing only face-matched ones
let cameraStream = null;

async function init() {
  if (!eventCode) {
    document.getElementById('eventName').textContent = 'No event specified';
    return;
  }

  const evRes = await fetch(`/api/events/${encodeURIComponent(eventCode)}`);
  if (!evRes.ok) {
    document.getElementById('eventName').textContent = 'Event not found';
    return;
  }
  const event = await evRes.json();
  document.getElementById('eventName').textContent = event.name;
  document.getElementById('eventDate').textContent = event.event_date || '';

  await loadPhotos();
}

async function loadPhotos() {
  let photos;

  if (matchedPhotos) {
    // Showing only the guest's face-matched photos, filtered by category client-side
    photos = currentFilter === 'all'
      ? matchedPhotos
      : matchedPhotos.filter(p => p.category === currentFilter);
    renderMatchBanner();
  } else {
    const url = currentFilter === 'all'
      ? `/api/events/${encodeURIComponent(eventCode)}/photos`
      : `/api/events/${encodeURIComponent(eventCode)}/photos?category=${currentFilter}`;
    const res = await fetch(url);
    photos = await res.json();
    removeMatchBanner();
  }

  if (!photos.length) {
    galleryEl.innerHTML = matchedPhotos
      ? `<p class="empty-state">No matches found in this filter. Try "All Photos" or clear the face search.</p>`
      : `<p class="empty-state">No photos yet — check back soon!</p>`;
    return;
  }

  galleryEl.innerHTML = photos.map(p => `
    <img src="${p.url}" data-full="${p.url}" data-id="${p.id}" loading="lazy" alt="Event photo">
  `).join('');

  document.querySelectorAll('.gallery img').forEach(img => {
    img.addEventListener('click', () => openLightbox(img.dataset.full, img.dataset.id));
  });
}

function renderMatchBanner() {
  removeMatchBanner();
  const banner = document.createElement('div');
  banner.id = 'matchBanner';
  banner.className = 'match-banner';
  banner.innerHTML = `Showing ${matchedPhotos.length} photo(s) matched to your face. <button id="clearMatchBtn">Show all photos instead</button>`;
  document.querySelector('.filter-bar').insertAdjacentElement('beforebegin', banner);
  document.getElementById('clearMatchBtn').addEventListener('click', () => {
    matchedPhotos = null;
    document.getElementById('matchStatus').textContent = '';
    loadPhotos();
  });
}

function removeMatchBanner() {
  const existing = document.getElementById('matchBanner');
  if (existing) existing.remove();
}

// ---- Find My Photos (camera + face match) ----
const findMeBtn = document.getElementById('findMeBtn');
const cameraModal = document.getElementById('cameraModal');
const cameraVideo = document.getElementById('cameraVideo');
const cameraCanvas = document.getElementById('cameraCanvas');
const captureBtn = document.getElementById('captureBtn');
const cameraCancelBtn = document.getElementById('cameraCancelBtn');
const matchStatus = document.getElementById('matchStatus');

findMeBtn.addEventListener('click', async () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    matchStatus.textContent = 'Camera requires a secure connection (https://) or localhost. This page is loaded over plain http from a non-localhost address, so the browser blocks camera access here.';
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' }, // front camera
      audio: false
    });
    cameraVideo.srcObject = cameraStream;
    cameraModal.classList.remove('hidden');
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      matchStatus.textContent = 'Camera permission was denied. Check your browser\'s site settings and allow camera access, then try again.';
    } else if (err.name === 'NotFoundError') {
      matchStatus.textContent = 'No camera found on this device.';
    } else {
      matchStatus.textContent = `Camera unavailable: ${err.message}`;
    }
  }
});

cameraCancelBtn.addEventListener('click', closeCamera);

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cameraModal.classList.add('hidden');
}

captureBtn.addEventListener('click', async () => {
  cameraCanvas.width = cameraVideo.videoWidth;
  cameraCanvas.height = cameraVideo.videoHeight;
  const ctx = cameraCanvas.getContext('2d');
  ctx.drawImage(cameraVideo, 0, 0);

  closeCamera();
  matchStatus.textContent = 'Matching your face against event photos…';

  cameraCanvas.toBlob(async (blob) => {
    const formData = new FormData();
    formData.append('selfie', blob, 'selfie.jpg');

    try {
      const res = await fetch(`/api/events/${encodeURIComponent(eventCode)}/find-my-photos`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();

      if (!res.ok) {
        matchStatus.textContent = data.error || 'Could not match your face. Try again.';
        return;
      }
      matchedPhotos = data.photos;
      matchStatus.textContent = data.matched
        ? `Found ${data.matched} matching photo(s)!`
        : 'No matches yet — the photographer may not have uploaded your photos.';
      currentFilter = 'all';
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      document.querySelector('.filter-btn[data-filter="all"]').classList.add('active');
      loadPhotos();
    } catch (err) {
      matchStatus.textContent = 'Network error - please try again.';
    }
  }, 'image/jpeg', 0.9);
});

function openLightbox(src, photoId) {
  lightboxImg.src = src;
  lightboxDownload.href = `/api/photos/${photoId}/download`;
  lightbox.classList.remove('hidden');
}

document.getElementById('lightboxClose').addEventListener('click', () => {
  lightbox.classList.add('hidden');
});

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.filter;
    loadPhotos();
  });
});

document.getElementById('downloadAllBtn').addEventListener('click', () => {
  window.location.href = `/api/events/${encodeURIComponent(eventCode)}/download-all`;
});

init();
