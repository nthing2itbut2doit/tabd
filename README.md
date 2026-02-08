# Tabd

**Tabd** is a musician’s tablature editor focused on **fast, clean idea capture**.

It is intentionally tab-first, document-oriented, and playback-light.  
Tabs in Tabd are treated as **written musical documents**, not performances.

---

## Why Tabd exists

Writing tablature by hand is messy.  
Typing tabs in a word processor is cumbersome.

Many existing tab editors are powerful, but often **too feature-rich, modal, or complex** for the simple act of sitting with a guitar and getting ideas down quickly.

Tabd is straight to the point.

The goal is to sit with an instrument and record what you’re playing **as quickly and cleanly as possible** — even with one hand — without breaking musical flow.

---

## What Tabd can do

Tabd lets you write tablature and export it cleanly for reading or printing.

Beyond basic tab entry, Tabd provides tools to help you *see what you’re actually playing*, not just what feels familiar under your fingers.

### Core features

**Input**
- Click-to-cursor tab grid (guitar + bass)
- Multiple entries per column (chords)
- Strum direction lane (D / U / X)

**Musical insight**
- Note Board: displays the notes you’re playing in real time
- Two interpretation modes:
  - **Fingered** — what you physically play
  - **Sounding** — what is actually heard (capo-aware)
- Optional chord labels inferred **from notes**, not shapes

These tools can reveal moments where comfortable hand positions produce unexpected harmony — helping establish a key, stay grounded, or deviate intentionally.

**Output**
- Save and open `.tabd` project files
- Export standard ASCII `.txt` tablature

---

## What Tabd is (and isn’t)

**Tabd is:**
- a writing tool
- fast and minimal
- focused on clarity and musical truth

**Tabd is not:**
- a DAW
- a playback-first tab player
- a full transcription or notation suite

---

## Using Tabd

### Hosted version (recommended)
Use the live web app:
```
https://tabd.taotech.dev
```

### Run locally

**Option A: open directly**
- Open `index.html` in a modern browser

**Option B: local server (recommended for file access)**
From the folder containing `index.html`:
```sh
python -m http.server 8000
```
Then open:
```
http://localhost:8000
```

---

## Themes
Tabd includes two built-in themes:
- **Slate** (dark)
- **Cream** (light)

The theme selector is located in the footer.

---

## File formats

### `.tabd` project files
Tabd project files are JSON documents and include version metadata for forward compatibility:
- `tabd.appVersion`
- `tabd.formatVersion`
- `tabd.minAppVersion`

### `.txt` export
Plain ASCII tablature suitable for printing or sharing.

---

## Feedback & contact

Tabd is an evolving project.  
Thoughts, suggestions, or quality-of-life ideas are always welcome.

📧 **tabd@taotech.dev**

---

## About TaoTech

Tabd is one of several projects created by **TaoTech**, spanning a mix of practical tools, experiments, and occasionally silly ideas that keep our brains busy solving problems.

If you have a problem you wish had a simpler tool — or an idea you can’t shake — feel free to reach out:

📧 **projects@taotech.dev**

---

## Changelog
See `CHANGELOG.md`.
