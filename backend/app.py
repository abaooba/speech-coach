"""FastAPI entry point. Serves the API and the static frontend."""

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

load_dotenv()

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Speech Coach")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Mounted last so /api routes take priority.
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
