"""python -m rotoanime run INPUT.mov -o out.mp4 --duration 3"""
import argparse, shutil, sys, tempfile
from pathlib import Path

from . import video
from .convert import convert
from .pipeline import DEFAULT


def _fmt_probe(i):
    return "\n".join([
        f"  コーデック : {i['codec']}  ({i['pix_fmt']})",
        f"  解像度     : {i['width']}x{i['height']}  (回転メタデータ {i['rotation']}度を適用後)",
        f"  fps        : r={i['r_fps']:.3f} / avg={i['avg_fps']:.3f}"
        f"{'  ← VFR。CFRへ正規化して展開する' if i['is_vfr'] else '  (CFR)'}",
        f"  色         : transfer={i['color_transfer'] or '不明'}"
        f"{'  ← HDR。SDRへトーンマップする' if i['is_hdr'] else '  (SDR)'}",
        f"  長さ / 音声: {i['duration']:.2f}秒 / {'あり' if i['has_audio'] else 'なし'}",
    ])


def main(argv=None):
    ap = argparse.ArgumentParser(prog="rotoanime", description="実写動画をセル画調に変換する")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("probe", help="素材を検査するだけ")
    p.add_argument("input")

    r = sub.add_parser("run", help="変換して mp4 に書き出す")
    r.add_argument("input")
    r.add_argument("-o", "--output", default="out.mp4")
    r.add_argument("--start", type=float, default=None, help="開始秒")
    r.add_argument("--duration", type=float, default=None,
                   help="処理する秒数。まず 3 で試すこと")
    r.add_argument("--fps", type=float, default=None, help="既定は入力の fps")
    r.add_argument("--long-edge", type=int, default=1920, help="長辺の上限")
    r.add_argument("--debug", action="store_true", help="中間出力を out/debug に残す")
    r.add_argument("--keep-frames", action="store_true")
    for k, v in DEFAULT.items():
        r.add_argument(f"--{k.replace('_','-')}", type=type(v), default=None,
                       help=f"既定 {v}")

    a = ap.parse_args(argv)
    video.require_ffmpeg()
    info = video.probe(a.input)

    if a.cmd == "probe":
        print(f"{a.input}\n{_fmt_probe(info)}")
        return 0

    print(f"入力: {a.input}\n{_fmt_probe(info)}\n")
    fps = a.fps or round(info["avg_fps"], 3)
    cfg = {k: getattr(a, k) for k in DEFAULT if getattr(a, k, None) is not None}

    work = Path(tempfile.mkdtemp(prefix="rotoanime_"))
    try:
        print("展開中...", flush=True)
        frames = video.extract(a.input, work / "orig", fps, a.start, a.duration,
                               a.long_edge, info)
        audio = work / "audio.m4a"
        has_audio = info["has_audio"] and video.extract_audio(a.input, audio, a.start, a.duration)
        print(f"  {len(frames)}枚 / {fps}fps / 音声 {'あり' if has_audio else 'なし'}\n")

        def prog(i, n):
            if i % 10 == 0 or i == n:
                print(f"\r  変換 {i}/{n}", end="", flush=True)

        outdir = Path(a.output).with_suffix("") if a.keep_frames else work / "cel"
        debug = Path(a.output).parent / "debug" if a.debug else None
        stats = convert(frames, outdir, cfg, debug, prog)
        print()

        video.encode(outdir, a.output, fps, audio if has_audio else None)
        print(f"\n出力: {a.output}")
        print(f"  ちらつき指標  入力 {stats['flicker_in']:.5f} → 出力 {stats['flicker_out']:.5f}")
    finally:
        if not a.keep_frames:
            shutil.rmtree(work, ignore_errors=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
