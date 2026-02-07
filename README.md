# Tabd v1.4.0 (Slate + Cream)

Tabd is a **tab-first** editor built for **fast idea capture**. It prioritizes writing clarity over playback and heavy features.

## Run
### Option A: open directly
Open `index.html` in a modern browser.

### Option B (recommended): local server
From the folder containing `index.html`:
- `python -m http.server 8000`
Then open:
- `http://localhost:8000`

## Key features
- Click-to-cursor tab grid (guitar + bass)
- Multiple entries per column (chords)
- Strum direction lane (D/U/X)
- Notes display: Off / Hover / Board
- Interpret: **Fingered** vs **Sounding** (capo-aware)
- Chords (optional): labels are **inferred from notes**
- Save/Open `.tabd` projects
- Export ASCII `.txt`

## Notes, chords, and “truth”
Chord labels are inferred from the notes in each column. This can reveal moments where familiar shapes produce unexpected harmony.

Hover hint:
- **Fingered:** what you’re playing  
- **Sounding:** what’s actually heard

## Themes
Use the **Theme** selector in the bottom-left footer:
- Slate (dark)
- Cream (light)

## File formats
### Project: `.tabd`
Tabd project files are JSON and include version metadata:
- `tabd.appVersion`
- `tabd.formatVersion`
- `tabd.minAppVersion`

### Export: `.txt`
Standard ASCII tab.

## Changelog
See `CHANGELOG.md`.
