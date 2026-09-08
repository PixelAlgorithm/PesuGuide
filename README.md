# PESU Academy Course Materials Downloader & Organizer

A powerful Google Chrome browser extension and tool designed for **PESU Academy** (`https://www.pesuacademy.com`) to automate discovering, downloading, organizing, converting (PPT/PPTX to PDF), and merging all course materials available under the **Slides** option.

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

5. **Reliability & Idempotency**:
   - Remembers previously downloaded files to avoid redundant downloads.
   - Safely resume interrupted downloads.
   - Clean **Cancel / Stop** button that halts gracefully without corrupting completed files.
   - Comprehensive summary modal at the end with download/conversion/merging counts and detailed error logs.

---

## 📦 Installation & Setup

### Step 1: Load the Extension into Google Chrome

1. Open **Google Chrome**.
2. In the URL bar, go to: `chrome://extensions/`
3. Toggle on **Developer mode** in the top right corner.
4. Click the **Load unpacked** button in the top left.
5. In the file picker, select this project directory:
   ```
   /Users/prajwalm/Desktop/pesi
   ```
6. The extension **PESU Academy Course Downloader & Organizer** is now installed and active!

*(Tip: Click the Puzzle icon in Chrome's toolbar and pin the PESU Downloader icon for quick access.)*

---

### Step 2: (Optional) High-Fidelity PowerPoint Companion

The extension works completely on its own using the built-in JavaScript conversion engine. 

If you want **100% native Microsoft Office vector fidelity** when converting PPT/PPTX presentations, launch the local companion converter:

```bash
cd /Users/prajwalm/Desktop/pesi
python3 local_converter.py
```
*It automatically connects to your installed `/Applications/Microsoft PowerPoint.app` on macOS! The extension popup will show a purple badge: `⚡ Microsoft PowerPoint (Native macOS)`.*

---

## 🚀 How to Use

1. Navigate to **[PESU Academy](https://www.pesuacademy.com/Academy/)** in Google Chrome.
2. Sign in with your username, password, or OTP.
3. Click the **PESU Downloader** extension icon in Chrome toolbar.
4. In the popup:
   - Verify the status badge says **Connected** (green).
   - Select your **Semester** (e.g. `Sem-5`).
   - Select a specific **Course / Subject** (e.g. `UE24CS341A - Software Engineering`) or check **Process All Courses**.
   - Check/uncheck the specific **Units** you wish to download (or keep all selected).
   - Choose whether to generate merged **Unit X.pdf** and individual slide files.
   - Click **Start Download**.
5. Watch the live progress bar, file status, and activity log.
6. Once completed, click **Open Output Folder** to view your neatly organized materials in Finder!

---

## 🛠️ Project Structure

```
pesi/
├── manifest.json          # Chrome MV3 Extension Manifest
├── rules.json             # DeclarativeNetRequest CORS rules
├── popup.html             # Sleek extension user interface
├── popup.css              # Dark mode styling & micro-animations
├── popup.js               # Popup event handler & UI coordination
├── background.js          # Background service worker
├── local_converter.py     # Local PowerPoint / LibreOffice conversion tool
├── lib/
│   ├── pdf-lib.min.js     # Client-side PDF manipulation & merging
│   └── jszip.min.js       # Client-side PPTX decompression
└── src/
    ├── config.js          # PESU Academy selectors & API endpoints
    ├── pesu-scraper.js    # API discovery for courses, units, and slides
    ├── pptx-converter.js  # Dual-mode PPTX -> PDF converter
    ├── pdf-merger.js      # Unit-wise PDF merger
    └── orchestrator.js    # Download queue & execution manager
```
