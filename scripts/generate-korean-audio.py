"""Generate reusable Korean AI voice MP3 files for static GitHub Pages (MeloTTS, MIT)."""
import argparse
import json
import os
import subprocess
import tempfile
from pathlib import Path

DIALOGUE_VERSION = "v2"

def run(cmd):
    subprocess.run(cmd, check=True)

def synth_single(model, speaker_id, text, output, speed=1.0):
    with tempfile.TemporaryDirectory() as tmp:
        wav = Path(tmp) / "audio.wav"
        model.tts_to_file(text, speaker_id, str(wav), speed=speed)
        run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
             "-i",str(wav),"-ac","1","-ar","24000","-b:a","48k",str(output)])

def synth_dialogue(model, speaker_id, segments, output):
    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        normalized=[]
        for i,seg in enumerate(segments):
            raw=tmp/f"seg-{i}-raw.wav"
            norm=tmp/f"seg-{i}.wav"
            role=seg.get("speaker","neutral")
            # Same Korean neural speaker, but slightly different cadence makes turns
            # easier to distinguish without creating an artificial cartoon voice.
            speed=1.04 if role=="female" else (0.94 if role=="male" else 1.0)
            model.tts_to_file(seg["text"], speaker_id, str(raw), speed=speed)
            run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
                 "-i",str(raw),"-ac","1","-ar","24000","-c:a","pcm_s16le",str(norm)])
            normalized.append(norm)
        pause=tmp/"pause.wav"
        run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
             "-f","lavfi","-i","anullsrc=r=24000:cl=mono","-t","0.42",
             "-c:a","pcm_s16le",str(pause)])
        concat=tmp/"concat.txt"
        lines=[]
        for i,wav in enumerate(normalized):
            lines.append(f"file '{wav.as_posix()}'")
            if i < len(normalized)-1:
                lines.append(f"file '{pause.as_posix()}'")
        concat.write_text("\n".join(lines)+"\n",encoding="utf-8")
        run(["ffmpeg","-nostdin","-hide_banner","-loglevel","error","-y",
             "-f","concat","-safe","0","-i",str(concat),"-ac","1","-ar","24000",
             "-b:a","48k",str(output)])

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--input",default="/tmp/topik-korean-corpus.json")
    p.add_argument("--output",default="tts/ko")
    p.add_argument("--max-new",type=int,default=400)
    args=p.parse_args()
    if args.max_new<1:
        raise ValueError("--max-new must be positive")

    records=json.loads(Path(args.input).read_text(encoding="utf-8"))
    target=Path(args.output)
    target.mkdir(parents=True,exist_ok=True)
    dialogue_marker=target/f".dialogue-{DIALOGUE_VERSION}"
    refresh_dialogues=not dialogue_marker.exists()

    def needs_audio(r):
        out=target/(r["key"]+".mp3")
        return (r.get("kind")=="dialogue" and refresh_dialogues) or not out.exists()

    missing=[r for r in records if needs_audio(r)]
    to_generate=missing[:args.max_new]
    print(f"Corpus {len(records)}; missing {len(missing)}; generating {len(to_generate)} clips",flush=True)

    if to_generate:
        from melo.api import TTS
        model=TTS(language="KR",device="cpu")
        speaker=model.hps.data.spk2id["KR"]
        for index,r in enumerate(to_generate,1):
            output=target/(r["key"]+".mp3")
            if r.get("kind")=="dialogue" and r.get("segments"):
                synth_dialogue(model,speaker,r["segments"],output)
            else:
                synth_single(model,speaker,r["text"],output,1.0)
            if output.stat().st_size<100:
                raise RuntimeError(f"Empty audio: {output}")
            if index%10==0:
                print(f"Generated {index}/{len(to_generate)}",flush=True)

    dialogue_records=[r for r in records if r.get("kind")=="dialogue"]
    dialogue_ready=all((target/(r["key"]+".mp3")).exists() for r in dialogue_records)
    if dialogue_ready:
        dialogue_marker.write_text("speaker-separated dialogue audio "+DIALOGUE_VERSION+"\n",encoding="utf-8")

    keys=sorted(p.stem for p in target.glob("*.mp3"))
    manifest=Path("tts/manifest.js")
    manifest.parent.mkdir(parents=True,exist_ok=True)
    manifest.write_text("window.TOPIK_NEURAL_HASHES = "+json.dumps(keys,ensure_ascii=False)+";\n",encoding="utf-8")

    remaining=sum(1 for r in records if not (target/(r["key"]+".mp3")).exists())
    print(f"Audio available: {len(keys)}; listening ready: {sum((target/(r['key']+'.mp3')).exists() for r in dialogue_records)}/{len(dialogue_records)}; remaining in requested corpus: {remaining}",flush=True)
    github_env=os.environ.get("GITHUB_ENV")
    if github_env:
        with open(github_env,"a",encoding="utf-8") as env:
            env.write(f"TOPIK_AUDIO_REMAINING={remaining}\n")

if __name__=="__main__":
    main()
