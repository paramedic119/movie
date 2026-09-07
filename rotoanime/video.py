"""ffmpeg による入出力。iPhone 素材（HEVC / VFR / 回転メタデータ）を正規化する。"""
import json, subprocess, shutil
from pathlib import Path


def _run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(f"{cmd[0]} failed:\n{r.stderr[-2000:]}")
    return r.stdout


def require_ffmpeg():
    for exe in ("ffmpeg", "ffprobe"):
        if not shutil.which(exe):
            raise RuntimeError(f"{exe} が見つかりません。ffmpeg をインストールしてください。")


def probe(path):
    """コーデック・HDR・VFR・回転・fps・解像度を返す。処理前に必ず通す。"""
    out = _run(["ffprobe", "-v", "error", "-print_format", "json",
                "-show_streams", "-show_format", str(path)])
    d = json.loads(out)
    v = next(s for s in d["streams"] if s["codec_type"] == "video")
    a = next((s for s in d["streams"] if s["codec_type"] == "audio"), None)

    def frac(x):
        n, _, dn = (x or "0/1").partition("/")
        return float(n) / float(dn or 1)

    r_fps, avg_fps = frac(v.get("r_frame_rate")), frac(v.get("avg_frame_rate"))
    rot = 0
    for sd in v.get("side_data_list", []):
        if "rotation" in sd:
            rot = int(sd["rotation"])
    transfer = v.get("color_transfer", "")
    w, h = int(v["width"]), int(v["height"])
    if rot % 180:
        w, h = h, w
    return dict(
        codec=v["codec_name"], width=w, height=h, pix_fmt=v.get("pix_fmt"),
        color_transfer=transfer, is_hdr=transfer in ("arib-std-b67", "smpte2084"),
        rotation=rot, r_fps=r_fps, avg_fps=avg_fps,
        # r と avg が 1% 以上ずれていれば可変フレームレートとみなす
        is_vfr=bool(r_fps and abs(r_fps - avg_fps) / r_fps > 0.01),
        duration=float(d["format"]["duration"]), has_audio=a is not None,
    )


def tonemap_filter():
    """HDR→SDR に使えるフィルタを実際のビルドから選ぶ。両方無いビルドがある。"""
    filters = _run(["ffmpeg", "-hide_banner", "-filters"])
    if "zscale" in filters:
        return ("zscale=t=linear:npl=100,format=gbrpf32le,"
                "zscale=p=bt709,tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv")
    if "libplacebo" in filters:
        return "libplacebo=tonemapping=hable:colorspace=bt709:color_trc=bt709"
    raise RuntimeError("zscale も libplacebo も無いため HDR をトーンマップできません。")


def extract(src, out_dir, fps, start=None, duration=None, long_edge=None, info=None):
    """固定フレームレートに正規化して PNG 展開。回転は ffmpeg が自動適用する。"""
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    info = info or probe(src)
    vf = []
    if info["is_hdr"]:
        vf.append(tonemap_filter())
    vf.append(f"fps={fps}")                       # VFR を CFR に落とす。音ズレ防止
    w, h = info["width"], info["height"]
    if long_edge and max(w, h) > long_edge:       # 縮小のみ。拡大はしない
        sc = long_edge / max(w, h)
        vf.append(f"scale={round(w * sc / 2) * 2}:{round(h * sc / 2) * 2}")
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None: cmd += ["-ss", str(start)]
    cmd += ["-i", str(src)]
    if duration is not None: cmd += ["-t", str(duration)]
    cmd += ["-vf", ",".join(vf), "-pix_fmt", "rgb24", "-start_number", "0",
            str(out_dir / "%06d.png"), "-y"]
    _run(cmd)
    return sorted(out_dir.glob("*.png"))


def extract_audio(src, out_path, start=None, duration=None):
    cmd = ["ffmpeg", "-v", "error"]
    if start is not None: cmd += ["-ss", str(start)]
    cmd += ["-i", str(src)]
    if duration is not None: cmd += ["-t", str(duration)]
    cmd += ["-vn", "-c:a", "aac", "-b:a", "128k", str(out_path), "-y"]
    try:
        _run(cmd); return Path(out_path).exists()
    except RuntimeError:
        return False


def encode(frame_dir, out_path, fps, audio=None, crf=18):
    """iPhone の写真アプリと Instagram でそのまま再生できる形式で書き出す。"""
    cmd = ["ffmpeg", "-v", "error", "-framerate", str(fps),
           "-i", str(Path(frame_dir) / "%06d.png")]
    if audio:
        cmd += ["-i", str(audio)]
    cmd += ["-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p",
            "-crf", str(crf), "-preset", "medium"]
    if audio:
        cmd += ["-c:a", "aac", "-b:a", "128k", "-shortest"]
    cmd += ["-movflags", "+faststart", str(out_path), "-y"]
    _run(cmd)
    return out_path
