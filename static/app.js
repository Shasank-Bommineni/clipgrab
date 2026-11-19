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
  autoUpdateBadge: document.getElementById('autoUpdateBadge'),
  autoUpdateText: document.getElementById('autoUpdateText'),
  btnCheckUpdate: document.getElementById('btnCheckUpdate'),
  btnClearFinished: document.getElementById('btnClearFinished'),
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
    const heights = data.available_heights || [4320, 2160, 1440, 1080, 720];
    heights.forEach(h => {
      const opt = document.createElement('option');
      opt.value = String(h);
      let label = `${h}p`;
      if (h === 4320) label += ' (8K UHD)';
      else if (h === 2160) label += ' (4K UHD)';
      else if (h === 1440) label += ' (2.5K QHD)';
      else if (h === 1080) label += ' (FHD)';
      else if (h === 720) label += ' (HD)';
      opt.textContent = label;
      elements.qualitySelect.appendChild(opt);
    });

    const bestOpt = document.createElement('option');
    bestOpt.value = 'best';
    bestOpt.textContent = 'Maximum Available Stream';
    elements.qualitySelect.appendChild(bestOpt);

    elements.qualitySelect.value = data.default_quality || (data.has_4320p ? '4320' : (data.has_2160p ? '2160' : (data.has_1440p ? '1440' : '1080')));

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
      title: elements.videoTitle.textContent || null,
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
function checkEmptyQueue() {
  const cards = elements.jobsContainer.querySelectorAll('.job-item');
  if (cards.length === 0) {
    elements.emptyQueueMsg.style.display = 'block';
    if (elements.btnClearFinished) elements.btnClearFinished.style.display = 'none';
  } else {
    elements.emptyQueueMsg.style.display = 'none';
    const finishedCount = elements.jobsContainer.querySelectorAll('.status-completed, .status-cancelled, .status-error').length;
    if (elements.btnClearFinished) {
      elements.btnClearFinished.style.display = finishedCount > 0 ? 'inline-block' : 'none';
    }
  }
}

function createJobCard(jobId, title, start, end, mode) {
  elements.emptyQueueMsg.style.display = 'none';

  const card = document.createElement('div');
  card.id = `job-${jobId}`;
  card.className = 'job-item';
  card.innerHTML = `
    <div class="job-header">
      <span class="job-title">${title}</span>
      <div class="job-header-right">
        <span id="job-status-${jobId}" class="job-status-pill status-downloading">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          <span>Downloading</span>
        </span>
        <button type="button" id="job-btn-cancel-${jobId}" class="btn-cancel-job-icon" onclick="cancelJob('${jobId}')" title="Stop & Cancel Download" aria-label="Cancel">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
    <div class="job-meta-row">
      <span>Cut: ${formatTime(start)} → ${formatTime(end)} (${formatTime(end - start)})</span>
      <div class="job-stats-group">
        <span id="job-pct-${jobId}" class="job-stat-pct">0%</span>
        <span id="job-speed-${jobId}" class="job-stat-speed">Connecting...</span>
        <span id="job-eta-${jobId}" class="job-stat-eta" style="display: none;"></span>
      </div>
    </div>
    <div class="progress-bar-bg">
      <div id="job-bar-${jobId}" class="progress-bar-fill" style="width: 5%;"></div>
    </div>
    <div id="job-msg-${jobId}" style="font-size: 0.8rem; color: var(--text-muted);">Starting stream extraction...</div>
    <div id="job-probe-${jobId}" style="display: none;"></div>
    <div id="job-actions-${jobId}" style="display: none; margin-top: 8px;"></div>
  `;

  elements.jobsContainer.prepend(card);
  checkEmptyQueue();
}

function connectSse(jobId) {
  const eventSource = new EventSource(`/api/progress/${jobId}`);

  eventSource.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      updateJobCard(data);

      if (data.status === 'completed' || data.status === 'error' || data.status === 'cancelled') {
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
  const pctEl = document.getElementById(`job-pct-${jobId}`);
  const speedEl = document.getElementById(`job-speed-${jobId}`);
  const etaEl = document.getElementById(`job-eta-${jobId}`);
  const msgEl = document.getElementById(`job-msg-${jobId}`);
  const probeEl = document.getElementById(`job-probe-${jobId}`);
  const actionsEl = document.getElementById(`job-actions-${jobId}`);
  const cancelBtn = document.getElementById(`job-btn-cancel-${jobId}`);

  if (!bar) return;

  bar.style.width = `${data.percent}%`;
  msgEl.textContent = data.message || '';
  if (pctEl) pctEl.textContent = `${data.percent || 0}%`;

  if (data.status === 'downloading') {
    statusPill.className = 'job-status-pill status-downloading';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
        <polyline points="7 10 12 15 17 10"></polyline>
        <line x1="12" y1="15" x2="12" y2="3"></line>
      </svg>
      <span>Downloading</span>
    `;
    if (speedEl) speedEl.textContent = data.speed || 'Connecting...';
    if (etaEl) {
      if (data.eta) {
        etaEl.textContent = `ETA: ${data.eta}`;
        etaEl.style.display = 'inline';
      } else {
        etaEl.style.display = 'none';
      }
    }
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  } else if (data.status === 'transcoding') {
    statusPill.className = 'job-status-pill status-transcoding';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      <span>Transcoding</span>
    `;
    if (speedEl) speedEl.textContent = data.speed || 'GPU Accelerated';
    if (etaEl) etaEl.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'inline-flex';
  } else if (data.status === 'cancelled') {
    statusPill.className = 'job-status-pill status-cancelled';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
      <span>Cancelled</span>
    `;
    if (speedEl) speedEl.textContent = 'Stopped';
    if (etaEl) etaEl.style.display = 'none';
    if (pctEl) pctEl.textContent = '0%';
    msgEl.textContent = 'Download cancelled by user';
    bar.style.width = '0%';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Show Dismiss Action
    actionsEl.innerHTML = `
      <div class="job-actions-row">
        <button class="btn-dismiss-job" onclick="dismissJob('${jobId}')">Dismiss</button>
      </div>
    `;
    actionsEl.style.display = 'block';
  } else if (data.status === 'completed') {
    statusPill.className = 'job-status-pill status-completed';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Ready</span>
    `;
    if (speedEl) speedEl.textContent = 'Finished';
    if (etaEl) etaEl.style.display = 'none';
    if (pctEl) pctEl.textContent = '100%';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Show Quality Probe Badge with True 8K / 4K / 2.5K Labeling
    if (data.probe && !data.probe.error) {
      const p = data.probe;
      const is8K = (p.height && p.height >= 4320) || (p.width && p.width >= 7680);
      const is4K = !is8K && ((p.height && p.height >= 2160) || (p.width && p.width >= 3840));
      const is25K = !is8K && !is4K && ((p.height && p.height >= 1440) || (p.width && p.width >= 2560));
      const resLabel = is8K ? '8K UHD' : (is4K ? '4K UHD' : (is25K ? '2.5K QHD' : `${p.height || 'HD'}p`));

      probeEl.className = 'probe-badge';
      probeEl.innerHTML = `
        <span>Resolution: <strong>${resLabel} (${p.width}x${p.height})</strong></span>
        <span>Codec: <strong>${p.video_codec.toUpperCase()}</strong></span>
        <span>FPS: <strong>${p.fps}</strong></span>
        <span>Bitrate: <strong>${p.bitrate_kbps ? `${(p.bitrate_kbps/1000).toFixed(1)} Mbps` : 'Direct Stream'}</strong></span>
        <span>Size: <strong>${p.size_mb} MB</strong></span>
      `;
      probeEl.style.display = 'flex';
    }

    // Show Actions
    actionsEl.innerHTML = `
      <div class="job-actions-row">
        <button class="btn-open-folder" onclick="openClipFolder('${data.file_path.replace(/\\/g, '\\\\')}')">
          Show in Folder
        </button>
        <button class="btn-dismiss-job" onclick="dismissJob('${jobId}')">Dismiss</button>
      </div>
    `;
    actionsEl.style.display = 'block';
  } else if (data.status === 'error') {
    statusPill.className = 'job-status-pill status-error';
    statusPill.innerHTML = `
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"></circle>
        <line x1="12" y1="8" x2="12" y2="12"></line>
        <line x1="12" y1="16" x2="12.01" y2="16"></line>
      </svg>
      <span>Error</span>
    `;
    if (speedEl) speedEl.textContent = 'Failed';
    if (etaEl) etaEl.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';

    // Show Dismiss Action
    actionsEl.innerHTML = `
      <div class="job-actions-row">
        <button class="btn-dismiss-job" onclick="dismissJob('${jobId}')">Dismiss</button>
      </div>
    `;
    actionsEl.style.display = 'block';
  }

  checkEmptyQueue();
}

// Stop / Cancel Job Handler
window.cancelJob = async function(jobId) {
  const btn = document.getElementById(`job-btn-cancel-${jobId}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Cancelling...';
  }
  try {
    const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Could not cancel job');
    }
  } catch (err) {
    alert(`Cancel failed: ${err.message}`);
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Cancel';
    }
  }
};

// Dismiss individual job from view
window.dismissJob = async function(jobId) {
  try {
    await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' });
  } catch (e) {
    // ignore
  }
  const el = document.getElementById(`job-${jobId}`);
  if (el) el.remove();
  checkEmptyQueue();
};

// Clear finished jobs handler
window.clearFinishedJobs = async function() {
  try {
    await fetch('/api/jobs/clear', { method: 'POST' });
  } catch (e) {
    // ignore
  }
  document.querySelectorAll('.job-item').forEach(card => {
    const isFinished = card.querySelector('.status-completed') || card.querySelector('.status-cancelled') || card.querySelector('.status-error');
    if (isFinished) card.remove();
  });
  checkEmptyQueue();
};

if (elements.btnClearFinished) {
  elements.btnClearFinished.addEventListener('click', window.clearFinishedJobs);
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

// Check Updates / Auto-Update Status
async function initAutoUpdateStatus() {
  try {
    const res = await fetch('/api/system/autoupdate');
    if (res.ok) {
      const data = await res.json();
      if (elements.autoUpdateText) {
        elements.autoUpdateText.textContent = `Auto-Update: Active (v${data.version})`;
      }
    }
  } catch (e) {
    if (elements.autoUpdateText) {
      elements.autoUpdateText.textContent = 'Auto-Update: Active';
    }
  }
}

if (elements.btnCheckUpdate) {
  elements.btnCheckUpdate.addEventListener('click', async () => {
    elements.btnCheckUpdate.disabled = true;
    elements.btnCheckUpdate.textContent = 'Checking...';

    try {
      const res = await fetch('/api/system/autoupdate/check', { method: 'POST' });
      const data = await res.json();
      if (elements.autoUpdateText) {
        elements.autoUpdateText.textContent = `Auto-Update: Active (v${data.version})`;
      }
      alert(`yt-dlp is up to date!\n\nCurrent Version: v${data.version}\nStatus: ${data.last_status}`);
    } catch (err) {
      alert(`Check failed: ${err.message}`);
    } finally {
      elements.btnCheckUpdate.disabled = false;
      elements.btnCheckUpdate.textContent = 'Check Updates';
    }
  });
}

// Initial System Diagnostics Probe
async function initSystemProbe() {
  try {
    const res = await fetch('/api/system');
    const data = await res.json();
    if (elements.hwBadge && data.encoder_name) {
      elements.hwBadge.innerHTML = `<span>Hardware: <strong>${data.encoder_name}</strong></span>`;
    }
  } catch (e) {
    if (elements.hwBadge) {
      elements.hwBadge.innerHTML = '<span>Hardware: Ready</span>';
    }
  }
}

// Run on page load
initSystemProbe();
initAutoUpdateStatus();
