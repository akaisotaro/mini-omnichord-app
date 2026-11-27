'use strict';

// 中央のドをC4（MIDI 60）とする。実機の送信番号に合わせて変更可能。
const INPUT_NOTES = [48, 52, 55, 60];
const PREFERRED_MIDI_DEVICE = 'RV003USB Example MIDI Device';
// 各コードのストラム1〜4に対応するMIDIノート番号。
const CHORD_MAP = {
  C: [48, 52, 55, 60], F: [53, 57, 60, 65],
  G: [55, 59, 62, 67], G7: [55, 59, 65, 67],
  Bb: [58, 62, 65, 70], C7: [48, 52, 58, 60],
  D: [50, 54, 57, 62], D7: [50, 54, 60, 62],
  Am: [57, 60, 64, 69], Dm: [50, 53, 57, 62],
  E: [52, 56, 59, 64], E7: [52, 56, 62, 64]
};
const KEY_CHORDS = {
  C: ['C', 'F', 'G', 'G7'], F: ['F', 'Bb', 'C', 'C7'],
  G: ['G', 'C', 'D', 'D7'], Am: ['Am', 'Dm', 'E', 'E7']
};
const CHORD_DEGREES = ['I', 'IV', 'V', 'V7'];
const label = chord => chord === 'Bb' ? 'B♭' : chord;
let selectedKey = 'C';
let selectedChord = 'C';
let audioContext;
let master;
let midiAccess;
let activeMidiInput;
let audioGeneration = 0;
const voices = new Set();
const midiSourceName = document.querySelector('#midi-sources');
const audioStatus = document.querySelector('#audio-status');

async function enableAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('このブラウザはWeb Audioに対応していません。');
  if (!audioContext) {
    audioContext = new AudioContextClass();
    master = audioContext.createGain();
    master.gain.value = 0.65;
    const limiter = audioContext.createDynamicsCompressor();
    master.connect(limiter);
    limiter.connect(audioContext.destination);
  }
  if (audioContext.state !== 'running') await audioContext.resume();
  if (audioContext.state !== 'running') throw new Error('画面をタップして音声を有効にしてください。');
  audioStatus.textContent = '';
}

function stopAll() {
  audioGeneration++;
  for (const voice of voices) {
    try { voice.oscillator.stop(); } catch (_) { /* 停止済み */ }
    voice.oscillator.disconnect();
    voice.gain.disconnect();
  }
  voices.clear();
}

function playNote(note, velocity = 100) {
  if (!audioContext || audioContext.state !== 'running') return;
  // 連打は音を重ねる。発音数を制限して過負荷を防ぐ。
  if (voices.size >= 32) {
    const oldest = voices.values().next().value;
    oldest.oscillator.stop();
    oldest.oscillator.disconnect();
    oldest.gain.disconnect();
    voices.delete(oldest);
  }
  const now = audioContext.currentTime;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = 'triangle';
  oscillator.frequency.value = 440 * 2 ** ((note - 69) / 12);
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.24 * velocity / 127, now + 0.006);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 2.2);
  oscillator.connect(gain);
  gain.connect(master);
  const voice = { oscillator, gain };
  voices.add(voice);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
    voices.delete(voice);
  };
  oscillator.start(now);
  oscillator.stop(now + 2.25);
}

function renderChords() {
  const container = document.querySelector('#chords');
  container.replaceChildren();
  for (const [index, chord] of KEY_CHORDS[selectedKey].entries()) {
    const cell = document.createElement('div');
    cell.className = 'chord-cell';
    const degree = document.createElement('span');
    degree.className = 'degree';
    degree.id = `degree-${index}`;
    degree.textContent = CHORD_DEGREES[index];
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chord';
    button.textContent = label(chord);
    button.dataset.chord = chord;
    button.setAttribute('aria-pressed', String(selectedChord === chord));
    button.setAttribute('aria-describedby', degree.id);
    button.addEventListener('click', async () => {
      selectedChord = chord;
      for (const sibling of container.querySelectorAll('.chord')) {
        sibling.setAttribute('aria-pressed', String(sibling.dataset.chord === chord));
      }
      const generation = audioGeneration;
      try {
        await enableAudio();
        // コード選択に加え、クリック／タップごとにS1を試聴する。
        if (generation === audioGeneration) playNote(CHORD_MAP[chord][0]);
      } catch (error) { audioStatus.textContent = error.message; }
    });
    cell.append(button, degree);
    container.append(cell);
  }
}

for (const key of Object.keys(KEY_CHORDS)) {
  const wrapper = document.createElement('label');
  wrapper.className = 'key';
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'key';
  input.value = key;
  input.checked = key === selectedKey;
  input.addEventListener('change', () => {
    stopAll();
    selectedKey = key;
    selectedChord = null;
    renderChords();
  });
  wrapper.append(input, document.createTextNode(key));
  document.querySelector('#keys').append(wrapper);
}
renderChords();

function handleMidiMessage(event) {
  const [command, note, velocity] = event.data;
  // 全チャンネルを受信。Note OffとNote On velocity=0は無視。
  if ((command & 0xf0) !== 0x90 || !velocity || !selectedChord) return;
  const index = INPUT_NOTES.indexOf(note);
  if (index < 0) return;
  playNote(CHORD_MAP[selectedChord][index], velocity);
}

function refreshMidiInputs() {
  const connected = Array.from(midiAccess.inputs.values()).filter(input => input.state === 'connected');
  const preferred = connected.find(input => input.name === PREFERRED_MIDI_DEVICE);
  const current = connected.includes(activeMidiInput) ? activeMidiInput : undefined;
  const next = preferred ?? current ?? connected[0];
  if (next === activeMidiInput) return;

  const previous = activeMidiInput;
  activeMidiInput = next;
  if (previous) {
    previous.onmidimessage = null;
    previous.close().catch(() => {});
    stopAll();
  }
  if (next) next.onmidimessage = handleMidiMessage;
  midiSourceName.textContent = next ? next.name || next.manufacturer || '名称不明のMIDI入力' : '';
}

async function connectMidi() {
  midiAccess = await navigator.requestMIDIAccess({ sysex: false });
  midiAccess.onstatechange = refreshMidiInputs;
  refreshMidiInputs();
}

if (navigator.requestMIDIAccess) {
  connectMidi().catch(() => {
    // 初回にアクセスできなければ、コードボタンの操作時に一度だけ試す。
    document.querySelector('#chords').addEventListener('click', () => {
      connectMidi().catch(() => {});
    }, { once: true });
  });
}
window.addEventListener('pagehide', stopAll);
