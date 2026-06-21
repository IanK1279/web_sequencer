// ─── Constants ────────────────────────────────────────────────────────────────
// NUM_TRACKS: how many instrument rows exist in the grid (fixed at 4).
// LOOKAHEAD_INTERVAL_MS: how often (in ms) the scheduler function runs via setInterval.
// SCHEDULE_AHEAD_SECONDS: how far into the future the scheduler queues audio events.
//   Scheduling ahead gives the browser breathing room — if we only scheduled the
//   very next step, a slow JS frame could cause audio to drop out.
const NUM_TRACKS = 4;
let numSteps = 16;
const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.2;

// ─── Default Sounds ───────────────────────────────────────────────────────────
// Sounds to auto-load on launch. Each entry maps to a track by index.
// null means that track starts empty. Files are fetched relative to index.html.
const DEFAULT_SOUNDS = [
  { path: 'sounds/kick.wav', label: 'Kick' },
  { path: 'sounds/snare.wav', label: 'Snare' },
  { path: 'sounds/hh.wav', label: 'Hi-Hat' },
  null,
];

// ─── DOM References ───────────────────────────────────────────────────────────
// Grab all the HTML elements we need to read or update at runtime.
const playStopBtn = document.getElementById('playStopBtn');
const resetBtn = document.getElementById('resetBtn');
const bpmInput = document.getElementById('bpmInput');
const stepCountInput = document.getElementById('stepCountInput');
const sequencerGrid = document.getElementById('sequencerGrid');
const soundInputs = document.querySelectorAll('.sound-input');
const volumeInputs = document.querySelectorAll('.volume-input');

// ─── Audio State ──────────────────────────────────────────────────────────────
// audioContext: the Web Audio API entry point — all audio routing and timing goes
//   through this. Created lazily (on first play/file load) because browsers block
//   AudioContext creation before the user has interacted with the page.
// trackBuffers: holds the decoded audio data for each track. null = no file loaded.
// trackGains: one GainNode per track, used to control per-track volume.
let audioContext = null;
const trackBuffers = Array(NUM_TRACKS).fill(null);
const trackGains = Array(NUM_TRACKS).fill(null);

// ─── Sequencer State ──────────────────────────────────────────────────────────
// activeSteps: 2D array [track][step] → true if that cell is toggled on.
// currentStep: which step the sequencer is currently on (0-indexed).
// nextNoteTime: the Web Audio clock time (in seconds) when the next step should fire.
//   This uses audioContext.currentTime, which is a high-precision hardware clock —
//   much more accurate than Date.now() or setTimeout for audio scheduling.
// scheduledHighlightTimeouts: tracks pending setTimeout IDs so we can cancel them
//   when the sequencer stops, and prune them as they fire to prevent the array growing.
let activeSteps = Array.from({ length: NUM_TRACKS }, () => Array(numSteps).fill(false));
let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerId = null;
const scheduledHighlightTimeouts = [];

// ─── AudioContext Factory ─────────────────────────────────────────────────────
// Creates the AudioContext and one GainNode per track on first call, then returns
// the same instance every time after that. GainNodes sit between each track's
// audio source and the speakers, letting us scale volume independently per track.
function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < NUM_TRACKS; i += 1) {
      trackGains[i] = audioContext.createGain();
      trackGains[i].connect(audioContext.destination);
    }
  }
  return audioContext;
}

// ─── Grid Builder ─────────────────────────────────────────────────────────────
// Populates the sequencer grid with one row per step. Each row contains a step
// number label followed by one button per track. Buttons are pre-marked active
// if activeSteps already has them toggled (important after a step-count change
// where we preserve the existing pattern).
function createGrid() {
  for (let stepIndex = 0; stepIndex < numSteps; stepIndex += 1) {
    const stepNumberCell = document.createElement('div');
    stepNumberCell.className = 'step-label';
    stepNumberCell.textContent = String(stepIndex + 1).padStart(2, '0');
    stepNumberCell.dataset.step = stepIndex;
    sequencerGrid.appendChild(stepNumberCell);

    for (let trackIndex = 0; trackIndex < NUM_TRACKS; trackIndex += 1) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'step-button';
      button.dataset.track = String(trackIndex);
      button.dataset.step = String(stepIndex);
      if (activeSteps[trackIndex][stepIndex]) {
        button.classList.add('active');
      }
      button.addEventListener('click', () => toggleStep(trackIndex, stepIndex, button));
      sequencerGrid.appendChild(button);
    }
  }
}

// Flips the active state of one cell and keeps the button's CSS class in sync.
function toggleStep(track, step, button) {
  activeSteps[track][step] = !activeSteps[track][step];
  button.classList.toggle('active', activeSteps[track][step]);
}

// ─── Audio File Loading ───────────────────────────────────────────────────────
// decodeAudioData converts raw file bytes into a floating-point AudioBuffer that
// the Web Audio API can play back. This must happen before playback, and is async
// because decoding can take a moment for large files.
function loadTrackBuffer(arrayBuffer) {
  return getAudioContext().decodeAudioData(arrayBuffer);
}

// Looks up the track label element within the same .track-column as the file input.
// Used to show load/error status without hardcoding DOM structure assumptions.
function getTrackLabel(input) {
  return input.closest('.track-column')?.querySelector('.track-label');
}

// Auto-loads default sounds from the sounds/ folder on launch using fetch.
// Each track's label is updated to show the sound name. If a fetch fails (e.g.
// running from file:// instead of a local server), the track silently stays empty.
async function loadDefaultSounds() {
  for (let trackIndex = 0; trackIndex < DEFAULT_SOUNDS.length; trackIndex += 1) {
    const def = DEFAULT_SOUNDS[trackIndex];
    if (!def) continue;

    const input = soundInputs[trackIndex];
    const label = getTrackLabel(input);

    if (label) label.textContent = def.label;
    label?.classList.add('loading');

    try {
      const response = await fetch(def.path);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await loadTrackBuffer(arrayBuffer);
      trackBuffers[trackIndex] = audioBuffer;
      label?.classList.remove('loading', 'error');
      label?.classList.add('loaded');
    } catch (error) {
      console.warn('Could not auto-load default sound for track', trackIndex, error);
      if (label) label.textContent = `Track ${trackIndex + 1}`;
      label?.classList.remove('loading');
    }
  }
}

// Handles a file being selected for a track. Reads the file as raw bytes, decodes
// it into an AudioBuffer, and stores it in trackBuffers. The label updates to show
// the chosen filename and loading/loaded/error state during the process.
function handleSoundFile(event) {
  const input = event.currentTarget;
  const trackIndex = Number(input.dataset.track);
  const file = input.files?.[0];
  const label = getTrackLabel(input);

  if (!file) {
    trackBuffers[trackIndex] = null;
    if (label) label.textContent = `Track ${trackIndex + 1}`;
    label?.classList.remove('loaded', 'loading', 'error');
    return;
  }

  // Show the filename (minus extension) as the new label.
  if (label) label.textContent = file.name.replace(/\.[^.]+$/, '');
  label?.classList.remove('loaded', 'error');
  label?.classList.add('loading');

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const audioBuffer = await loadTrackBuffer(reader.result);
      trackBuffers[trackIndex] = audioBuffer;
      label?.classList.remove('loading', 'error');
      label?.classList.add('loaded');
    } catch (error) {
      console.error('Audio decode failed for track', trackIndex, error);
      trackBuffers[trackIndex] = null;
      label?.classList.remove('loading', 'loaded');
      label?.classList.add('error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ─── Audio Playback ───────────────────────────────────────────────────────────
// Creates a one-shot buffer source for a single hit and connects it through the
// track's gain node. BufferSourceNodes are single-use — you create a new one each
// time a step fires.
function createBufferSource(buffer, when, trackIndex) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(trackGains[trackIndex]);
  source.start(when);
}

// Fires the audio for all active tracks on a given step at the scheduled time.
function scheduleStep(step, time) {
  for (let trackIndex = 0; trackIndex < NUM_TRACKS; trackIndex += 1) {
    if (activeSteps[trackIndex][step] && trackBuffers[trackIndex]) {
      createBufferSource(trackBuffers[trackIndex], time, trackIndex);
    }
  }
}

// Advances nextNoteTime and currentStep by one step's worth of time.
// Step duration is derived from BPM: each beat is divided into 4 steps (16th notes).
function nextStep() {
  const bpm = Number(bpmInput.value) || 120;
  const secondsPerBeat = 60 / bpm;
  const secondsPerStep = secondsPerBeat / 4;

  nextNoteTime += secondsPerStep;
  currentStep = (currentStep + 1) % numSteps;
}

// ─── Playhead Highlight ───────────────────────────────────────────────────────
// Updates the visual highlight to show which step row is currently playing.
// The grid stores all cells as a flat list, so the row for step N starts at
// index N * (NUM_TRACKS + 1) — one label cell plus one button per track.
function updatePlayheadHighlight(step) {
  document.querySelectorAll('.step-row-current').forEach((element) => {
    element.classList.remove('step-row-current');
  });

  const rowStartIndex = step * (NUM_TRACKS + 1);
  const rowEndIndex = rowStartIndex + NUM_TRACKS + 1;

  for (let idx = rowStartIndex; idx < rowEndIndex; idx += 1) {
    const element = sequencerGrid.children[idx];
    if (element) {
      element.classList.add('step-row-current');
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// The core timing loop. Runs every LOOKAHEAD_INTERVAL_MS via setInterval and
// schedules any steps that fall within the next SCHEDULE_AHEAD_SECONDS window.
// Audio is scheduled on the precise hardware clock (ctx.currentTime) well in
// advance, while a matching setTimeout triggers the visual highlight at roughly
// the right wall-clock moment. This split keeps audio tight even if the JS thread
// is briefly busy — audio scheduling can't be dropped by a slow frame.
function scheduler() {
  const ctx = getAudioContext();
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
    const stepToSchedule = currentStep;
    scheduleStep(stepToSchedule, nextNoteTime);

    const timeUntilStepMs = Math.max(0, (nextNoteTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      updatePlayheadHighlight(stepToSchedule);
      // Remove this timeout from the tracking array once it has fired.
      const idx = scheduledHighlightTimeouts.indexOf(timeoutId);
      if (idx !== -1) scheduledHighlightTimeouts.splice(idx, 1);
    }, timeUntilStepMs);
    scheduledHighlightTimeouts.push(timeoutId);

    nextStep();
  }
}

// ─── Playback Controls ────────────────────────────────────────────────────────
function startSequencer() {
  const ctx = getAudioContext();
  // Browsers suspend the AudioContext until a user gesture — resume it if needed.
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  isPlaying = true;
  playStopBtn.textContent = 'Stop';
  currentStep = 0;
  // Start slightly in the future so the first step has time to be scheduled cleanly.
  nextNoteTime = ctx.currentTime + 0.05;
  updatePlayheadHighlight(currentStep);
  schedulerId = setInterval(scheduler, LOOKAHEAD_INTERVAL_MS);
}

function stopSequencer() {
  isPlaying = false;
  playStopBtn.textContent = 'Play';
  if (schedulerId !== null) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  // Cancel any highlight timeouts that haven't fired yet.
  scheduledHighlightTimeouts.forEach(clearTimeout);
  scheduledHighlightTimeouts.length = 0;
  document.querySelectorAll('.step-row-current').forEach((el) => {
    el.classList.remove('step-row-current');
  });
}

function togglePlay() {
  if (isPlaying) {
    stopSequencer();
  } else {
    startSequencer();
  }
}

// ─── Reset Helpers ────────────────────────────────────────────────────────────
// Shared cleanup used by both resetSequencer and rebuildGrid.
function resetPlaybackState() {
  currentStep = 0;
  nextNoteTime = 0;
  document.querySelectorAll('.step-row-current').forEach((el) => el.classList.remove('step-row-current'));
}

// Clears all active step toggles in both the data array and the DOM.
function clearSteps() {
  activeSteps = Array.from({ length: NUM_TRACKS }, () => Array(numSteps).fill(false));
  document.querySelectorAll('.step-button.active').forEach((button) => {
    button.classList.remove('active');
  });
}

// Clears all loaded audio files, restores default track labels, and resets status indicators.
function clearSoundFiles() {
  soundInputs.forEach((input, index) => {
    input.value = '';
    trackBuffers[index] = null;
    const label = getTrackLabel(input);
    if (label) label.textContent = `Track ${index + 1}`;
    label?.classList.remove('loaded', 'loading', 'error');
  });
}

// Full reset: stops playback, clears the grid pattern, unloads all audio files.
function resetSequencer() {
  if (isPlaying) {
    stopSequencer();
  }

  clearSteps();
  clearSoundFiles();
  resetPlaybackState();
}

// ─── Step Count Change ────────────────────────────────────────────────────────
// Rebuilds the grid DOM for a new step count while preserving the existing pattern.
// Steps that exist in the new count keep their state; extra steps are dropped.
function rebuildGrid() {
  const prevSteps = activeSteps;
  activeSteps = Array.from({ length: NUM_TRACKS }, (_, trackIndex) =>
    Array.from({ length: numSteps }, (_, stepIndex) => prevSteps[trackIndex]?.[stepIndex] ?? false)
  );
  sequencerGrid.innerHTML = '';
  resetPlaybackState();
  createGrid();
}

function handleStepCountChange() {
  const requestedSteps = Number(stepCountInput.value) || 16;
  numSteps = Math.min(64, Math.max(4, requestedSteps));
  stepCountInput.value = numSteps;
  if (isPlaying) {
    stopSequencer();
  }
  rebuildGrid();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────
playStopBtn.addEventListener('click', togglePlay);
resetBtn.addEventListener('click', resetSequencer);
stepCountInput.addEventListener('change', handleStepCountChange);
soundInputs.forEach((input) => input.addEventListener('change', handleSoundFile));
volumeInputs.forEach((input) => {
  input.addEventListener('input', () => {
    const trackIndex = Number(input.dataset.track);
    if (trackGains[trackIndex]) {
      trackGains[trackIndex].gain.value = Number(input.value);
    }
  });
});

// ─── Init ─────────────────────────────────────────────────────────────────────
createGrid();
loadDefaultSounds();
