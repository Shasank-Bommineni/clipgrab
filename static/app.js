/**
 * ClipGrab Studio Frontend Engine
 * Synchronized multi-tier scrubbers, YouTube preview player, and SSE live progress.
 */

// Application State
const state = {
  duration: 0,
  startSec: 0,
  endSec: 0,
  zoomSpan: 120, // ±60s
  zoomMin: 0,
  zoomMax: 120,
  zoomMode: 'both', // 'both' | 'start' | 'end'
  isDragging: false,
  activeHandle: 'start',
  mode: 'lossless',
  currentUrl: '',
  player: null,
  isPlayerReady: false,
  isPreviewLooping: false,
  loopTimer: null,
  activeJobs: {}
};

// DOM Elements
const elements = {
  hwBadge: document.getElementById('hwBadge'),
  btnUpdateYtdlp: document.getElementById('btnUpdateYtdlp'),
  urlInput: document.getElementById('urlInput'),
  btnFetch: document.getElementById('btnFetch'),
  btnFetchText: document.getElementById('btnFetchText'),
  errorBanner: document.getElementById('errorBanner'),
  workspace: document.getElementById('workspace'),
  videoTitle: document.getElementById('videoTitle'),
  videoMeta: document.getElementById('videoMeta'),
  btnPreviewLoop: document.getElementById('btnPreviewLoop'),
  selectionDurationBadge: document.getElementById('selectionDurationBadge'),
  
  // Macro Slider
  macroStart: document.getElementById('macroStart'),
  macroEnd: document.getElementById('macroEnd'),
  macroHighlight: document.getElementById('macroHighlight'),
  macroTrackWrap: document.getElementById('macroTrackWrap'),
  
  // Zoom Slider
  zoomStart: document.getElementById('zoomStart'),
  zoomEnd: document.getElementById('zoomEnd'),
  zoomHighlight: document.getElementById('zoomHighlight'),
  zoomWindowLabel: document.getElementById('zoomWindowLabel'),
  zoomTrackWrap: document.getElementById('zoomTrackWrap'),
  btnFocusStart: document.getElementById('btnFocusStart'),
  btnFocusEnd: document.getElementById('btnFocusEnd'),

  // HMS Inputs
  startH: document.getElementById('startH'),
  startM: document.getElementById('startM'),
  startS: document.getElementById('startS'),
  startMs: document.getElementById('startMs'),
  endH: document.getElementById('endH'),
  endM: document.getElementById('endM'),
  endS: document.getElementById('endS'),
  endMs: document.getElementById('endMs'),

  // Export
  qualitySelect: document.getElementById('qualitySelect'),
  filenameInput: document.getElementById('filenameInput'),
  modeLossless: document.getElementById('modeLossless'),
  modeEditReady: document.getElementById('modeEditReady'),
  btnDownload: document.getElementById('btnDownload'),

  // Queue
  jobsContainer: document.getElementById('jobsContainer'),
  emptyQueueMsg: document.getElementById('emptyQueueMsg'),
  btnOpenDownloads: document.getElementById('btnOpenDownloads')
};

// Utilities
function formatTime(seconds, includeMs = false) {
  const totalMs = Math.round(seconds * 1000);
  const h = Math.floor(totalMs / 3600000);
  const m = Math.floor((totalMs % 3600000) / 60000);
  const s = Math.floor((totalMs % 60000) / 1000);
  const ms = Math.floor((totalMs % 1000) / 10);

  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const mss = String(ms).padStart(2, '0');

  if (includeMs) {
    return `${hh}:${mm}:${ss}.${mss}`;
  }
  return `${hh}:${mm}:${ss}`;
}

function parseYouTubeId(url) {
  const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = url.match(regExp);
  return (match && match[2].length === 11) ? match[2] : null;
}

// Initialize YouTube Iframe Player
function initPlayer(videoId) {
  if (state.player && typeof state.player.destroy === 'function') {
    state.player.destroy();
  }

  state.player = new YT.Player('player', {
    videoId: videoId,
    playerVars: {
      playsinline: 1,
      modestbranding: 1,
      rel: 0,
      enablejsapi: 1
    },
    events: {
      onReady: () => {
        state.isPlayerReady = true;
        seekPlayer(state.startSec);
      }
    }
  });
}

function seekPlayer(sec) {
  if (state.player && state.isPlayerReady && typeof state.player.seekTo === 'function') {
    state.player.seekTo(sec, true);
  }
}

// Scrubber Sync Engine
function calculateZoomWindow() {
  const d = state.duration || 1;
  const span = Math.min(d, state.zoomSpan);
  const diff = Math.max(0, state.endSec - state.startSec);

  if (diff <= span) {
    // Both cut points fit inside the precision zoom window
    const mid = (state.startSec + state.endSec) / 2;
    let zMin = Math.max(0, mid - span / 2);
    let zMax = Math.min(d, zMin + span);
    if (zMax - zMin < span && zMin > 0) {
      zMin = Math.max(0, zMax - span);
    }
    state.zoomMin = Math.round(zMin * 100) / 100;
    state.zoomMax = Math.round(zMax * 100) / 100;
    state.zoomMode = 'both';
  } else {
    // Cut points are far apart, center zoom on active handle
    const focus = state.activeHandle === 'start' ? state.startSec : state.endSec;
    let zMin = Math.max(0, focus - span / 2);
    let zMax = Math.min(d, zMin + span);
    if (zMax - zMin < span && zMin > 0) {
      zMin = Math.max(0, zMax - span);
    }
    state.zoomMin = Math.round(zMin * 100) / 100;
    state.zoomMax = Math.round(zMax * 100) / 100;
    state.zoomMode = state.activeHandle;
  }
}

function updateAllViews(recenterZoom = false) {
  const d = state.duration || 1;

  // 1. Update Macro Slider
  elements.macroStart.max = d;
  elements.macroEnd.max = d;
  elements.macroStart.value = state.startSec;
  elements.macroEnd.value = state.endSec;

  const leftPct = (state.startSec / d) * 100;
  const widthPct = Math.max(0, ((state.endSec - state.startSec) / d) * 100);
  elements.macroHighlight.style.left = `${leftPct}%`;
  elements.macroHighlight.style.width = `${widthPct}%`;

  // Macro Z-index: give the active handle top layer
  if (state.activeHandle === 'start') {
    elements.macroStart.style.zIndex = '6';
    elements.macroEnd.style.zIndex = '5';
  } else {
    elements.macroStart.style.zIndex = '5';
    elements.macroEnd.style.zIndex = '6';
  }

  // 2. Update Zoom Window
  if (recenterZoom || state.zoomMax === 0 || state.zoomMin >= state.zoomMax) {
    calculateZoomWindow();
  }

  const zMin = state.zoomMin;
  const zMax = state.zoomMax;
  const zSpan = Math.max(0.1, zMax - zMin);

  elements.zoomStart.min = zMin;
  elements.zoomStart.max = zMax;
  elements.zoomEnd.min = zMin;
  elements.zoomEnd.max = zMax;

  // Handle visibility and highlight bar positioning in zoom window
  if (state.zoomMode === 'both') {
    elements.zoomStart.style.display = 'block';
    elements.zoomEnd.style.display = 'block';
    elements.zoomStart.value = state.startSec;
    elements.zoomEnd.value = state.endSec;

    if (state.activeHandle === 'start') {
      elements.zoomStart.style.zIndex = '6';
      elements.zoomEnd.style.zIndex = '5';
    } else {
      elements.zoomStart.style.zIndex = '5';
      elements.zoomEnd.style.zIndex = '6';
    }

    const zLeft = Math.max(0, ((state.startSec - zMin) / zSpan) * 100);
    const zRight = Math.min(100, ((state.endSec - zMin) / zSpan) * 100);
    elements.zoomHighlight.style.left = `${zLeft}%`;
    elements.zoomHighlight.style.width = `${Math.max(0, zRight - zLeft)}%`;

    elements.zoomWindowLabel.textContent = `Zoom: ${formatTime(zMin)} - ${formatTime(zMax)} (Full Cut)`;
  } else if (state.zoomMode === 'start') {
    elements.zoomStart.style.display = 'block';
    elements.zoomStart.value = Math.max(zMin, Math.min(zMax, state.startSec));
    elements.zoomStart.style.zIndex = '6';

    if (state.endSec <= zMax) {
      elements.zoomEnd.style.display = 'block';
      elements.zoomEnd.value = state.endSec;
      elements.zoomEnd.style.zIndex = '5';
      const zLeft = Math.max(0, ((state.startSec - zMin) / zSpan) * 100);
      const zRight = Math.min(100, ((state.endSec - zMin) / zSpan) * 100);
      elements.zoomHighlight.style.left = `${zLeft}%`;
      elements.zoomHighlight.style.width = `${Math.max(0, zRight - zLeft)}%`;
    } else {
      elements.zoomEnd.style.display = 'none';
      const zLeft = Math.max(0, ((state.startSec - zMin) / zSpan) * 100);
      elements.zoomHighlight.style.left = `${zLeft}%`;
      elements.zoomHighlight.style.width = `${100 - zLeft}%`;
    }

    elements.zoomWindowLabel.textContent = `Zoom: ${formatTime(zMin)} - ${formatTime(zMax)} (Start Cut)`;
  } else {
    elements.zoomEnd.style.display = 'block';
    elements.zoomEnd.value = Math.max(zMin, Math.min(zMax, state.endSec));
    elements.zoomEnd.style.zIndex = '6';

    if (state.startSec >= zMin) {
      elements.zoomStart.style.display = 'block';
      elements.zoomStart.value = state.startSec;
      elements.zoomStart.style.zIndex = '5';
      const zLeft = Math.max(0, ((state.startSec - zMin) / zSpan) * 100);
      const zRight = Math.min(100, ((state.endSec - zMin) / zSpan) * 100);
      elements.zoomHighlight.style.left = `${zLeft}%`;
      elements.zoomHighlight.style.width = `${Math.max(0, zRight - zLeft)}%`;
    } else {
      elements.zoomStart.style.display = 'none';
      const zRight = Math.min(100, ((state.endSec - zMin) / zSpan) * 100);
      elements.zoomHighlight.style.left = '0%';
      elements.zoomHighlight.style.width = `${zRight}%`;
    }

    elements.zoomWindowLabel.textContent = `Zoom: ${formatTime(zMin)} - ${formatTime(zMax)} (End Cut)`;
  }

  // Update Focus Pills in Zoom Header
  if (elements.btnFocusStart && elements.btnFocusEnd) {
    if (state.activeHandle === 'start') {
      elements.btnFocusStart.classList.add('active');
      elements.btnFocusEnd.classList.remove('active');
    } else {
      elements.btnFocusEnd.classList.add('active');
      elements.btnFocusStart.classList.remove('active');
    }
  }

  // 3. Update HMS Inputs
  const sTotalMs = Math.round(state.startSec * 1000);
  elements.startH.value = String(Math.floor(sTotalMs / 3600000)).padStart(2, '0');
  elements.startM.value = String(Math.floor((sTotalMs % 3600000) / 60000)).padStart(2, '0');
  elements.startS.value = String(Math.floor((sTotalMs % 60000) / 1000)).padStart(2, '0');
  elements.startMs.value = String(Math.floor((sTotalMs % 1000) / 10)).padStart(2, '0');

  const eTotalMs = Math.round(state.endSec * 1000);
  elements.endH.value = String(Math.floor(eTotalMs / 3600000)).padStart(2, '0');
  elements.endM.value = String(Math.floor((eTotalMs % 3600000) / 60000)).padStart(2, '0');
  elements.endS.value = String(Math.floor((eTotalMs % 60000) / 1000)).padStart(2, '0');
  elements.endMs.value = String(Math.floor((eTotalMs % 1000) / 10)).padStart(2, '0');

  // 4. Update Selection Duration
  const clipDuration = Math.max(0, state.endSec - state.startSec);
  elements.selectionDurationBadge.textContent = `Selected: ${formatTime(clipDuration, true)}`;
}

function setTimes(start, end, active = 'start', seek = true, isDragging = false) {
  let s = Math.max(0, Math.min(start, state.duration - 0.1));
  let e = Math.min(state.duration, Math.max(end, s + 0.1));

  if (s >= e) {
    if (active === 'start') {
      s = Math.max(0, e - 0.1);
    } else {
      e = Math.min(state.duration, s + 0.1);
    }
  }

  state.startSec = Math.round(s * 100) / 100;
  state.endSec = Math.round(e * 100) / 100;
  state.activeHandle = active;

  // While dragging, do not re-center the zoom window so coordinates remain fixed
  const recenter = !isDragging;
  updateAllViews(recenter);

  if (seek) {
    seekPlayer(active === 'start' ? state.startSec : state.endSec);
  }
}

// Event Listeners for Macro Slider
elements.macroStart.addEventListener('pointerdown', () => {
  state.isDragging = true;
  state.activeHandle = 'start';
  updateAllViews(false);
});
elements.macroStart.addEventListener('input', (e) => {
  setTimes(parseFloat(e.target.value), state.endSec, 'start', true, true);
});
elements.macroStart.addEventListener('change', () => {
  state.isDragging = false;
  updateAllViews(true);
});
elements.macroStart.addEventListener('pointerup', () => {
  state.isDragging = false;
  updateAllViews(true);
});

elements.macroEnd.addEventListener('pointerdown', () => {
  state.isDragging = true;
  state.activeHandle = 'end';
  updateAllViews(false);
});
elements.macroEnd.addEventListener('input', (e) => {
  setTimes(state.startSec, parseFloat(e.target.value), 'end', true, true);
});
elements.macroEnd.addEventListener('change', () => {
  state.isDragging = false;
  updateAllViews(true);
});
elements.macroEnd.addEventListener('pointerup', () => {
  state.isDragging = false;
  updateAllViews(true);
});

// Event Listeners for Zoom Slider
elements.zoomStart.addEventListener('pointerdown', () => {
  state.isDragging = true;
  state.activeHandle = 'start';
  updateAllViews(false);
});
elements.zoomStart.addEventListener('input', (e) => {
  setTimes(parseFloat(e.target.value), state.endSec, 'start', true, true);
});
elements.zoomStart.addEventListener('change', () => {
  state.isDragging = false;
  updateAllViews(true);
});
elements.zoomStart.addEventListener('pointerup', () => {
  state.isDragging = false;
  updateAllViews(true);
});

elements.zoomEnd.addEventListener('pointerdown', () => {
  state.isDragging = true;
  state.activeHandle = 'end';
  updateAllViews(false);
});
elements.zoomEnd.addEventListener('input', (e) => {
  setTimes(state.startSec, parseFloat(e.target.value), 'end', true, true);
});
elements.zoomEnd.addEventListener('change', () => {
  state.isDragging = false;
  updateAllViews(true);
});
elements.zoomEnd.addEventListener('pointerup', () => {
  state.isDragging = false;
  updateAllViews(true);
});

// Focus Switcher Buttons
if (elements.btnFocusStart) {
  elements.btnFocusStart.addEventListener('click', () => {
    state.activeHandle = 'start';
    updateAllViews(true);
    seekPlayer(state.startSec);
  });
}
if (elements.btnFocusEnd) {
  elements.btnFocusEnd.addEventListener('click', () => {
    state.activeHandle = 'end';
    updateAllViews(true);
    seekPlayer(state.endSec);
  });
}

// Track Clicking to Seek / Position
if (elements.macroTrackWrap) {
  elements.macroTrackWrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('range-input')) return;
    const rect = elements.macroTrackWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = pct * state.duration;
    const distToStart = Math.abs(targetSec - state.startSec);
    const distToEnd = Math.abs(targetSec - state.endSec);
    if (distToStart <= distToEnd) {
      setTimes(targetSec, state.endSec, 'start', true, false);
    } else {
      setTimes(state.startSec, targetSec, 'end', true, false);
    }
  });
}

if (elements.zoomTrackWrap) {
  elements.zoomTrackWrap.addEventListener('click', (e) => {
    if (e.target.classList.contains('range-input')) return;
    const rect = elements.zoomTrackWrap.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetSec = state.zoomMin + pct * (state.zoomMax - state.zoomMin);
    if (state.activeHandle === 'start') {
      setTimes(targetSec, state.endSec, 'start', true, false);
    } else {
      setTimes(state.startSec, targetSec, 'end', true, false);
    }
  });
}

// Nudge Buttons Listener
document.querySelectorAll('.btn-nudge').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const delta = parseFloat(btn.dataset.delta);
    if (target === 'start') {
      setTimes(state.startSec + delta, state.endSec, 'start');
    } else {
      setTimes(state.startSec, state.endSec + delta, 'end');
    }
  });
});

// HMS Input Handlers
function readHms(hEl, mEl, sEl, msEl) {
  const h = parseInt(hEl.value || 0, 10) || 0;
  const m = parseInt(mEl.value || 0, 10) || 0;
  const s = parseInt(sEl.value || 0, 10) || 0;
  const ms = parseInt(msEl.value || 0, 10) || 0;
  return (h * 3600) + (m * 60) + s + (ms / 100);
}

function handleHmsChange(target) {
  if (target === 'start') {
    const val = readHms(elements.startH, elements.startM, elements.startS, elements.startMs);
    setTimes(val, state.endSec, 'start');
  } else {
    const val = readHms(elements.endH, elements.endM, elements.endS, elements.endMs);
    setTimes(state.startSec, val, 'end');
  }
}

[elements.startH, elements.startM, elements.startS, elements.startMs].forEach(el => {
  el.addEventListener('change', () => handleHmsChange('start'));
});
[elements.endH, elements.endM, elements.endS, elements.endMs].forEach(el => {
  el.addEventListener('change', () => handleHmsChange('end'));
});

// Preview Loop Functionality
elements.btnPreviewLoop.addEventListener('click', () => {
  if (!state.player || !state.isPlayerReady) return;

  if (state.isPreviewLooping) {
    clearInterval(state.loopTimer);
    state.isPreviewLooping = false;
    state.player.pauseVideo();
    elements.btnPreviewLoop.textContent = 'Preview Selection';
  } else {
    state.isPreviewLooping = true;
    elements.btnPreviewLoop.textContent = 'Stop Preview';
    seekPlayer(state.startSec);
    state.player.playVideo();

    state.loopTimer = setInterval(() => {
      if (!state.isPreviewLooping) return;
      const curr = state.player.getCurrentTime();
      if (curr >= state.endSec || curr < state.startSec - 1) {
        seekPlayer(state.startSec);
      }
    }, 150);
  }
});

// Mode Toggle Handler
function setMode(mode) {
  state.mode = mode;
  if (mode === 'lossless') {
    elements.modeLossless.classList.add('selected');
    elements.modeEditReady.classList.remove('selected');
  } else {
    elements.modeLossless.classList.remove('selected');
    elements.modeEditReady.classList.add('selected');
  }
}

elements.modeLossless.addEventListener('click', () => setMode('lossless'));
elements.modeEditReady.addEventListener('click', () => setMode('edit_ready'));

// Load Video URL
async function fetchVideo() {
  const url = elements.urlInput.value.trim();
  if (!url) return;

  elements.errorBanner.style.display = 'none';
  elements.btnFetch.disabled = true;
  elements.btnFetchText.textContent = 'Loading...';

  try {
    const res = await fetch(`/api/info?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Failed to load video metadata');
    }

    const data = await res.json();
    state.currentUrl = url;
    state.duration = data.duration;
    state.startSec = 0;
    state.endSec = Math.min(60, data.duration);

    elements.videoTitle.textContent = data.title;
    elements.videoMeta.textContent = `${data.channel} • Duration: ${formatTime(data.duration)}`;
    elements.filenameInput.placeholder = data.clean_title;

    // Populate Quality Dropdown
    elements.qualitySelect.innerHTML = '';
    const heights = data.available_heights || [1440, 1080, 720];
    heights.forEach(h => {
      const opt = document.createElement('option');
      opt.value = String(h);
      let label = `${h}p`;
      if (h === 2160) label += ' (4K UHD)';
      else if (h === 1440) label += ' (2.5K QHD - Best)';
      else if (h === 1080) label += ' (FHD)';
      else if (h === 720) label += ' (HD)';
      opt.textContent = label;
      elements.qualitySelect.appendChild(opt);
    });

    const bestOpt = document.createElement('option');
    bestOpt.value = 'best';
    bestOpt.textContent = 'Maximum Available Stream';
    elements.qualitySelect.appendChild(bestOpt);

    elements.qualitySelect.value = data.default_quality || '1440';

    // Show workspace
    elements.workspace.style.display = 'grid';
    updateAllViews(true);

    // Init YouTube Player
    const videoId = data.id || parseYouTubeId(url);
    if (videoId) {
      initPlayer(videoId);
    }
  } catch (err) {
    elements.errorBanner.textContent = `Error: ${err.message}`;
    elements.errorBanner.style.display = 'block';
  } finally {
    elements.btnFetch.disabled = false;
    elements.btnFetchText.textContent = 'Load Video';
  }
}

elements.btnFetch.addEventListener('click', fetchVideo);
elements.urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchVideo();
});

// Download Submission & SSE Streaming
async function submitDownload() {
  if (!state.currentUrl) return;

  elements.btnDownload.disabled = true;
  elements.btnDownload.textContent = 'Enqueueing Clip...';

  try {
    const payload = {
      url: state.currentUrl,
      start: state.startSec,
      end: state.endSec,
      quality: elements.qualitySelect.value,
      mode: state.mode,
      custom_filename: elements.filenameInput.value.trim() || null
    };

    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Download submission failed');
    }

    const { job_id } = await res.json();
    createJobCard(job_id, payload.custom_filename || elements.videoTitle.textContent, state.startSec, state.endSec, state.mode);
    connectSse(job_id);
  } catch (err) {
    alert(`Failed to start clip: ${err.message}`);
  } finally {
    elements.btnDownload.disabled = false;
    elements.btnDownload.textContent = 'Cut & Save Clip';
  }
}

elements.btnDownload.addEventListener('click', submitDownload);

// UI Job Card & SSE Stream
function createJobCard(jobId, title, start, end, mode) {
  elements.emptyQueueMsg.style.display = 'none';

  const card = document.createElement('div');
  card.id = `job-${jobId}`;
  card.className = 'job-item';
  card.innerHTML = `
    <div class="job-header">
      <span class="job-title">${title}</span>
      <span id="job-status-${jobId}" class="job-status-pill status-downloading">Downloading</span>
    </div>
    <div class="job-meta-row">
      <span>Cut: ${formatTime(start)} → ${formatTime(end)} (${formatTime(end - start)})</span>
      <span id="job-speed-${jobId}">Connecting...</span>
    </div>
    <div class="progress-bar-bg">
      <div id="job-bar-${jobId}" class="progress-bar-fill" style="width: 5%;"></div>
    </div>
    <div id="job-msg-${jobId}" style="font-size: 0.8rem; color: var(--text-muted);">Starting segment download...</div>
    <div id="job-probe-${jobId}" style="display: none;"></div>
    <div id="job-actions-${jobId}" style="display: none; margin-top: 6px;"></div>
  `;

  elements.jobsContainer.prepend(card);
}

function connectSse(jobId) {
  const eventSource = new EventSource(`/api/progress/${jobId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateJobCard(data);

      if (data.status === 'completed' || data.status === 'error') {
        eventSource.close();
      }
    } catch (e) {
      console.error('SSE JSON parse error', e);
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
  };
}

function updateJobCard(data) {
  const jobId = data.job_id;
  const bar = document.getElementById(`job-bar-${jobId}`);
  const statusPill = document.getElementById(`job-status-${jobId}`);
  const speedEl = document.getElementById(`job-speed-${jobId}`);
  const msgEl = document.getElementById(`job-msg-${jobId}`);
  const probeEl = document.getElementById(`job-probe-${jobId}`);
  const actionsEl = document.getElementById(`job-actions-${jobId}`);

  if (!bar) return;

  bar.style.width = `${data.percent}%`;
  msgEl.textContent = data.message || '';

  if (data.status === 'downloading') {
    statusPill.className = 'job-status-pill status-downloading';
    statusPill.textContent = 'Downloading';
    speedEl.textContent = `${data.speed || ''} ${data.eta ? `(ETA: ${data.eta})` : ''}`;
  } else if (data.status === 'transcoding') {
    statusPill.className = 'job-status-pill status-transcoding';
    statusPill.textContent = 'GPU Transcode';
    speedEl.textContent = 'H.264 Conversion';
  } else if (data.status === 'completed') {
    statusPill.className = 'job-status-pill status-completed';
    statusPill.textContent = 'Ready';
    speedEl.textContent = 'Finished';

    // Show Quality Probe Badge
    if (data.probe && !data.probe.error) {
      const p = data.probe;
      probeEl.className = 'probe-badge';
      probeEl.innerHTML = `
        <span>Resolution: <strong>${p.width}x${p.height}</strong></span>
        <span>Codec: <strong>${p.video_codec.toUpperCase()}</strong></span>
        <span>FPS: <strong>${p.fps}</strong></span>
        <span>Audio: <strong>${p.audio_codec.toUpperCase()} (${p.audio_sample_rate}Hz)</strong></span>
        <span>Size: <strong>${p.size_mb} MB</strong></span>
        <span>Duration: <strong>${p.duration}s</strong></span>
      `;
      probeEl.style.display = 'flex';
    }

    // Show Actions
    actionsEl.innerHTML = `
      <button class="btn-open-folder" onclick="openClipFolder('${data.file_path.replace(/\\/g, '\\\\')}')">
        Show in Folder
      </button>
    `;
    actionsEl.style.display = 'block';
  } else if (data.status === 'error') {
    statusPill.className = 'job-status-pill status-error';
    statusPill.textContent = 'Error';
    speedEl.textContent = 'Failed';
    msgEl.textContent = data.error || 'Download failed';
  }
}

// Global folder reveal handler
window.openClipFolder = async function(filePath) {
  try {
    await fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_path: filePath })
    });
  } catch (err) {
    alert(`Could not open folder: ${err.message}`);
  }
};

elements.btnOpenDownloads.addEventListener('click', () => {
  window.openClipFolder();
});

// Update yt-dlp Button
elements.btnUpdateYtdlp.addEventListener('click', async () => {
  elements.btnUpdateYtdlp.disabled = true;
  elements.btnUpdateYtdlp.textContent = 'Updating...';

  try {
    const res = await fetch('/api/update-ytdlp', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      alert(`yt-dlp is now updated to the latest version!\n\nCurrent Version: ${data.current_version}`);
    } else {
      alert(`Update completed with status:\n${data.output}`);
    }
  } catch (err) {
    alert(`Update failed: ${err.message}`);
  } finally {
    elements.btnUpdateYtdlp.disabled = false;
    elements.btnUpdateYtdlp.textContent = 'Update yt-dlp';
  }
});

// Initial System Diagnostics Probe
async function initSystemProbe() {
  try {
    const res = await fetch('/api/system');
    const data = await res.json();
    if (data.encoder_name) {
      elements.hwBadge.innerHTML = `<span>Hardware: <strong>${data.encoder_name}</strong></span>`;
    }
    const footerInfo = document.getElementById('footerSystemInfo');
    if (footerInfo && data.ffmpeg_version) {
      footerInfo.textContent = `FFmpeg: ${data.ffmpeg_version.split(' ')[2]} • Python: ${data.python_version} • yt-dlp: ${data.ytdlp_version}`;
    }
  } catch (e) {
    elements.hwBadge.innerHTML = '<span>Hardware: Ready</span>';
  }
}

// Run on page load
initSystemProbe();
