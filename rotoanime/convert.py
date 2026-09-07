"""フレーム列に対する変換ループ。マスク生成・スタイル適用・時間安定化をまとめる。"""
import cv2, numpy as np
from pathlib import Path

from .pipeline import Stabilizer, stylize, refine_mask, DEFAULT


def _segmenter():
    import mediapipe as mp
    return mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1)


def convert(frames, out_dir, cfg=None, debug_dir=None, progress=None):
    """frames: PNG パスのリスト。out_dir に変換後 PNG を書き出し、指標を返す。"""
    cfg = {**DEFAULT, **(cfg or {})}
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)
    seg = _segmenter()
    stab = Stabilizer(alpha=cfg["alpha"])

    prev_prob = prev_in = prev_out = None
    in_d, out_d = [], []
    for i, f in enumerate(frames):
        bgr = cv2.imread(str(f)).astype(np.float32) / 255
        u8 = (bgr * 255).astype(np.uint8)
        gray = cv2.cvtColor(u8, cv2.COLOR_BGR2GRAY)

        # 生の確率を時間方向にならしてから閾値。フレーム毎のマスク欠けを埋める
        prob = seg.process(cv2.cvtColor(u8, cv2.COLOR_BGR2RGB)).segmentation_mask
        prob = prob if prev_prob is None else 0.6 * prob + 0.4 * prev_prob
        prev_prob = prob
        mask = refine_mask(u8, prob, cfg)

        styl, edge = stylize(bgr, mask, cfg)
        out = stab(gray, styl, edge)

        if prev_in is not None:
            in_d.append(float(np.abs(bgr - prev_in).mean()))
            out_d.append(float(np.abs(out - prev_out).mean()))
        prev_in, prev_out = bgr, out

        cv2.imwrite(str(out_dir / f"{i:06d}.png"), (out * 255).astype(np.uint8))
        if debug_dir:
            for name, img in (("mask", mask), ("line", 1 - edge), ("style", styl)):
                d = Path(debug_dir) / name; d.mkdir(parents=True, exist_ok=True)
                cv2.imwrite(str(d / f"{i:06d}.png"), (np.clip(img, 0, 1) * 255).astype(np.uint8))
        if progress:
            progress(i + 1, len(frames))

    return dict(frames=len(frames),
                flicker_in=float(np.mean(in_d)) if in_d else 0.0,
                flicker_out=float(np.mean(out_d)) if out_d else 0.0)
