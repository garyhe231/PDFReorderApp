// PDF Reorder App — frontend logic

let sessionId = null;
let pages = [];        // [{index, detected, label, preview_text}, ...]
let currentOrder = []; // current 0-based page indices in display order

const uploadZone   = document.getElementById('upload-zone');
const fileInput    = document.getElementById('file-input');
const statusBar    = document.getElementById('status-bar');
const controls     = document.getElementById('controls');
const pagesSection = document.getElementById('pages-section');
const pagesGrid    = document.getElementById('pages-grid');
const autoSortBanner = document.getElementById('auto-sort-banner');
const downloadSection = document.getElementById('download-section');
const reorderBtn   = document.getElementById('reorder-btn');
const autoSortBtn  = document.getElementById('auto-sort-btn');
const resetBtn     = document.getElementById('reset-btn');
const downloadBtn  = document.getElementById('download-btn');
const newFileBtn   = document.getElementById('new-file-btn');
const totalPagesEl = document.getElementById('total-pages');
const detectedEl   = document.getElementById('detected-count');
const filenameEl   = document.getElementById('filename-label');

// ── Upload ───────────────────────────────────────────────────────────────────

uploadZone.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) handleFile(fileInput.files[0]);
});

async function handleFile(file) {
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    showStatus('Only PDF files are accepted.', 'error');
    return;
  }

  // Reset previous state
  if (sessionId) {
    fetch(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
  }
  sessionId = null;
  pages = [];
  currentOrder = [];
  hideSection(pagesSection);
  hideSection(downloadSection);
  hideSection(controls);
  autoSortBanner.style.display = 'none';

  showStatus(`<span class="spinner"></span> Uploading and analysing <strong>${file.name}</strong>…`, 'info');

  const fd = new FormData();
  fd.append('file', file);

  let resp;
  try {
    resp = await fetch('/upload', { method: 'POST', body: fd });
  } catch (err) {
    showStatus('Upload failed: ' + err.message, 'error');
    return;
  }
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    showStatus('Upload failed: ' + err.detail, 'error');
    return;
  }

  const data = await resp.json();
  sessionId = data.session_id;
  pages = data.pages;
  currentOrder = pages.map(p => p.index);

  const detected = pages.filter(p => p.detected !== null).length;
  showStatus(`Analysed <strong>${data.filename}</strong> — ${data.total_pages} pages, ${detected} page numbers detected.`, 'success');

  filenameEl.textContent = data.filename;
  totalPagesEl.textContent = data.total_pages;
  detectedEl.textContent = detected;

  controls.style.display = 'flex';
  renderGrid();
  pagesSection.style.display = 'block';
  downloadSection.style.display = 'none';

  // Auto-sort if all pages have detected numbers
  if (detected === data.total_pages) {
    autoSort(true);
  }
}

// ── Rendering ────────────────────────────────────────────────────────────────

function renderGrid() {
  pagesGrid.innerHTML = '';
  currentOrder.forEach((pageIdx, displayPos) => {
    const page = pages[pageIdx];
    const card = document.createElement('div');
    card.className = 'page-card';
    card.draggable = true;
    card.dataset.pageIdx = pageIdx;
    card.dataset.displayPos = displayPos;

    const detectedClass = page.detected !== null ? 'found' : 'missing';
    const detectedText  = page.detected !== null ? `Detected: ${page.detected}` : 'No # found';

    card.innerHTML = `
      <div class="thumb-wrap">
        <img src="/thumbnail/${sessionId}/${pageIdx}" alt="Page ${pageIdx+1}"
             loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="thumb-placeholder" style="display:none">📄</div>
      </div>
      <div class="card-footer">
        <span class="pos-badge">#${displayPos + 1}</span>
        <span class="detected-num ${detectedClass}">${detectedText}</span>
      </div>
    `;

    // Drag events
    card.addEventListener('dragstart', onDragStart);
    card.addEventListener('dragover',  onDragOver);
    card.addEventListener('dragleave', onDragLeave);
    card.addEventListener('drop',      onDrop);
    card.addEventListener('dragend',   onDragEnd);

    pagesGrid.appendChild(card);
  });
}

// ── Drag & Drop ──────────────────────────────────────────────────────────────

let dragSrcPos = null;

function onDragStart(e) {
  dragSrcPos = parseInt(this.dataset.displayPos);
  this.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}
function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  this.classList.add('drag-over');
}
function onDragLeave() {
  this.classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  const destPos = parseInt(this.dataset.displayPos);
  if (dragSrcPos !== null && dragSrcPos !== destPos) {
    // Reorder currentOrder
    const moved = currentOrder.splice(dragSrcPos, 1)[0];
    currentOrder.splice(destPos, 0, moved);
    renderGrid();
    downloadSection.style.display = 'none'; // clear previous download on change
  }
  this.classList.remove('drag-over');
}
function onDragEnd() {
  document.querySelectorAll('.page-card').forEach(c => {
    c.classList.remove('dragging', 'drag-over');
  });
  dragSrcPos = null;
}

// ── Auto-sort ────────────────────────────────────────────────────────────────

function autoSort(silent = false) {
  const allDetected = pages.every(p => p.detected !== null);
  const sorted = [...currentOrder].sort((a, b) => {
    const da = pages[a].detected;
    const db = pages[b].detected;
    if (da === null && db === null) return a - b;
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });
  currentOrder = sorted;
  renderGrid();

  if (!silent) {
    const msg = allDetected
      ? 'Pages sorted by detected page numbers.'
      : 'Pages sorted by detected numbers; pages without numbers placed at end.';
    autoSortBanner.textContent = '✓ ' + msg;
    autoSortBanner.style.display = 'block';
  } else {
    autoSortBanner.textContent = '✓ All page numbers detected — pages automatically sorted.';
    autoSortBanner.style.display = 'block';
  }
  downloadSection.style.display = 'none';
}

autoSortBtn.addEventListener('click', () => autoSort(false));

// ── Reset ────────────────────────────────────────────────────────────────────

resetBtn.addEventListener('click', () => {
  currentOrder = pages.map(p => p.index);
  autoSortBanner.style.display = 'none';
  downloadSection.style.display = 'none';
  renderGrid();
});

// ── Apply reorder & download ──────────────────────────────────────────────────

reorderBtn.addEventListener('click', async () => {
  if (!sessionId) return;
  reorderBtn.disabled = true;
  reorderBtn.innerHTML = '<span class="spinner"></span> Processing…';

  let resp;
  try {
    resp = await fetch('/reorder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, order: currentOrder }),
    });
  } catch (err) {
    showStatus('Reorder failed: ' + err.message, 'error');
    reorderBtn.disabled = false;
    reorderBtn.textContent = 'Apply & Download';
    return;
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    showStatus('Reorder failed: ' + err.detail, 'error');
    reorderBtn.disabled = false;
    reorderBtn.innerHTML = 'Apply &amp; Download';
    return;
  }

  const data = await resp.json();
  downloadBtn.href = data.download_url;
  downloadBtn.download = data.filename;
  downloadSection.style.display = 'block';
  reorderBtn.disabled = false;
  reorderBtn.innerHTML = 'Apply &amp; Download';

  showStatus(`Reordered PDF ready: <strong>${data.filename}</strong>`, 'success');
  downloadSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

// ── New file ─────────────────────────────────────────────────────────────────

newFileBtn.addEventListener('click', () => {
  if (sessionId) {
    fetch(`/session/${sessionId}`, { method: 'DELETE' }).catch(() => {});
    sessionId = null;
  }
  pages = [];
  currentOrder = [];
  fileInput.value = '';
  statusBar.style.display = 'none';
  controls.style.display = 'none';
  pagesSection.style.display = 'none';
  downloadSection.style.display = 'none';
  autoSortBanner.style.display = 'none';
  pagesGrid.innerHTML = '';
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showStatus(html, type) {
  statusBar.innerHTML = html;
  statusBar.className = type;
  statusBar.style.display = 'block';
}
function hideSection(el) {
  el.style.display = 'none';
}
