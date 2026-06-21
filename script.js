const NUM_TRACKS = 4;
const NUM_STEPS = 16;
const LOOKAHEAD_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.2;

const playStopBtn = document.getElementById('playStopBtn');
const resetBtn = document.getElementById('resetBtn');
const bpmInput = document.getElementById('bpmInput');
const sequencerGrid = document.getElementById('sequencerGrid');
const soundInputs = document.querySelectorAll('.sound-input');

const audioContext = new (window.AudioContext || window.webkitAudioContext)();
const trackBuffers = Array(NUM_TRACKS).fill(null);
const activeSteps = Array.from({ length: NUM_TRACKS }, () => Array(NUM_STEPS).fill(false));

let isPlaying = false;
let currentStep = 0;
let nextNoteTime = 0;
let schedulerId = null;
const scheduledHighlightTimeouts = [];

function createGrid() {
  for (let stepIndex = 0; stepIndex < NUM_STEPS; stepIndex += 1) {
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
      button.addEventListener('click', () => toggleStep(trackIndex, stepIndex, button));
      sequencerGrid.appendChild(button);
    }
  }
}

function toggleStep(track, step, button) {
  activeSteps[track][step] = !activeSteps[track][step];
  button.classList.toggle('active', activeSteps[track][step]);
}

function loadTrackBuffer(trackIndex, arrayBuffer) {
  return audioContext.decodeAudioData(arrayBuffer);
}

function handleSoundFile(event) {
  const input = event.currentTarget;
  const trackIndex = Number(input.dataset.track);
  const file = input.files?.[0];

  if (!file) {
    trackBuffers[trackIndex] = null;
    return;
  }

  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const audioBuffer = await loadTrackBuffer(trackIndex, reader.result);
      trackBuffers[trackIndex] = audioBuffer;
      input.previousElementSibling?.classList.add('loaded');
    } catch (error) {
      console.error('Audio decode failed for track', trackIndex, error);
      trackBuffers[trackIndex] = null;
    }
  };
  reader.readAsArrayBuffer(file);
}

function createBufferSource(buffer, when) {
  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.start(when);
  return source;
}

function scheduleStep(step, time) {
  for (let trackIndex = 0; trackIndex < NUM_TRACKS; trackIndex += 1) {
    if (activeSteps[trackIndex][step] && trackBuffers[trackIndex]) {
      createBufferSource(trackBuffers[trackIndex], time);
    }
  }
}

function nextStep() {
  const bpm = Number(bpmInput.value) || 120;
  const secondsPerBeat = 60 / bpm;
  const secondsPerStep = secondsPerBeat / 4;

  nextNoteTime += secondsPerStep;
  currentStep = (currentStep + 1) % NUM_STEPS;
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
  while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD_SECONDS) {
    const stepToSchedule = currentStep;
    scheduleStep(stepToSchedule, nextNoteTime);

    const timeUntilStepMs = Math.max(0, (nextNoteTime - audioContext.currentTime) * 1000);
    const timeoutId = setTimeout(() => updatePlayheadHighlight(stepToSchedule), timeUntilStepMs);
    scheduledHighlightTimeouts.push(timeoutId);

    nextStep();
  }
}

function startSequencer() {
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }

  isPlaying = true;
  playStopBtn.textContent = 'Stop';
  currentStep = 0;
  nextNoteTime = audioContext.currentTime + 0.05;
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

function clearSteps() {
  activeSteps.forEach((trackSteps) => trackSteps.fill(false));
  document.querySelectorAll('.step-button.active').forEach((button) => {
    button.classList.remove('active');
  });
}

function clearSoundFiles() {
  soundInputs.forEach((input, index) => {
    input.value = '';
    trackBuffers[index] = null;
  });
}

function resetSequencer() {
  if (isPlaying) {
    stopSequencer();
  }

  clearSteps();
  clearSoundFiles();
  currentStep = 0;
  nextNoteTime = 0;
  document.querySelectorAll('.step-row-current').forEach((el) => el.classList.remove('step-row-current'));
}

playStopBtn.addEventListener('click', togglePlay);
resetBtn.addEventListener('click', resetSequencer);
soundInputs.forEach((input) => input.addEventListener('change', handleSoundFile));

createGrid();
