const NUM_TRACKS = 4;
let numSteps = 16;
const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.2;

const playStopBtn = document.getElementById('playStopBtn');
const resetBtn = document.getElementById('resetBtn');
const bpmInput = document.getElementById('bpmInput');
const stepCountInput = document.getElementById('stepCountInput');
const sequencerGrid = document.getElementById('sequencerGrid');
const soundInputs = document.querySelectorAll('.sound-input');
const volumeInputs = document.querySelectorAll('.volume-input');

let audioContext = null;
const trackBuffers = Array(NUM_TRACKS).fill(null);
const trackGains = Array(NUM_TRACKS).fill(null);
let activeSteps = Array.from({ length: NUM_TRACKS }, () => Array(numSteps).fill(false));

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerId = null;
const scheduledHighlightTimeouts = [];

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

function toggleStep(track, step, button) {
  activeSteps[track][step] = !activeSteps[track][step];
  button.classList.toggle('active', activeSteps[track][step]);
}

function loadTrackBuffer(arrayBuffer) {
  return getAudioContext().decodeAudioData(arrayBuffer);
}

function getTrackLabel(input) {
  return input.closest('.track-column')?.querySelector('.track-label');
}

function handleSoundFile(event) {
  const input = event.currentTarget;
  const trackIndex = Number(input.dataset.track);
  const file = input.files?.[0];
  const label = getTrackLabel(input);

  if (!file) {
    trackBuffers[trackIndex] = null;
    label?.classList.remove('loaded', 'loading', 'error');
    return;
  }

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

function createBufferSource(buffer, when, trackIndex) {
  const ctx = getAudioContext();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(trackGains[trackIndex]);
  source.start(when);
}

function scheduleStep(step, time) {
  for (let trackIndex = 0; trackIndex < NUM_TRACKS; trackIndex += 1) {
    if (activeSteps[trackIndex][step] && trackBuffers[trackIndex]) {
      createBufferSource(trackBuffers[trackIndex], time, trackIndex);
    }
  }
}

function nextStep() {
  const bpm = Number(bpmInput.value) || 120;
  const secondsPerBeat = 60 / bpm;
  const secondsPerStep = secondsPerBeat / 4;

  nextNoteTime += secondsPerStep;
  currentStep = (currentStep + 1) % numSteps;
}

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

function scheduler() {
  const ctx = getAudioContext();
  while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SECONDS) {
    const stepToSchedule = currentStep;
    scheduleStep(stepToSchedule, nextNoteTime);

    const timeUntilStepMs = Math.max(0, (nextNoteTime - ctx.currentTime) * 1000);
    const timeoutId = setTimeout(() => {
      updatePlayheadHighlight(stepToSchedule);
      const idx = scheduledHighlightTimeouts.indexOf(timeoutId);
      if (idx !== -1) scheduledHighlightTimeouts.splice(idx, 1);
    }, timeUntilStepMs);
    scheduledHighlightTimeouts.push(timeoutId);

    nextStep();
  }
}

function startSequencer() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') {
    ctx.resume();
  }

  isPlaying = true;
  playStopBtn.textContent = 'Stop';
  currentStep = 0;
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

function resetPlaybackState() {
  currentStep = 0;
  nextNoteTime = 0;
  document.querySelectorAll('.step-row-current').forEach((el) => el.classList.remove('step-row-current'));
}

function clearSteps() {
  activeSteps = Array.from({ length: NUM_TRACKS }, () => Array(numSteps).fill(false));
  document.querySelectorAll('.step-button.active').forEach((button) => {
    button.classList.remove('active');
  });
}

function clearSoundFiles() {
  soundInputs.forEach((input, index) => {
    input.value = '';
    trackBuffers[index] = null;
    getTrackLabel(input)?.classList.remove('loaded', 'loading', 'error');
  });
}

function resetSequencer() {
  if (isPlaying) {
    stopSequencer();
  }

  clearSteps();
  clearSoundFiles();
  resetPlaybackState();
}

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

createGrid();
