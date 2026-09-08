#!/usr/bin/env python3
"""
PESU Academy Companion Converter
Converts PPT and PPTX presentations to high-fidelity PDF documents using:
1. Microsoft PowerPoint (via macOS AppleScript) if installed
2. LibreOffice / soffice if available
3. Runs either as a lightweight local HTTP server for the browser extension or as a batch CLI.
"""

import os
import sys
sys.dont_write_bytecode = True
import subprocess
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler
import json
import email

PORT = 8765

def detect_engine():
    """Detect available local conversion engine."""
    # Check for Microsoft PowerPoint on macOS
    if sys.platform == 'darwin' and os.path.exists('/Applications/Microsoft PowerPoint.app'):
        return 'powerpoint'
    
    # Check for LibreOffice / soffice
    try:
        subprocess.run(['soffice', '--version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return 'libreoffice'
    except Exception:
        pass

    try:
        subprocess.run(['libreoffice', '--version'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
        return 'libreoffice'
    except Exception:
        pass

    return None

def convert_with_powerpoint(pptx_path, output_pdf_path):
    """Convert PPT/PPTX to PDF via Microsoft PowerPoint AppleScript."""
    abs_in = os.path.abspath(pptx_path)
    abs_out = os.path.abspath(output_pdf_path)

    # AppleScript to open presentation in background, save as PDF, and close
    script = f'''
    tell application "Microsoft PowerPoint"
        activate
        open posix file "{abs_in}"
        set theDoc to active presentation
        save theDoc in posix file "{abs_out}" as save as PDF
        close theDoc saving no
    end tell
    '''
    res = subprocess.run(['osascript', '-e', script], capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"PowerPoint AppleScript error: {res.stderr}")
    if not os.path.exists(abs_out) or os.path.getsize(abs_out) == 0:
        raise RuntimeError(f"Output PDF file was not generated at {abs_out}")
    return abs_out

def convert_with_libreoffice(pptx_path, output_dir):
    """Convert PPT/PPTX to PDF via LibreOffice headless."""
    cmd = ['soffice', '--headless', '--convert-to', 'pdf', '--outdir', output_dir, pptx_path]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {res.stderr}")

    base = os.path.splitext(os.path.basename(pptx_path))[0]
    expected_pdf = os.path.join(output_dir, f"{base}.pdf")
    if not os.path.exists(expected_pdf):
        raise RuntimeError(f"Output PDF not found at {expected_pdf}")
    return expected_pdf

def convert_presentation(input_file, output_pdf):
    """Main conversion dispatcher."""
    engine = detect_engine()
    if not engine:
        raise RuntimeError("No local conversion engine found (Microsoft PowerPoint or LibreOffice required).")

    if engine == 'powerpoint':
        return convert_with_powerpoint(input_file, output_pdf)
    elif engine == 'libreoffice':
        outdir = os.path.dirname(os.path.abspath(output_pdf))
        return convert_with_libreoffice(input_file, outdir)

class ConversionHandler(BaseHTTPRequestHandler):
    def _send_cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors()
        self.end_headers()

    def do_GET(self):
        if self.path == '/ping':
            engine = detect_engine()
            engine_name = 'Microsoft PowerPoint (Native macOS)' if engine == 'powerpoint' else ('LibreOffice' if engine == 'libreoffice' else 'None')
            resp = json.dumps({'status': 'ok', 'engine': engine_name, 'available': bool(engine)}).encode('utf-8')
            self.send_response(200)
            self._send_cors()
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == '/convert':
            content_type = self.headers.get('content-type', '')
            if 'multipart/form-data' not in content_type:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'Expected multipart/form-data')
                return

            length = int(self.headers.get('content-length', 0))
            body = self.rfile.read(length)

            msg = email.message_from_bytes(f'Content-Type: {content_type}\r\n\r\n'.encode('utf-8') + body)
            file_data = None
            filename = 'presentation.pptx'

            for part in msg.walk():
                part_name = part.get_param('name', header='content-disposition')
                if part_name == 'file':
                    file_data = part.get_payload(decode=True)
                    part_fn = part.get_filename()
                    if part_fn:
                        filename = part_fn
                    break

            if not file_data:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'No file data uploaded')
                return

            with tempfile.TemporaryDirectory() as tmpdir:
                in_path = os.path.join(tmpdir, filename)
                out_path = os.path.join(tmpdir, 'presentation.pdf')
                with open(in_path, 'wb') as f:
                    f.write(file_data)

                try:
                    convert_presentation(in_path, out_path)
                    with open(out_path, 'rb') as f:
                        pdf_bytes = f.read()

                    self.send_response(200)
                    self._send_cors()
                    self.send_header('Content-Type', 'application/pdf')
                    self.send_header('Content-Length', str(len(pdf_bytes)))
                    self.end_headers()
                    self.wfile.write(pdf_bytes)
                except Exception as e:
                    err_msg = str(e).encode('utf-8')
                    self.send_response(500)
                    self._send_cors()
                    self.send_header('Content-Type', 'text/plain')
                    self.send_header('Content-Length', str(len(err_msg)))
                    self.end_headers()
                    self.wfile.write(err_msg)
        else:
            self.send_response(404)
            self.end_headers()

def run_server():
    engine = detect_engine()
    engine_name = 'Microsoft PowerPoint' if engine == 'powerpoint' else ('LibreOffice' if engine == 'libreoffice' else 'None (Fallback mode)')
    print(f"🚀 PESU Academy Local Companion Converter running on http://127.0.0.1:{PORT}")
    print(f"   Detected engine: {engine_name}")
    server = HTTPServer(('127.0.0.1', PORT), ConversionHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping local companion converter.")

if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] != 'serve':
        target = sys.argv[1]
        if os.path.isfile(target):
            out = os.path.splitext(target)[0] + '.pdf'
            print(f"Converting {target} -> {out}...")
            convert_presentation(target, out)
            print("Done!")
        else:
            print(f"File not found: {target}")
    else:
        run_server()
