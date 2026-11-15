# PesUGuide - Academic Course Materials Organizer

[![GitHub Release](https://img.shields.io/github/v/release/PixelAlgorithm/PesuGuide?style=for-the-badge&color=6366f1&logo=github)](https://github.com/PixelAlgorithm/PesuGuide/releases/latest)
[![Vibe Coded](https://img.shields.io/badge/Vibe%20Coded-100%25-818cf8?style=for-the-badge)](https://github.com/PixelAlgorithm/PesuGuide)
[![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-Manifest%20v3-38bdf8?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/PixelAlgorithm/PesuGuide)

> ⚡ **A vibe coded app** built for PESU Academy students.

A vibe coded Google Chrome browser extension designed for **PESU Academy** (`https://www.pesuacademy.com`) to effortlessly automate discovering, downloading, organizing, converting (PPT/PPTX to PDF), and merging all course materials available under the **Slides** option. Pure vibes, zero friction, maximum productivity.

---

## 🌟 Key Features

1. **Native Session Integration**:
   - Works seamlessly with your existing, authenticated PESU Academy session.
   - **Zero credential handling**: Your username, password, OTP, and CAPTCHA stay securely in the browser. Credentials are never logged, stored, or transmitted anywhere.

2. **Full Course & Unit Discovery**:
   - Automatically detects all available semesters (`Sem-5`, `Sem-4`, `Sem-3`, etc.).
   - Discovers all enrolled subjects/courses.
   - Automatically parses unit tabs, class schedules, and all files listed in the **Slides** column.
   - Robust against dynamic AJAX loading, pagination, and multi-class units.

3. **Intelligent File Conversion**:
   - **PDFs**: Kept in original PDF format.
   - **PPT / PPTX**: Automatically converted to PDF.
   - Dual conversion modes:
     - **Built-in Client-side JS Engine**: Runs 100% inside the browser using `JSZip` and `pdf-lib` without needing any external software installed.
     - **Local High-Fidelity Companion**: Optional Python/AppleScript microservice (`local_converter.py`) utilizing macOS **Microsoft PowerPoint.app** or **LibreOffice** for 100% native vector quality.

4. **Unit-Wise Organization & PDF Merging**:
   - Saves individual slides neatly organized by course and unit:
     ```
     ~/Downloads/PESU Academy/
     └── UE24CS341A - Software Engineering/
         ├── Unit 1/
         │   ├── Slide 01 - Class Mechanics.pdf
         │   ├── Slide 02 - Introduction.pdf
         │   └── ...
         ├── Unit 2/
         │   ├── Slide 01 - Agile.pdf
         │   └── ...
         ├── Unit 1.pdf    <-- Complete merged PDF of all Unit 1 slides in order
         ├── Unit 2.pdf    <-- Complete merged PDF of all Unit 2 slides in order
         └── ...
     ```
   - All merged PDFs preserve the exact visual ordering as presented on PESU Academy.

5. **Notes + Slides, Including Link Items**:
   - Tick **Notes** next to **Slides** to download both in one run (`notes/unit_x/` inside the ZIP).
   - "Link" rows on PESU Academy (the chain-link items that download a PDF/PPT when clicked) are followed automatically: download endpoints, redirects, viewer/iframe wrapper pages and Google Drive links are resolved to the real file.
   - File type is detected from the file itself. PDFs stay PDFs, PPT/PPTX become PDFs, and anything else (DOCX, TXT, images) is kept in its original format. If a presentation can't be converted, the original is saved instead of failing.

6. **Automatic Update Checks**:
   - The extension checks GitHub Releases every 6 hours in the background, shows a **NEW** badge on the toolbar icon, and sends one notification per release.
   - The popup footer shows the last check and a **Check now** button; the banner downloads the release ZIP for you.

7. **Multi-Course Queue & Packaging Modes**:
   - Queue multiple subjects or process an entire semester in one go.
   - Choose between **Single Organized ZIP** (1-click download), **Merged Unit PDFs Only**, or **Direct Slide Folders**.
   - Remembers previously downloaded files to avoid redundant downloads.
   - Graceful **Cancel / Stop** button and detailed summary modal upon completion.

---

## 📦 Installation & Setup

### Option A: Quick Install via Release ZIP (Recommended)

1. Download the latest **[PesUGuide-v1.0.0.zip](https://github.com/PixelAlgorithm/PesuGuide/releases/latest)** from the Releases section.
2. Extract the ZIP file on your computer.
3. Open **Google Chrome** and navigate to:
   ```
   chrome://extensions/
   ```
4. Toggle on **Developer mode** in the top-right corner.
5. Click the **Load unpacked** button in the top-left corner.
6. Select the unzipped `PesUGuide` folder.
7. **PesUGuide** is now installed! Pin it in the Chrome toolbar for quick access.

---

### Option B: Clone from GitHub (For Developers)

1. Clone the repository:
   ```bash
   git clone https://github.com/PixelAlgorithm/PesuGuide.git
   ```
2. Open Chrome and go to `chrome://extensions/`.
3. Enable **Developer mode** in the top right.
4. Click **Load unpacked** and choose the cloned repository folder.

---

### Step 2: (Optional) High-Fidelity PowerPoint Companion

The extension works completely standalone using its built-in JavaScript conversion engine.

If you want **100% native Microsoft Office vector fidelity** when converting PPT/PPTX presentations on macOS, run the local companion:

```bash
cd /path/to/PesuGuide
python3 local_converter.py
```
*It automatically connects to your installed `/Applications/Microsoft PowerPoint.app` on macOS! The extension popup will show a purple badge: `⚡ Microsoft PowerPoint (Native macOS)`.*

---

## 🚀 How to Use

1. Navigate to **[PESU Academy](https://www.pesuacademy.com/Academy/)** in Google Chrome.
2. Sign in with your student credentials.
3. Click the **PesUGuide** extension icon in Chrome toolbar.
4. In the popup:
   - Verify the status badge says **Connected** (green).
   - Select your **Semester** (e.g. `Sem-5`).
   - Select a specific **Course / Subject** or check **Process All Courses**.
   - Check/uncheck the specific **Units** you wish to download.
   - Choose whether to generate merged **Unit X.pdf** and individual slide files.
   - Click **Start Download**.
5. Watch the live progress bar, file status, and activity log.
6. Once completed, click **Open Output Folder** to view your neatly organized materials in Finder!

---

## 🛠️ Project Structure

```
PesuGuide/
├── manifest.json          # Chrome MV3 Extension Manifest
├── rules.json             # DeclarativeNetRequest CORS rules
├── popup.html             # Sleek extension user interface
├── popup.css              # Dark mode styling & micro-animations
├── popup.js               # Popup event handler & UI coordination
├── background.js          # Background service worker & download interceptor
├── content.js             # Session bridge for PESU Academy DOM
├── offscreen.html         # Offscreen document for async processing
├── offscreen.js           # Offscreen processing worker
├── local_converter.py     # Optional PowerPoint / LibreOffice companion
├── lib/
│   ├── pdf-lib.min.js     # Client-side PDF manipulation & merging
│   └── jszip.min.js       # Client-side PPTX decompression
└── src/
    ├── config.js          # PESU Academy selectors & API endpoints
    ├── idb-helper.js      # IndexedDB cache helper
    ├── pesu-scraper.js    # API discovery for courses, units, and slides
    ├── pptx-converter.js  # Dual-mode PPTX -> PDF converter
    ├── pdf-merger.js      # Unit-wise PDF merger
    └── orchestrator.js    # Download queue & execution manager
```

---

<p align="center">
  A vibe coded app • made by <a href="https://github.com/PixelAlgorithm"><strong>PixelAlgorithm</strong></a>
</p>
