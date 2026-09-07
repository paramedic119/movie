"""セル画調変換のコア。BGR float32 0..1 を前提。"""
import cv2, numpy as np

LUMA = np.array([0.114, 0.587, 0.299], np.float32)   # OpenCV は BGR 順


def luma(bgr):
    return bgr @ LUMA


def flatten(bgr, passes=4, d=7, sc=80, ss=12, half=True):
    """バイラテラルで面を作る。半解像度で回して等倍に戻す。"""
    src = cv2.resize(bgr, None, fx=.5, fy=.5, interpolation=cv2.INTER_AREA) if half else bgr
    for _ in range(passes):
        src = cv2.bilateralFilter(src, d, sc, ss)
    if half:
        src = cv2.resize(src, (bgr.shape[1], bgr.shape[0]), interpolation=cv2.INTER_LINEAR)
    return src


def quantize(bgr, tones=5, lift=0.06, sat=1.20, shadow_blue=0.05):
    """輝度だけを階調化し色相は保つ。ビン中央値なので黒潰れしない。"""
    lm = luma(bgr)
    q = (np.floor(np.clip(lm, 0, 1) * tones) + 0.5) / tones
    q = lift + (1.0 - lift) * q
    out = bgr * (q / np.maximum(lm, 1e-3))[..., None]

    g = luma(out)[..., None]
    out = g + (out - g) * sat                       # 彩度

    dark = np.clip((0.45 - q) / 0.45, 0, 1)[..., None]   # 影ほど青寄りに
    out = out + dark * np.array([shadow_blue, 0.0, -shadow_blue * 0.6], np.float32)
    return np.clip(out, 0, 1)


def lines(bgr, sigma=1.6, t0=0.10, span=0.20, thick=0):
    """線は必ず『平滑化後の輝度』から取る。元画像に直接かけるとテクスチャを拾う。"""
    g = cv2.GaussianBlur(luma(bgr), (0, 0), sigma)
    mag = np.hypot(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3),
                   cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    e = np.clip((mag - t0) / span, 0, 1)
    if thick:
        e = cv2.dilate(e, np.ones((thick, thick), np.uint8))
    return e


def min_length_filter(edge, min_area=24, thr=0.5):
    """短い孤立線を消す。水面のきらめき由来のゴミ取り。"""
    m = (edge > thr).astype(np.uint8)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m, 8)
    keep = np.zeros(n, bool)
    keep[1:] = stats[1:, cv2.CC_STAT_AREA] >= min_area
    return edge * keep[lab]
