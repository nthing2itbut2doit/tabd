/* Tabd v1 Prototype (single-file, no build step)
 * Canvas-based tab editor with Slate theme.
 *
 * Features:
 * - Click-to-cursor + keyboard entry
 * - Chords: multiple strings per column
 * - Strum lane per column (↓ ↑ x)
 * - Notes: Off / Hover / Board (separate note board)
 * - Notes interpretation: Fingered / Sounding (capo-aware)
 * - Chords: Off / Hover (detected from column pitch classes)
 * - Save/Open .tabd (JSON) + Export .txt (ASCII)
 */

'use strict';

const APP_VERSION = "1.4.2";
const APP_THEME_DEFAULT = "slate";
const APP_FORMAT_VERSION = 1;

// localStorage keys
const LS_THEME = "tabd.theme";
const LS_SEEN_CHORD_HINT = "tabd.seenChordHintV1";

// -------------------------
// Utilities
// -------------------------
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(r.error || new Error('File read failed'));
    r.readAsText(file);
  });
}

// -------------------------
// Musical mapping (Sharps only)
// -------------------------
const CHROMATIC_SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const NOTE_PC = {
  'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11
};

// Standard pitch-class tuning (no octaves shown anywhere)
// These are pitch classes only.
const TUNINGS = {
  guitar: {
    'Standard (EADGBE)': ['e','B','G','D','A','E'],
    'Drop D (DADGBE)':   ['e','B','G','D','A','D'],
  },
  bass: {
    'Standard 4 (EADG)': ['G','D','A','E'],
    'Standard 5 (BEADG)': ['G','D','A','E','B'],
    'Drop D 4 (DADG)':   ['G','D','A','D'],
  }
};

// Map string labels to their open-string pitch class
// guitar: E2 A2 D3 G3 B3 E4 -> E A D G B E
// bass 4: E1 A1 D2 G2 -> E A D G
const OPEN_PC = {
  'E': NOTE_PC['E'],
  'A': NOTE_PC['A'],
  'D': NOTE_PC['D'],
  'G': NOTE_PC['G'],
  'B': NOTE_PC['B'],
  'e': NOTE_PC['E'], // high e uses same pitch class
};

function tokenToFrets(token) {
  // Extract all digit runs; validate remaining chars against allowed ops/suffixes.
  const tok = String(token || '').trim();
  if (!tok) return { frets: [], ok: false };

  const frets = (tok.match(/\d+/g) || []).map(s => parseInt(s, 10));
  const remaining = tok.replace(/\d+/g, '');

  const OPS = new Set(['h','p','/','\\','b']);
  const SUF = new Set(['~','.','^']);

  for (const ch of remaining) {
    if (OPS.has(ch) || SUF.has(ch) || ch === '(' || ch === ')') continue;
    // Allow single space (some users might input 'h ')
    if (ch === ' ') continue;
    return { frets, ok: false };
  }

  return { frets, ok: frets.length > 0 };
}

function fretToNoteName(openPc, fret, capo, interpretMode) {
  // interpretMode: 'fingered'|'sounding'
  let pc = (openPc + fret) % 12;
  if (interpretMode === 'sounding') pc = (pc + capo) % 12;
  return CHROMATIC_SHARPS[pc];
}

// Patterns by intervals from root (pitch classes)
// Goal: cover common guitar realities without becoming a full theory engine.
const CHORD_PATTERNS = [
  // Dyads / shells
  { name:'5',     ints:[0,7] },           // power chord
  // Suspended
  { name:'sus2',  ints:[0,2,7] },
  { name:'sus4',  ints:[0,5,7] },
  // Triads
  { name:'',      ints:[0,4,7] },
  { name:'m',     ints:[0,3,7] },
  { name:'dim',   ints:[0,3,6] },
  { name:'aug',   ints:[0,4,8] },
  // Sevenths
  { name:'7',     ints:[0,4,7,10] },
  { name:'maj7',  ints:[0,4,7,11] },
  { name:'m7',    ints:[0,3,7,10] },
  { name:'m7b5',  ints:[0,3,6,10] },
  // Common adds / sixes (keep minimal)
  { name:'6',     ints:[0,4,7,9] },
  { name:'m6',    ints:[0,3,7,9] },
  { name:'add9',  ints:[0,2,4,7] },
  { name:'madd9', ints:[0,2,3,7] },
];

function detectChord(pitchClasses, pcCounts = null) {
  // pitchClasses: Set<number>
  // pcCounts: optional Map<number, number> (duplicates across strings)
  const pcs = Array.from(pitchClasses).sort((a,b)=>a-b);
  if (pcs.length < 2) return null;

  const matches = [];

  for (const root of pcs) {
    const rel = pcs.map(pc => (pc - root + 12) % 12).sort((a,b)=>a-b);
    for (const pat of CHORD_PATTERNS) {
      const ints = pat.ints;
      // Require all pattern intervals present
      const ok = ints.every(x => rel.includes(x));
      if (!ok) continue;

      // Conservative extras gate:
      // - allow 0 extras always
      // - allow 1 extra if the chord is at least a triad (>=3 tones)
      // - otherwise treat as ambiguous
      const extras = rel.length - ints.length;
      if (extras > 0) {
        if (extras > 1) continue;
        if (ints.length < 3) continue;
      }

      // Preference signals
      const dup = pcCounts ? (pcCounts.get(root) || 0) : 0;

      matches.push({
        root,
        quality: pat.name,
        size: ints.length,
        extras,
        dup,
      });
    }
  }

  if (matches.length === 0) return null;

  // Ranking:
  // 1) fewer extras
  // 2) prefer roots that appear more than once across strings (common guitar voicing center)
  // 3) prefer more-complete chords (7th > triad > dyad) when equally clean
  matches.sort((a,b) =>
    (a.extras - b.extras) ||
    (b.dup - a.dup) ||
    (b.size - a.size)
  );

  const best = matches[0];

  // If there are other equally-ranked matches, treat as ambiguous
  const equally = matches.filter(m =>
    m.extras === best.extras &&
    m.dup === best.dup &&
    m.size === best.size
  );
  if (equally.length > 1) return null;

  const rootName = CHROMATIC_SHARPS[best.root];
  return rootName + best.quality;
}

// -------------------------
// Document model (.tabd)
// -------------------------
function newDoc(instrumentType='guitar', tuningName=null) {
  const tuneKeys = Object.keys(TUNINGS[instrumentType]);
  const tn = tuningName && TUNINGS[instrumentType][tuningName] ? tuningName : tuneKeys[0];
  const strings = TUNINGS[instrumentType][tn];

  // 64 columns to start
  const columns = Array.from({ length: 64 }, () => ({ notes: {}, strum: '' }));

  return {
    format: 'TabdProject',
    tabd: { appVersion: APP_VERSION, formatVersion: APP_FORMAT_VERSION, minAppVersion: '1.0.0', createdUtc: new Date().toISOString(), modifiedUtc: new Date().toISOString() },
    meta: { title: 'Untitled' },
    instrument: { type: instrumentType, strings, tuningName: tn },
    capo: { fret: 0, mode: 'relative' },
    // Default: show Note Board (helps composition decisions without extra toggling)
    view: { notesMode: 'board', notesInterpretation: 'fingered', chordsMode: 'off' },
    columns,
  };
}

// -------------------------
// Canvas editor
// -------------------------
const canvas = document.getElementById('editor');
const ctx = canvas.getContext('2d');
const canvasWrap = document.querySelector('.canvasWrap');
const tooltip = document.getElementById('tooltip');

// Header + footer UI
const subtitleEl = document.getElementById('subtitle');
const footerMetaEl = document.getElementById('footerMeta');

const themeBtn = document.getElementById('themeBtn');
const themeMenu = document.getElementById('themeMenu');
const themeNameEl = document.getElementById('themeName');

// About modal
const aboutBtn = document.getElementById('aboutBtn');
const aboutModal = document.getElementById('aboutModal');
const aboutClose = document.getElementById('aboutClose');

// Subtle UI tooltips (for control hovers)
const uiTipEl = document.getElementById('uiTip');

function hideUiTip() {
  if (!uiTipEl) return;
  uiTipEl.hidden = true;
}

function showUiTipForElement(el, text) {
  if (!uiTipEl || !el) return;
  uiTipEl.textContent = text;
  uiTipEl.hidden = false;

  // Measure and place near element (prefer below; flip above if needed)
  const r = el.getBoundingClientRect();
  const pad = 8;
  const w = uiTipEl.offsetWidth;
  const h = uiTipEl.offsetHeight;

  let left = r.left;
  left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

  const spaceBelow = window.innerHeight - r.bottom;
  const spaceAbove = r.top;
  let top = (spaceBelow >= h + pad) ? (r.bottom + pad) : (r.top - h - pad);
  if (spaceAbove < h + pad && spaceBelow < h + pad) top = Math.max(pad, Math.min(r.bottom + pad, window.innerHeight - h - pad));

  uiTipEl.style.left = `${left}px`;
  uiTipEl.style.top = `${top}px`;
}

function attachUiTip(el, text) {
  if (!el) return;
  const show = () => showUiTipForElement(el, text);
  el.addEventListener('mouseenter', show);
  el.addEventListener('focus', show);
  el.addEventListener('mouseleave', hideUiTip);
  el.addEventListener('blur', hideUiTip);
}

// Controls

const instrumentSelect = document.getElementById('instrumentSelect');
const tuningSelect = document.getElementById('tuningSelect');
const capoInput = document.getElementById('capoInput');

const notesModeSeg = document.getElementById('notesMode');
const notesInterpretSeg = document.getElementById('notesInterpret');
const chordsModeSeg = document.getElementById('chordsMode');

const newBtn = document.getElementById('newBtn');
const saveBtn = document.getElementById('saveBtn');
const openBtn = document.getElementById('openBtn');
const exportBtn = document.getElementById('exportBtn');
const addColsBtn = document.getElementById('addColsBtn');
const openFile = document.getElementById('openFile');

const modeBadge = document.getElementById('modeBadge');
const cursorReadout = document.getElementById('cursorReadout');

// Theme colors from CSS (resolved each render so theme switching is instant)
let COLORS = null;
function readColors() {
  const css = getComputedStyle(document.body);
  COLORS = {
    bg1: css.getPropertyValue('--bg-1').trim(),
    bg2: css.getPropertyValue('--bg-2').trim(),
    grid: css.getPropertyValue('--grid').trim(),
    border: css.getPropertyValue('--border').trim(),
    text: css.getPropertyValue('--text').trim(),
    text2: css.getPropertyValue('--text-2').trim(),
    muted: css.getPropertyValue('--muted').trim(),
    accent: css.getPropertyValue('--accent').trim(),
    accent2: css.getPropertyValue('--accent-2').trim(),
    focus: css.getPropertyValue('--focus').trim(),
    warn: css.getPropertyValue('--warn').trim(),
  };
}
readColors();


let doc = newDoc('guitar');

// Editor state
let cursor = { lane: 'tab', row: 0, col: 0 }; // lane: 'strum'|'tab'
let chordStack = false;
let insertMode = false; // placeholder (UI badge only)

// Chord label state (for subtle change highlight)
let lastChordLabel = null;
let lastChordChangeTs = 0;

// Digit buffer for multi-digit frets
let digitBuffer = '';
let digitTimer = null;

// Undo/redo
let history = [];
let future = [];

function pushHistory() {
  history.push(deepClone(doc));
  if (history.length > 50) history.shift();
  future = [];
}

function undo() {
  if (history.length === 0) return;
  future.push(deepClone(doc));
  doc = history.pop();
  syncControlsFromDoc();
  render();
}

function redo() {
  if (future.length === 0) return;
  history.push(deepClone(doc));
  doc = future.pop();
  syncControlsFromDoc();
  render();
}

function setSegActive(segEl, mode) {
  for (const b of segEl.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.mode === mode);
  }
}

function getActiveMode(segEl) {
  const b = segEl.querySelector('button.active');
  return b ? b.dataset.mode : null;
}

function populateTuningSelect() {
  const type = instrumentSelect.value;
  tuningSelect.innerHTML = '';
  for (const name of Object.keys(TUNINGS[type])) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    tuningSelect.appendChild(opt);
  }
}

function applyInstrumentAndTuning(type, tuningName) {
  // Preserve columns, but adjust row mapping if string count changes.
  pushHistory();
  const oldStrings = doc.instrument.strings;
  const newStrings = TUNINGS[type][tuningName];

  // Build remap by index for safety
  const minLen = Math.min(oldStrings.length, newStrings.length);

  for (const col of doc.columns) {
    const newNotes = {};
    // map top-to-bottom indices
    for (let i = 0; i < minLen; i++) {
      const oldLabel = oldStrings[i];
      const newLabel = newStrings[i];
      if (col.notes[oldLabel] != null) newNotes[newLabel] = col.notes[oldLabel];
    }
    col.notes = newNotes;
  }

  doc.instrument.type = type;
  doc.instrument.tuningName = tuningName;
  doc.instrument.strings = [...newStrings];

  // clamp cursor
  cursor.row = clamp(cursor.row, 0, doc.instrument.strings.length - 1);

  render();
}

function syncControlsFromDoc() {
  instrumentSelect.value = doc.instrument.type;
  populateTuningSelect();
  tuningSelect.value = doc.instrument.tuningName;
  capoInput.value = String(doc.capo.fret ?? 0);

  setSegActive(notesModeSeg, doc.view.notesMode);
  setSegActive(notesInterpretSeg, doc.view.notesInterpretation);
  setSegActive(chordsModeSeg, doc.view.chordsMode);
}

function updateModeBadge() {
  if (!modeBadge) return;
  const label = insertMode ? 'Insert (stub)' : 'Overwrite';
  modeBadge.textContent = label + (chordStack ? ' · Chord-stack' : '');
}

// -------------------------
// Layout calculations (variable-width columns)
// -------------------------
function colCharWidth(colIdx) {
  // width in chars = max token length in that column (notes + strum + note-board tokens)
  const col = doc.columns[colIdx];
  let w = 1;
  // strum token width
  if (col.strum) w = Math.max(w, String(col.strum).length);
  // note tokens
  for (const s of doc.instrument.strings) {
    const tok = col.notes[s];
    if (tok != null && String(tok).trim() !== '') {
      w = Math.max(w, String(tok).length);
    }
    // note board tokens (derived) only affect board when enabled; do NOT affect grid width.
  }
  return clamp(w, 1, 4); // keep sane; beyond 4 becomes hard to read in a single cell
}

function buildColumnPixelWidths(fontSizePx) {
  ctx.font = `500 ${fontSizePx}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const charW = ctx.measureText('0').width;
  const pad = Math.round(charW * 1.1);
  const widths = doc.columns.map((_, i) => {
    const wChars = colCharWidth(i);
    // Each column renders as "--" background plus token area; we treat a column as wChars characters.
    return Math.round(wChars * charW + pad);
  });
  return { widths, charW, pad };
}

// -------------------------
// Rendering
// -------------------------
function render() {
  readColors();
  // Layout constants
  const marginL = 54;
  const marginT = 18;
  const rowH = 34;
  const laneGap = 14;
  const strumH = 30;
  const titleH = 18;

  // Fonts
  const fontTab = 18;
  const fontLabel = 12;
  const fontNotes = 14;
  const fontChord = 12;

  // Measure column widths first, then size canvas in CSS pixels so the wrapper can scroll.
  const { widths: colPx, charW } = buildColumnPixelWidths(fontTab);
  const totalW = colPx.reduce((a,b)=>a+b, 0);

  // Desired canvas CSS width = max(viewport inner width, content width)
  const wrapInnerW = canvasWrap ? Math.max(0, canvasWrap.clientWidth - 24) : 0; // canvasWrap has 12px padding on both sides
  const contentW = marginL + totalW + 18;
  const desiredCssW = Math.max(wrapInnerW, contentW);
  canvas.style.width = desiredCssW + 'px';

  // HiDPI scale
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth;
  const desiredHeight = computeDesiredCanvasHeight();
  canvas.style.height = desiredHeight + 'px';

  canvas.width = Math.floor(cssWidth * dpr);
  canvas.height = Math.floor(desiredHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.clearRect(0, 0, cssWidth, desiredHeight);

  const showNoteBoard = (doc.view.notesMode === 'board');
  // Chords require derived notes; if notes are Off, chords are unavailable.
  const showChords = (doc.view.chordsMode === 'hover' && doc.view.notesMode !== 'off');

  // Visible columns: with a scrollable wrapper, we can render all columns.
  const visible = { start: 0, end: doc.columns.length };

  // Background
  ctx.fillStyle = COLORS.grid;
  ctx.fillRect(0, 0, cssWidth, desiredHeight);

  // Subtle header
  ctx.fillStyle = 'rgba(255,255,255,0.02)';
  ctx.fillRect(0, 0, cssWidth, 44);

  // (No onboarding text on the canvas.)

  // Compute key y positions
  const yStrumTop = marginT;
  const yTabTop = yStrumTop + strumH + laneGap;
  const tabRows = doc.instrument.strings.length;
  const yNoteHeader = yTabTop + tabRows * rowH + laneGap;
  const yNoteTop = yNoteHeader + titleH;

  // Active column band
  const xColStart = colStartX(colPx, visible.start, marginL);
  const xCursorCol = colStartX(colPx, cursor.col, marginL);
  const xCursorW = colPx[cursor.col] || colPx[0];
  ctx.fillStyle = COLORS.accent2;
  ctx.fillRect(xCursorCol, 0, xCursorW, desiredHeight);

  // Draw grid outlines
  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;

  // Labels (string names)
  ctx.font = `600 ${fontLabel}px "DM Sans", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.fillStyle = COLORS.text2;

  // Strum label
  ctx.fillText('Str', 14, yStrumTop + 20);

  for (let r = 0; r < tabRows; r++) {
    const label = doc.instrument.strings[r];
    ctx.fillText(label + '|', 14, yTabTop + r * rowH + 22);
  }

  if (showNoteBoard) {
    ctx.fillStyle = COLORS.text2;
    ctx.fillText('Notes', 10, yNoteHeader + 12);
    for (let r = 0; r < tabRows; r++) {
      const label = doc.instrument.strings[r];
      ctx.fillText(label + '|', 14, yNoteTop + r * rowH + 22);
    }
  }

  // Strum lane cells + text
  for (let c = visible.start; c < visible.end; c++) {
    const x = colStartX(colPx, c, marginL);
    const w = colPx[c];

    // cell rect
    ctx.strokeRect(x, yStrumTop, w, strumH);

    // background dashes
    drawCellDashes(x, yStrumTop, w, strumH, charW);

    // strum token
    const s = doc.columns[c].strum || '';
    if (s) {
      ctx.font = `600 ${fontTab}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      ctx.fillStyle = COLORS.text;
      drawCenteredText(s, x, yStrumTop, w, strumH);
    }
  }

  // Tab rows
  for (let r = 0; r < tabRows; r++) {
    const stringLabel = doc.instrument.strings[r];
    const y = yTabTop + r * rowH;

    for (let c = visible.start; c < visible.end; c++) {
      const x = colStartX(colPx, c, marginL);
      const w = colPx[c];

      ctx.strokeRect(x, y, w, rowH);
      drawCellDashes(x, y, w, rowH, charW);

      const tok = doc.columns[c].notes[stringLabel];
      if (tok != null && String(tok).trim() !== '') {
        ctx.font = `500 ${fontTab}px "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
        ctx.fillStyle = COLORS.text;
        drawCenteredText(String(tok), x, y, w, rowH);
      }
    }
  }

  // Keep chord-change state in sync with current cursor/settings.
  updateChordLabelState();

  // Note board + chord label
  let chordText = null;
  const now = performance.now();
  const chordHi = clamp(1 - ((now - lastChordChangeTs) / 420), 0, 1);

  if (showNoteBoard) {
    // Header (no extra label; the Notes control already defines this view)
    ctx.font = `500 12px "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.fillStyle = COLORS.muted;

    if (showChords) {
      chordText = getActiveChordLabel();
      if (chordText) {
        // place near note board header
        ctx.font = `600 ${fontChord}px "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillStyle = COLORS.text;
        const chip = `Chord: ${chordText}`;
        const x = colStartX(colPx, cursor.col, marginL) + 8;
        const y = yNoteHeader + 2;
        drawPill(chip, x, y, COLORS.accent2, chordHi);
      }
    }

    for (let r = 0; r < tabRows; r++) {
      const stringLabel = doc.instrument.strings[r];
      const y = yNoteTop + r * rowH;

      for (let c = visible.start; c < visible.end; c++) {
        const x = colStartX(colPx, c, marginL);
        const w = colPx[c];

        ctx.strokeRect(x, y, w, rowH);
        drawCellDashes(x, y, w, rowH, charW);

        const noteTok = deriveFinalNoteToken(stringLabel, c);
        if (noteTok) {
          ctx.font = `500 ${fontNotes}px "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
          ctx.fillStyle = COLORS.text2;
          drawCenteredText(noteTok, x, y, w, rowH);
        }
      }
    }
  } else {
    // If the note board is hidden but chord hover is enabled, still show a subtle
    // chord pill just below the tab grid (keeps the feature usable without clutter).
    if (showChords) {
      chordText = getActiveChordLabel();
      if (chordText) {
        ctx.font = `600 ${fontChord}px "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
        ctx.fillStyle = COLORS.text;
        const chip = `Chord: ${chordText}`;
        const x = colStartX(colPx, cursor.col, marginL) + 8;
        const y = yTabTop + tabRows * rowH + 8;
        drawPill(chip, x, y, COLORS.accent2, chordHi);
      }
    }
  }

  // Cursor outline
  const cursorBox = getCursorRect(colPx, marginL, yStrumTop, yTabTop, rowH, strumH, laneGap, showNoteBoard, yNoteTop);
  if (cursorBox) {
    ctx.strokeStyle = COLORS.focus;
    ctx.lineWidth = 2;
    ctx.strokeRect(cursorBox.x+1, cursorBox.y+1, cursorBox.w-2, cursorBox.h-2);
    ctx.lineWidth = 1;
  }

  // Update readout
  const rowLabel = (cursor.lane === 'strum') ? 'Strum' : doc.instrument.strings[cursor.row];
  cursorReadout.textContent = `${rowLabel} · col ${cursor.col+1}/${doc.columns.length}`;

  updateModeBadge();
}

function computeVisibleColumns(colPx, availableW) {
  // Simple: start at 0, fit as many columns as possible.
  let end = 0;
  let sum = 0;
  while (end < colPx.length && sum + colPx[end] <= availableW) {
    sum += colPx[end];
    end++;
  }
  return { start: 0, end: Math.max(end, 1) };
}

function computeDesiredCanvasHeight() {
  const rowH = 34;
  const laneGap = 14;
  const strumH = 30;
  const titleH = 18;
  const marginT = 18;
  const marginB = 18;

  const rows = doc.instrument.strings.length;
  let h = marginT + strumH + laneGap + rows * rowH + marginB;
  if (doc.view.notesMode === 'board') {
    h += laneGap + titleH + rows * rowH;
  }
  return h;
}

function colStartX(colPx, colIdx, marginL) {
  let x = marginL;
  for (let i = 0; i < colIdx; i++) x += colPx[i] || 0;
  return x;
}

function drawCellDashes(x, y, w, h, charW) {
  // Soft dashed background to mimic tab dashes
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.strokeStyle = 'rgba(169,176,186,0.18)';
  ctx.lineWidth = 1;

  const midY = y + h/2;
  const dashLen = Math.max(6, charW * 0.8);
  const gap = Math.max(5, charW * 0.45);
  let px = x + 6;
  while (px < x + w - 6) {
    ctx.beginPath();
    ctx.moveTo(px, midY);
    ctx.lineTo(Math.min(px + dashLen, x + w - 6), midY);
    ctx.stroke();
    px += dashLen + gap;
  }
  ctx.restore();
}

function drawCenteredText(text, x, y, w, h) {
  const metrics = ctx.measureText(text);
  const tx = x + (w - metrics.width) / 2;
  const ty = y + (h / 2) + 6;
  ctx.fillText(text, tx, ty);
}

function drawPill(text, x, y, bg, highlight = 0) {
  ctx.save();
  ctx.font = `600 12px "Inter", system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const padX = 10;
  const padY = 6;
  const w = ctx.measureText(text).width + padX * 2;
  const h = 26;

  // Keep pills fully on-canvas (prevents edge clipping at small viewports)
  const margin = 6;
  x = clamp(x, margin, ctx.canvas.width - w - margin);
  y = clamp(y, margin, ctx.canvas.height - h - margin);

  // bg
  ctx.fillStyle = bg;
  roundRect(ctx, x, y, w, h, 12);
  ctx.fill();

  // border (slightly brighter right after a chord change)
  const baseAlpha = 0.35;
  const hiAlpha = 0.65;
  const a = baseAlpha + (hiAlpha - baseAlpha) * clamp(highlight, 0, 1);
  ctx.strokeStyle = `rgba(76,110,245,${a.toFixed(3)})`;
  ctx.stroke();

  // text
  ctx.fillStyle = COLORS.text;
  ctx.fillText(text, x + padX, y + 17);
  ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function getCursorRect(colPx, marginL, yStrumTop, yTabTop, rowH, strumH) {
  const x = colStartX(colPx, cursor.col, marginL);
  const w = colPx[cursor.col] || colPx[0];
  if (cursor.lane === 'strum') {
    return { x, y: yStrumTop, w, h: strumH };
  }
  return { x, y: yTabTop + cursor.row * rowH, w, h: rowH };
}

// -------------------------
// Derived notes + chords
// -------------------------
function deriveFinalNoteToken(stringLabel, colIdx) {
  const tok = doc.columns[colIdx].notes[stringLabel];
  if (tok == null || String(tok).trim() === '') return null;

  const { frets, ok } = tokenToFrets(tok);
  if (!ok) return null;

  const finalFret = frets[frets.length - 1];
  const openPc = OPEN_PC[stringLabel];
  if (openPc == null) return null;

  const capo = clamp(parseInt(doc.capo.fret || 0, 10) || 0, 0, 12);
  const interpret = doc.view.notesInterpretation;
  return fretToNoteName(openPc, finalFret, capo, interpret);
}

function deriveHoverNoteInfo(stringLabel, colIdx) {
  const tok = doc.columns[colIdx].notes[stringLabel];
  if (tok == null || String(tok).trim() === '') return null;
  const { frets, ok } = tokenToFrets(tok);
  if (!ok) return null;

  const openPc = OPEN_PC[stringLabel];
  if (openPc == null) return null;

  const capo = clamp(parseInt(doc.capo.fret || 0, 10) || 0, 0, 12);
  const interpret = doc.view.notesInterpretation;

  const notes = frets.map(f => fretToNoteName(openPc, f, capo, interpret));
  return { token: String(tok), frets, notes, interpret };
}

function detectChordForColumn(colIdx) {
  // Build pitch class set from derived final notes for that column
  const pcs = new Set();
  const counts = new Map();
  for (const s of doc.instrument.strings) {
    const tok = doc.columns[colIdx].notes[s];
    if (tok == null || String(tok).trim() === '') continue;
    const { frets, ok } = tokenToFrets(tok);
    if (!ok) continue;
    const finalFret = frets[frets.length - 1];
    const openPc = OPEN_PC[s];
    if (openPc == null) continue;
    const capo = clamp(parseInt(doc.capo.fret || 0, 10) || 0, 0, 12);
    const interpret = doc.view.notesInterpretation;
    let pc = (openPc + finalFret) % 12;
    if (interpret === 'sounding') pc = (pc + capo) % 12;
    pcs.add(pc);
    counts.set(pc, (counts.get(pc) || 0) + 1);
  }
  return detectChord(pcs, counts);
}

function getActiveChordLabel() {
  // Chord labels rely on derived notes. If notes are Off, chords are unavailable.
  if (doc.view.chordsMode !== 'hover') return null;
  if (doc.view.notesMode === 'off') return null;
  return detectChordForColumn(cursor.col);
}

function updateChordLabelState() {
  const cur = getActiveChordLabel();
  if (cur !== lastChordLabel) {
    lastChordLabel = cur;
    lastChordChangeTs = performance.now();
  }
}

// -------------------------
// Input + interaction
// -------------------------
function commitDigitBuffer() {
  if (!digitBuffer) return;
  const val = digitBuffer;
  digitBuffer = '';
  if (digitTimer) {
    clearTimeout(digitTimer);
    digitTimer = null;
  }
  applyToken(val);
}

function scheduleDigitCommit() {
  if (digitTimer) clearTimeout(digitTimer);
  digitTimer = setTimeout(() => {
    commitDigitBuffer();
  }, 350);
}

function clearDigitBuffer() {
  digitBuffer = '';
  if (digitTimer) {
    clearTimeout(digitTimer);
    digitTimer = null;
  }
}

function applyToken(token) {
  pushHistory();
  const c = cursor.col;
  if (cursor.lane === 'strum') {
    doc.columns[c].strum = token;
  } else {
    const s = doc.instrument.strings[cursor.row];
    doc.columns[c].notes[s] = token;
    if (chordStack) {
      cursor.row = clamp(cursor.row + 1, 0, doc.instrument.strings.length - 1);
    } else {
      cursor.col = clamp(cursor.col + 1, 0, doc.columns.length - 1);
    }
  }
  render();
}

function clearCell() {
  pushHistory();
  const c = cursor.col;
  if (cursor.lane === 'strum') {
    doc.columns[c].strum = '';
  } else {
    const s = doc.instrument.strings[cursor.row];
    delete doc.columns[c].notes[s];
  }
  render();
}

function moveCursor(dx, dy) {
  commitDigitBuffer();
  if (cursor.lane === 'strum') {
    cursor.col = clamp(cursor.col + dx, 0, doc.columns.length - 1);
    if (dy !== 0) {
      cursor.lane = 'tab';
      cursor.row = 0;
    }
  } else {
    cursor.col = clamp(cursor.col + dx, 0, doc.columns.length - 1);
    cursor.row = clamp(cursor.row + dy, 0, doc.instrument.strings.length - 1);
    if (dy < 0 && cursor.row === 0 && cursor.row + dy < 0) {
      // no-op
    }
  }
  render();
}

function focusStrumLane() {
  commitDigitBuffer();
  cursor.lane = 'strum';
  render();
}

function focusTabLane() {
  commitDigitBuffer();
  cursor.lane = 'tab';
  render();
}

function canvasToCell(mx, my) {
  // Use same layout metrics as render
  const cssWidth = canvas.clientWidth;
  const marginL = 54;
  const marginT = 18;
  const rowH = 34;
  const laneGap = 14;
  const strumH = 30;
  const titleH = 18;

  const tabRows = doc.instrument.strings.length;
  const showNoteBoard = (doc.view.notesMode === 'board');

  const yStrumTop = marginT;
  const yTabTop = yStrumTop + strumH + laneGap;
  const yNoteHeader = yTabTop + tabRows * rowH + laneGap;
  const yNoteTop = yNoteHeader + titleH;

  const { widths: colPx } = buildColumnPixelWidths(18);
  const visible = computeVisibleColumns(colPx, cssWidth - marginL - 18);

  // Determine column
  if (mx < marginL) return null;
  let x = marginL;
  let col = null;
  for (let c = visible.start; c < visible.end; c++) {
    const w = colPx[c];
    if (mx >= x && mx < x + w) { col = c; break; }
    x += w;
  }
  if (col == null) return null;

  // Determine lane
  if (my >= yStrumTop && my < yStrumTop + strumH) {
    return { lane: 'strum', col };
  }

  if (my >= yTabTop && my < yTabTop + tabRows * rowH) {
    const row = Math.floor((my - yTabTop) / rowH);
    return { lane: 'tab', col, row: clamp(row, 0, tabRows - 1) };
  }

  if (showNoteBoard && my >= yNoteTop && my < yNoteTop + tabRows * rowH) {
    // note board is read-only; clicking it moves cursor to corresponding tab cell
    const row = Math.floor((my - yNoteTop) / rowH);
    return { lane: 'tab', col, row: clamp(row, 0, tabRows - 1) };
  }

  return null;
}

function showTooltipAt(x, y, html) {
  tooltip.style.left = `${x + 10}px`;
  tooltip.style.top = `${y + 10}px`;
  tooltip.innerHTML = html;
  tooltip.style.display = 'block';
}


function showTooltipForElement(el, html) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = Math.round(r.left + r.width * 0.25);
  const y = Math.round(r.top + r.height);
  showTooltipAt(x, y, html);
}
function hideTooltip() {
  tooltip.style.display = 'none';
  tooltip.innerHTML = '';
}

// Canvas events
canvas.addEventListener('mousedown', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = canvasToCell(mx, my);
  if (!hit) return;

  clearDigitBuffer();

  cursor.col = hit.col;
  if (hit.lane === 'strum') {
    cursor.lane = 'strum';
  } else {
    cursor.lane = 'tab';
    cursor.row = hit.row ?? 0;
  }
  render();
});

canvas.addEventListener('mousemove', (e) => {
  if (doc.view.notesMode !== 'hover') { hideTooltip(); return; }

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const hit = canvasToCell(mx, my);
  if (!hit || hit.lane !== 'tab') { hideTooltip(); return; }

  const s = doc.instrument.strings[hit.row];
  const info = deriveHoverNoteInfo(s, hit.col);
  if (!info) { hideTooltip(); return; }

  const prog = info.notes.length > 1 ? info.notes.join(' → ') : info.notes[0];
  const capo = clamp(parseInt(doc.capo.fret || 0, 10) || 0, 0, 12);
  const capoLine = capo > 0 ? `<div class="muted">Capo: ${capo} · Interpret: ${doc.view.notesInterpretation}</div>` : `<div class="muted">Interpret: ${doc.view.notesInterpretation}</div>`;

  showTooltipAt(mx, my, `
    <div><span class="mono">${s}</span> · <span class="mono">${info.token}</span></div>
    <div class="muted">Notes</div>
    <div class="mono">${prog}</div>
    ${capoLine}
  `);
});

canvas.addEventListener('mouseleave', () => hideTooltip());

// Keyboard events
window.addEventListener('keydown', (e) => {
  // Undo/redo
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y')) {
    e.preventDefault();
    redo();
    return;
  }

  // Mode toggles
  if (!e.ctrlKey && !e.metaKey) {
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault();
      commitDigitBuffer();
      chordStack = !chordStack;
      updateModeBadge();
      render();
      return;
    }
    if (e.key.toLowerCase() === 'i') {
      e.preventDefault();
      commitDigitBuffer();
      insertMode = !insertMode; // stub only
      updateModeBadge();
      render();
      return;
    }
  }

  // Navigation
  if (e.key === 'ArrowLeft') { e.preventDefault(); moveCursor(-1, 0); return; }
  if (e.key === 'ArrowRight') { e.preventDefault(); moveCursor(1, 0); return; }
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (cursor.lane === 'strum') {
      focusTabLane();
    } else {
      moveCursor(0, -1);
    }
    return;
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (cursor.lane === 'tab' && cursor.row === doc.instrument.strings.length - 1) {
      // keep within tab
      moveCursor(0, 0);
    } else {
      moveCursor(0, 1);
    }
    return;
  }

  if (e.key === 'Tab') {
    e.preventDefault();
    commitDigitBuffer();
    cursor.col = clamp(cursor.col + (e.shiftKey ? -1 : 1), 0, doc.columns.length - 1);
    render();
    return;
  }

  if (e.key === 'Enter') {
    e.preventDefault();
    commitDigitBuffer();
    if (cursor.lane === 'tab') {
      cursor.row = clamp(cursor.row + (e.shiftKey ? -1 : 1), 0, doc.instrument.strings.length - 1);
      render();
    }
    return;
  }

  // Backspace: prevent browser history navigation while editing, but do not erase.
  if (e.key === 'Backspace') {
    e.preventDefault();
    clearDigitBuffer();
    return;
  }

  // Delete: erase the current selection.
  if (e.key === 'Delete') {
    e.preventDefault();
    clearDigitBuffer();
    clearCell();
    return;
  }

  // Lane jumps
  if (e.key === 'Escape') {
    e.preventDefault();
    clearDigitBuffer();
    hideTooltip();
    return;
  }

  // Strum shortcuts (when in strum lane, or always if user types uppercase)
  if (e.key.toLowerCase() === 'd') {
    e.preventDefault();
    clearDigitBuffer();
    if (cursor.lane !== 'strum') focusStrumLane();
    applyToken('↓');
    return;
  }
  if (e.key.toLowerCase() === 'u') {
    e.preventDefault();
    clearDigitBuffer();
    if (cursor.lane !== 'strum') focusStrumLane();
    applyToken('↑');
    return;
  }
  if (e.key.toLowerCase() === 'x' && cursor.lane === 'strum') {
    e.preventDefault();
    clearDigitBuffer();
    applyToken('x');
    return;
  }

  // If typing in tab lane
  if (cursor.lane === 'tab') {
    // Digits: buffer to allow multi-digit frets
    if (/^\d$/.test(e.key)) {
      e.preventDefault();
      digitBuffer += e.key;
      // cap to 2 digits for sanity in v1
      if (digitBuffer.length >= 2) {
        commitDigitBuffer();
      } else {
        scheduleDigitCommit();
        render();
      }
      return;
    }

    // Common tab symbols (single char)
    const sym = e.key;
    const allowed = new Set(['h','p','/','\\','b','~']);
    if (allowed.has(sym)) {
      e.preventDefault();
      commitDigitBuffer();
      applyToken(sym);
      return;
    }

    // Allow single-letter tokens (e.g., 'x' mute) as tab token
    if (/^[a-zA-Z]$/.test(sym)) {
      // Only if not captured by strum shortcuts
      if (sym.toLowerCase() === 'x') {
        e.preventDefault();
        commitDigitBuffer();
        applyToken('x');
        return;
      }
    }
  }
});

// -------------------------
// Buttons + UI wiring
// -------------------------
function setDocView(key, value) {
  pushHistory();
  doc.view[key] = value;
  render();
}

notesModeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSegActive(notesModeSeg, b.dataset.mode);
  setDocView('notesMode', b.dataset.mode);
});

notesInterpretSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  setSegActive(notesInterpretSeg, b.dataset.mode);
  setDocView('notesInterpretation', b.dataset.mode);
});

chordsModeSeg.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const next = b.dataset.mode;
  setSegActive(chordsModeSeg, next);
  setDocView('chordsMode', next);
});

// Control hover tooltips (subtle, always available)
// Notes
if (notesModeSeg) {
  const off = notesModeSeg.querySelector('button[data-mode="off"]');
  const hov = notesModeSeg.querySelector('button[data-mode="hover"]');
  const board = notesModeSeg.querySelector('button[data-mode="board"]');
  attachUiTip(off, 'Notes: Off — hide note names.');
  attachUiTip(hov, 'Notes: Hover — show note names on hover.');
  attachUiTip(board, 'Notes: Board — show the Note Board under the tab.');
}

// Interpret
if (notesInterpretSeg) {
  const fingered = notesInterpretSeg.querySelector('button[data-mode="fingered"]');
  const sounding = notesInterpretSeg.querySelector('button[data-mode="sounding"]');
  attachUiTip(fingered, 'Fingered — notes reflect the frets you entered (ignores capo).');
  attachUiTip(sounding, 'Sounding — notes include capo (pitch is what you actually hear).');
}

// Chords
if (chordsModeSeg) {
  const off = chordsModeSeg.querySelector('button[data-mode="off"]');
  const hov = chordsModeSeg.querySelector('button[data-mode="hover"]');
  attachUiTip(off, 'Chords: Off — hide chord labels.');
  attachUiTip(hov, 'Chords: Hover — infer chord labels from notes in each column (WIP).');
}

// Capo
attachUiTip(capoInput, 'Capo affects Sounding notes and chord inference.');

instrumentSelect.addEventListener('change', () => {
  const type = instrumentSelect.value;
  populateTuningSelect();
  const tn = Object.keys(TUNINGS[type])[0];
  tuningSelect.value = tn;
  applyInstrumentAndTuning(type, tn);
});

tuningSelect.addEventListener('change', () => {
  applyInstrumentAndTuning(instrumentSelect.value, tuningSelect.value);
});

capoInput.addEventListener('change', () => {
  pushHistory();
  doc.capo.fret = clamp(parseInt(capoInput.value || '0', 10) || 0, 0, 12);
  render();
});

newBtn.addEventListener('click', () => {
  if (!confirm('Start a new Tabd project? (Current work will be lost unless saved)')) return;
  history = [];
  future = [];
  doc = newDoc(instrumentSelect.value);
  cursor = { lane:'tab', row:0, col:0 };
  chordStack = false;
  insertMode = false;
  syncControlsFromDoc();
  render();
});

saveBtn.addEventListener('click', () => {
  // Ensure version metadata is present
  if (!doc.tabd) {
    doc.tabd = { appVersion: APP_VERSION, formatVersion: APP_FORMAT_VERSION, minAppVersion: '1.0.0', createdUtc: new Date().toISOString() };
  }
  doc.tabd.appVersion = APP_VERSION;
  doc.tabd.formatVersion = APP_FORMAT_VERSION;
  doc.tabd.modifiedUtc = new Date().toISOString();

  const name = (doc.meta.title || 'untitled').replace(/[^a-z0-9_-]+/gi, '_');
  const filename = `${name}.tabd`;
  downloadText(filename, JSON.stringify(doc, null, 2), 'application/json');
});

openBtn.addEventListener('click', () => {
  openFile.click();
});

openFile.addEventListener('change', async () => {
  const file = openFile.files && openFile.files[0];
  if (!file) return;
  try {
    const text = await readFileAsText(file);
    const parsed = JSON.parse(text);

    // Basic validation
    if (!parsed || parsed.format !== 'TabdProject') throw new Error('Not a Tabd project file.');

    // Version compatibility check (non-blocking; prevents silent corruption)
    const minReq = parsed.tabd && parsed.tabd.minAppVersion ? String(parsed.tabd.minAppVersion) : null;
    if (minReq) {
      const cmp = (a,b) => {
        const pa = a.split('.').map(n=>parseInt(n,10)||0);
        const pb = b.split('.').map(n=>parseInt(n,10)||0);
        for (let i=0;i<3;i++){
          if (pa[i] > pb[i]) return 1;
          if (pa[i] < pb[i]) return -1;
        }
        return 0;
      };
      if (cmp(APP_VERSION, minReq) < 0) {
        throw new Error(`This project requires Tabd v${minReq} or later.`);
      }
    }

    doc = parsed;
    history = [];
    future = [];
    cursor = { lane:'tab', row:0, col:0 };
    chordStack = false;
    insertMode = false;

    syncControlsFromDoc();
    render();
  } catch (err) {
    alert('Open failed: ' + (err && err.message ? err.message : String(err)));
  } finally {
    openFile.value = '';
  }
});

addColsBtn.addEventListener('click', () => {
  pushHistory();
  const prevLen = doc.columns.length;
  for (let i = 0; i < 16; i++) {
    doc.columns.push({ notes: {}, strum: '' });
  }
  // Jump cursor to the first newly added column so the user immediately sees the extension.
  cursor.col = prevLen;
  cursor.col = clamp(cursor.col, 0, doc.columns.length - 1);
  render();

  // Ensure the new columns are visible in the horizontal scroll region.
  if (canvasWrap) {
    // Scroll to show the cursor column near the right side.
    const targetX = colStartX(buildColumnPixelWidths(18).widths, cursor.col, 54);
    const viewLeft = canvasWrap.scrollLeft;
    const viewW = canvasWrap.clientWidth;
    const pad = 80;
    if (targetX > viewLeft + viewW - pad) canvasWrap.scrollLeft = Math.max(0, targetX - (viewW - pad));
  }
});

exportBtn.addEventListener('click', () => {
  const ascii = exportAscii();
  const name = (doc.meta.title || 'untitled').replace(/[^a-z0-9_-]+/gi, '_');
  downloadText(`${name}.txt`, ascii, 'text/plain');
});

function exportAscii() {
  // Compute column widths in chars based on max token length (strum + notes). No leading zeros.
  const widths = doc.columns.map((_, i) => {
    const w = colCharWidth(i);
    return w;
  });

  // Optional strum line
  const hasStrum = doc.columns.some(c => (c.strum || '').trim() !== '');

  const lines = [];
  if (hasStrum) {
    let s = '    '; // left padding to roughly align above strings
    for (let i = 0; i < doc.columns.length; i++) {
      const tok = (doc.columns[i].strum || '').trim();
      s += padToken(tok, widths[i]);
    }
    lines.push(s);
  }

  for (const stringLabel of doc.instrument.strings) {
    let line = `${stringLabel}|`;
    for (let i = 0; i < doc.columns.length; i++) {
      const tok = (doc.columns[i].notes[stringLabel] || '').trim();
      line += padToken(tok, widths[i]);
    }
    line += '|';
    lines.push(line);
  }

  // Capo header (optional) goes at top
  const capo = clamp(parseInt(doc.capo.fret || 0, 10) || 0, 0, 12);
  if (capo > 0) {
    const mode = doc.capo.mode || 'relative';
    lines.unshift(`Capo ${capo} (${mode} frets)`, '');
  }

  return lines.join('\n');
}

function padToken(tok, width) {
  // width in chars. Fill the rest with dashes.
  const t = tok || '';
  const pad = Math.max(0, width - t.length);
  return t + '-'.repeat(pad);
}

// Initial UI setup
function themeLabel(theme) {
  return theme === "paper" ? "Cream" : "Slate";
}

function applyTheme(theme, persist=true) {
  const t = (theme === "paper") ? "paper" : "slate";
  document.body.dataset.theme = t;
  if (themeNameEl) themeNameEl.textContent = themeLabel(t);
  if (subtitleEl) subtitleEl.textContent = `${themeLabel(t)} · v${APP_VERSION}`;
  if (footerMetaEl) footerMetaEl.textContent = `Tabd v${APP_VERSION} · © 2026 TaoTech LLC`;
  if (persist) {
    try { localStorage.setItem(LS_THEME, t); } catch (_) {}
  }
}

function closeThemeMenu() {
  if (!themeMenu) return;
  themeMenu.hidden = true;
  if (themeBtn) themeBtn.setAttribute("aria-expanded", "false");
}

function openThemeMenu() {
  if (!themeMenu) return;
  themeMenu.hidden = false;
  // Position near the Theme button, flipping above if near the bottom.
  try {
    const r = themeBtn?.getBoundingClientRect();
    if (r) {
      const pad = 8;
      // ensure layout is available
      const w = themeMenu.offsetWidth;
      const h = themeMenu.offsetHeight;

      let left = r.left;
      left = Math.max(pad, Math.min(left, window.innerWidth - w - pad));

      const spaceBelow = window.innerHeight - r.bottom;
      const spaceAbove = r.top;
      let top = (spaceBelow >= h + pad) ? (r.bottom + pad) : (r.top - h - pad);
      if (spaceAbove < h + pad && spaceBelow < h + pad) {
        top = Math.max(pad, Math.min(r.bottom + pad, window.innerHeight - h - pad));
      }

      themeMenu.style.left = `${left}px`;
      themeMenu.style.top = `${top}px`;
    }
  } catch (_) {}
  if (themeBtn) themeBtn.setAttribute("aria-expanded", "true");
}

if (themeBtn && themeMenu) {
  themeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (themeMenu.hidden) openThemeMenu();
    else closeThemeMenu();
  });

  themeMenu.addEventListener("click", (e) => {
    const btn = e.target.closest(".themeItem");
    if (!btn) return;
    const t = btn.getAttribute("data-theme");
    applyTheme(t, true);
    closeThemeMenu();
    render();
  });

  document.addEventListener("click", () => closeThemeMenu());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeThemeMenu();
  });
}

// -------------------------
// About modal behavior
// -------------------------
function openAbout() {
  if (!aboutModal) return;
  aboutModal.hidden = false;
  aboutModal.setAttribute('aria-hidden', 'false');
  // focus close for accessibility
  if (aboutClose) aboutClose.focus();
}

function closeAbout() {
  if (!aboutModal) return;
  aboutModal.hidden = true;
  aboutModal.setAttribute('aria-hidden', 'true');
  if (aboutBtn) aboutBtn.focus();
}

if (aboutBtn && aboutModal) {
  aboutBtn.addEventListener('click', (e) => {
    e.preventDefault();
    // Toggle so repeated clicks behave predictably.
    if (aboutModal.hidden) openAbout();
    else closeAbout();
  });

  // Close on backdrop click (robust; avoids relying on event bubbling/closest).
  const aboutBackdrop = aboutModal.querySelector('.modalBackdrop');
  if (aboutBackdrop) {
    aboutBackdrop.addEventListener('click', (e) => {
      e.preventDefault();
      closeAbout();
    });
  }
}

if (aboutClose) {
  aboutClose.addEventListener('click', (e) => {
    e.preventDefault();
    closeAbout();
  });
}

window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!aboutModal || aboutModal.hidden) return;
  e.preventDefault();
  closeAbout();
});

let initialTheme = APP_THEME_DEFAULT;
try {
  const saved = localStorage.getItem(LS_THEME);
  if (saved) initialTheme = saved;
} catch (_) {}
applyTheme(initialTheme, false);

populateTuningSelect();
syncControlsFromDoc();
updateModeBadge();

// Responsive redraw
window.addEventListener('resize', () => render());

render();

