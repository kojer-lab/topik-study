"""Generate reusable Korean AI voice MP3 files for static GitHub Pages (MeloTTS, MIT)."""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--input", default="/tmp/topik-korean-corpus.json")
    p.add_argument("--output", default="tts/ko")
    args = p.parse_args()
    sentences = json.loads(Path(args.input).read_text(encoding="utf-8"))
    target = Path(args.output)
    target.mkdir(parents=True, exist_ok=True)
    missing = [(r["key"], r["text"]) for r in sentences if not (target / (r["key"] + ".mp3")).exists()]
    print(f"Corpus {len(sentences)}; generating {len(missing)} missing files", flush=True)
    if missing:
        from melo.api import TTS
        model = TTS(language="KR", device="cpu")
        speaker = model.hps.data.spk2id["KR"]
        for index,(key,text) in enumerate(missing,1):
            output = target / (key + ".mp3")
            with tempfile.TemporaryDirectory() as tmp:
                wav = Path(tmp)/"audio.wav"
                model.tts_to_file(text, speaker, str(wav), speed=1.0)
                subprocess.run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error",
                                "-y","-i",str(wav),"-ac","1","-ar","24000",
                                "-b:a","48k",str(output)],check=True)
            if output.stat().st_size < 100:
                raise RuntimeError(f"Empty audio: {output}")
            if index % 10 == 0: print(f"Generated {index}/{len(missing)}",flush=True)
    keys = sorted(p.stem for p in target.glob("*.mp3"))
    manifest = Path("tts/manifest.js")
    manifest.parent.mkdir(parents=True,exist_ok=True)
    manifest.write_text("window.TOPIK_NEURAL_HASHES = " + json.dumps(keys, ensure_ascii=False) + ";\n",encoding="utf-8")
    print(f"Audio available: {len(keys)} / roughly 4500 vocabulary audio items",flush=True)

if __name__ == "__main__":
    main()
