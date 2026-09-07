"""実写 → セル画調 変換パイプライン

設計の要点（参照映像の実測から導出）:
  * オプティカルフローは「元の実写フレーム」から取る。平坦化後の絵はテクスチャが
    無いためフローが破綻する（参照映像で補正後残差が19.5%悪化することを確認）。
  * スタイル適用は鮮明な元フレームに対して行う。安定化を先にかけると線の元に
    なるディテールが消える。
  * 安定化は「出力」に対して、元フレーム由来のフローで warp して合成する。
"""
import cv2, numpy as np
from . import cel

LINE_KEEP = 0.55   # 線は warp 合成で薄まりやすいので現フレーム側を優先する重み


def clahe_boost(bgr, clip=2.5, grid=8):
    """逆光素材の局所コントラストを起こす。線と塗りの両方がこれに依存する。"""
    lab = cv2.cvtColor((np.clip(bgr, 0, 1) * 255).astype(np.uint8), cv2.COLOR_BGR2Lab)
    l, a, b = cv2.split(lab)
    l = cv2.createCLAHE(clipLimit=clip, tileGridSize=(grid, grid)).apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_Lab2BGR).astype(np.float32) / 255


def refine_mask(bgr_u8, prob, cfg):
    """mediapipe のマスクを近傍の暗部で補完する。逆光素材では手足が欠けるため。"""
    base = (prob > cfg["mask_thr"]).astype(np.uint8)
    lum = cv2.cvtColor(bgr_u8, cv2.COLOR_BGR2GRAY)
    dark = (lum < np.percentile(lum, cfg["dark_pct"])).astype(np.uint8)
    reach = cfg["reach"]
    near = cv2.dilate(base, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (reach, reach)))
    cand = cv2.morphologyEx(cv2.bitwise_or(base, cv2.bitwise_and(dark, near)),
                            cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, _, _ = cv2.connectedComponentsWithStats(cand, 8)
    if n > 1:                                   # 被写体本体と繋がる成分だけ残す
        keep = set(np.unique(lab[base > 0])) - {0}
        if keep:
            cand = np.isin(lab, list(keep)).astype(np.uint8)
    return cv2.GaussianBlur(cand.astype(np.float32), (0, 0), 3.0)


def stylize(bgr, mask, cfg):
    """被写体と背景で情報量を変える。背景は階調も線も落として『線のラフスケッチ程度』に。
    """
    boosted = clahe_boost(bgr, cfg["clahe"])
    m3 = mask[..., None]

    # --- 塗り ---
    f_fg = cel.flatten(boosted, passes=4, d=7, sc=80, ss=12)
    f_bg = cel.flatten(boosted, passes=3, d=9, sc=150, ss=30, half=True)
    f_bg = cv2.medianBlur((np.clip(f_bg, 0, 1) * 255).astype(np.uint8), cfg["bg_median"]).astype(np.float32) / 255
    c_fg = cel.quantize(f_fg, cfg["tones_fg"], cfg["lift"], cfg["sat_fg"], cfg["shadow_blue"])
    c_bg = cel.quantize(f_bg, cfg["tones_bg"], cfg["lift"] + 0.12, cfg["sat_bg"], cfg["shadow_blue"])
    c_bg = 1.0 - (1.0 - c_bg) * cfg["bg_wash"]   # 背景を白へ持ち上げる（参照はハイキー）
    color = c_fg * m3 + c_bg * (1 - m3)

    # --- 線：CLAHE後の平滑化輝度から Canny。ヒステリシスで途切れにくい ---
    u8 = (np.clip(cel.luma(f_fg), 0, 1) * 255).astype(np.uint8)
    e = cv2.Canny(cv2.GaussianBlur(u8, (0, 0), 1.4), cfg["canny_lo"], cfg["canny_hi"]).astype(np.float32) / 255
    e = cv2.dilate(e, np.ones((cfg["thick"], cfg["thick"]), np.uint8))
    edge = cel.min_length_filter(e, cfg["min_area_fg"]) * mask \
         + cel.min_length_filter(e, cfg["min_area_bg"]) * cfg["bg_line"] * (1 - mask)

    # 被写体の輪郭はマスク境界から引く＝閉じていて太さが均一
    cont = np.zeros_like(edge)
    cs, _ = cv2.findContours((mask > 0.5).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    cv2.drawContours(cont, [c for c in cs if cv2.contourArea(c) > 800], -1, 1.0, cfg["thick"] + 1)
    edge = np.maximum(edge, cont * cfg["contour_w"])
    edge = cv2.GaussianBlur(np.clip(edge, 0, 1), (0, 0), 0.5)

    out = np.clip(color * (1 - edge * cfg["line_strength"])[..., None], 0, 1)
    return out, edge


class Stabilizer:
    """元フレーム由来のフローで、出力を時間方向にならす。"""

    def __init__(self, alpha=0.5):
        self.dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
        self.alpha, self.prev_gray, self.prev_out = alpha, None, None

    def flow_to(self, gray):
        """現フレームへの warp 座標とオクルージョン信頼度を返す。"""
        fw = self.dis.calc(self.prev_gray, gray, None)
        bw = self.dis.calc(gray, self.prev_gray, None)
        h, w = gray.shape
        gy, gx = np.mgrid[0:h, 0:w].astype(np.float32)
        mx, my = gx + fw[..., 0], gy + fw[..., 1]
        bwd = cv2.remap(bw, mx, my, cv2.INTER_LINEAR)
        err = np.linalg.norm(fw + bwd, axis=-1) ** 2
        lim = 0.01 * (np.linalg.norm(fw, axis=-1) ** 2 + np.linalg.norm(bwd, axis=-1) ** 2) + 0.5
        ok = cv2.GaussianBlur((err < lim).astype(np.float32), (0, 0), 2.0)
        return mx, my, ok

    def __call__(self, gray, styl, edge):
        if self.prev_gray is None:
            self.prev_gray, self.prev_out = gray, styl
            return styl
        mx, my, ok = self.flow_to(gray)
        wprev = cv2.remap(self.prev_out, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
        # 線の上では現フレームを優先し、線がにじむのを防ぐ
        a = (self.alpha * ok * (1.0 - LINE_KEEP * edge))[..., None]
        out = styl * (1 - a) + wprev * a
        self.prev_gray, self.prev_out = gray, out
        return out


DEFAULT = dict(clahe=2.5, tones_fg=5, tones_bg=3, lift=0.10, sat_fg=1.55, sat_bg=0.55,
               shadow_blue=0.06, canny_lo=18, canny_hi=55, thick=2, bg_median=9,
               min_area_fg=30, min_area_bg=70, bg_line=0.75, line_strength=0.95,
               contour_w=1.0, bg_wash=0.30,
               mask_thr=0.40, dark_pct=32, reach=55, alpha=0.4)
