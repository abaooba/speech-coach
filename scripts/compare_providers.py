"""Send one audio clip to Deepgram and AssemblyAI with filler words kept.

Prints the word list from each provider and a filler/pause summary so we
can decide which provider the app should use.

Usage: .venv/bin/python scripts/compare_providers.py samples/test-clip.m4a
"""

import os
import sys
import time

import httpx
from dotenv import load_dotenv

load_dotenv()

FILLERS = {"um", "uh", "uhm", "hmm", "mhmm", "like", "so", "basically", "actually"}
PAUSE_SECONDS = 1.5


def deepgram(path: str) -> list[dict]:
    key = os.environ["DEEPGRAM_API_KEY"]
    with open(path, "rb") as f:
        audio = f.read()
    for model in ("nova-3", "nova-2"):
        r = httpx.post(
            "https://api.deepgram.com/v1/listen",
            params={"model": model, "filler_words": "true", "punctuate": "true"},
            headers={"Authorization": f"Token {key}", "Content-Type": "audio/mp4"},
            content=audio,
            timeout=120,
        )
        if r.status_code == 200:
            print(f"[deepgram] model={model}")
            words = r.json()["results"]["channels"][0]["alternatives"][0]["words"]
            return [{"text": w["word"], "start": w["start"], "end": w["end"]} for w in words]
        print(f"[deepgram] model={model} failed: {r.status_code} {r.text[:200]}")
    return []


def assemblyai(path: str) -> list[dict]:
    key = os.environ["ASSEMBLYAI_API_KEY"]
    headers = {"authorization": key}
    with open(path, "rb") as f:
        up = httpx.post("https://api.assemblyai.com/v2/upload", headers=headers, content=f.read(), timeout=120)
    up.raise_for_status()
    audio_url = up.json()["upload_url"]
    job = httpx.post(
        "https://api.assemblyai.com/v2/transcript",
        headers=headers,
        json={"audio_url": audio_url, "disfluencies": True},
        timeout=60,
    )
    job.raise_for_status()
    tid = job.json()["id"]
    while True:
        r = httpx.get(f"https://api.assemblyai.com/v2/transcript/{tid}", headers=headers, timeout=60).json()
        if r["status"] == "completed":
            return [{"text": w["text"], "start": w["start"] / 1000, "end": w["end"] / 1000} for w in r["words"]]
        if r["status"] == "error":
            print(f"[assemblyai] error: {r.get('error')}")
            return []
        time.sleep(2)


def summarize(name: str, words: list[dict]) -> None:
    print(f"\n=== {name}: {len(words)} words ===")
    print(" ".join(w["text"] for w in words))
    norm = [w["text"].lower().strip(".,?!") for w in words]
    counts = {f: norm.count(f) for f in FILLERS if norm.count(f)}
    print(f"fillers: {counts}")
    repeats = [norm[i] for i in range(1, len(norm)) if norm[i] == norm[i - 1]]
    print(f"immediate repeats: {repeats}")
    pauses = [
        (round(words[i - 1]["end"], 2), round(words[i]["start"] - words[i - 1]["end"], 2))
        for i in range(1, len(words))
        if words[i]["start"] - words[i - 1]["end"] >= PAUSE_SECONDS
    ]
    print(f"pauses >= {PAUSE_SECONDS}s (at, length): {pauses}")
    if words:
        dur = words[-1]["end"] - words[0]["start"]
        print(f"duration {dur:.1f}s, wpm {len(words) / dur * 60:.0f}")


if __name__ == "__main__":
    clip = sys.argv[1]
    summarize("Deepgram", deepgram(clip))
    summarize("AssemblyAI", assemblyai(clip))
