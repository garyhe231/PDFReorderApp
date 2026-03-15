import os
import json
import uuid
import shutil
from pathlib import Path
from typing import List

from fastapi import FastAPI, File, UploadFile, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from app.pdf_service import extract_page_numbers, reorder_pdf, render_page_thumbnail

BASE_DIR = Path(__file__).parent.parent
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
UPLOAD_DIR.mkdir(exist_ok=True)
OUTPUT_DIR.mkdir(exist_ok=True)

app = FastAPI(title="PDF Reorder App")
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "app" / "static")), name="static")
templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "templates"))


# ── In-memory session store ──────────────────────────────────────────────────
sessions: dict = {}


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files are accepted.")

    session_id = str(uuid.uuid4())
    upload_path = UPLOAD_DIR / f"{session_id}.pdf"

    with open(upload_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    pages = extract_page_numbers(str(upload_path))
    sessions[session_id] = {
        "filename": file.filename,
        "path": str(upload_path),
        "pages": pages,
    }

    return {
        "session_id": session_id,
        "filename": file.filename,
        "total_pages": len(pages),
        "pages": pages,
    }


@app.get("/thumbnail/{session_id}/{page_index}")
async def thumbnail(session_id: str, page_index: int):
    if session_id not in sessions:
        raise HTTPException(404, "Session not found.")
    session = sessions[session_id]
    pages = session["pages"]
    if page_index < 0 or page_index >= len(pages):
        raise HTTPException(404, "Page index out of range.")

    png = render_page_thumbnail(session["path"], page_index, width=180)
    from fastapi.responses import Response
    return Response(content=png, media_type="image/png")


class ReorderRequest(BaseModel):
    session_id: str
    order: List[int]  # 0-based page indices in desired output order


@app.post("/reorder")
async def reorder(req: ReorderRequest):
    if req.session_id not in sessions:
        raise HTTPException(404, "Session not found.")
    session = sessions[req.session_id]
    total = len(session["pages"])

    # Validate
    if sorted(req.order) != list(range(total)):
        raise HTTPException(400, f"order must be a permutation of 0..{total-1}")

    output_filename = f"reordered_{session['filename']}"
    output_path = OUTPUT_DIR / f"{req.session_id}_reordered.pdf"
    reorder_pdf(session["path"], req.order, str(output_path))

    return {"download_url": f"/download/{req.session_id}", "filename": output_filename}


@app.get("/download/{session_id}")
async def download(session_id: str):
    output_path = OUTPUT_DIR / f"{session_id}_reordered.pdf"
    if not output_path.exists():
        raise HTTPException(404, "Reordered file not found. Please reorder first.")
    session = sessions.get(session_id, {})
    filename = f"reordered_{session.get('filename', 'output.pdf')}"
    return FileResponse(str(output_path), media_type="application/pdf", filename=filename)


@app.delete("/session/{session_id}")
async def cleanup(session_id: str):
    for path in [UPLOAD_DIR / f"{session_id}.pdf",
                 OUTPUT_DIR / f"{session_id}_reordered.pdf"]:
        if path.exists():
            path.unlink()
    sessions.pop(session_id, None)
    return {"ok": True}
