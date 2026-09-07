"""合成素材でパイプラインを完走させる回帰テスト。

輝度コントラストを十分につけること。低コントラストの合成素材だと線が1本も
出ず、テストが素通りしてしまう（Sobel/Canny の閾値は輝度差に対して効くため）。
"""
import numpy as np
import pytest

cv2 = pytest.importorskip("cv2")
from rotoanime import cel
from rotoanime.pipeline import stylize, Stabilizer, DEFAULT

W, H, N = 180, 320, 12


def synth(i):
    """暗い背景を動く明るい矩形。輝度差 0.7 程度をつける。"""
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    img = np.stack([0.10 + 0.12 * (xx / W), 0.12 + 0.12 * (yy / H),
                    0.14 + 0.12 * (xx / W)], -1)
    x = 30 + i * 6
    cv2.rectangle(img, (x, 120), (x + 60, 230), (0.82, 0.86, 0.90), -1)
    return np.clip(img, 0, 1).astype(np.float32)


def mask_of(i):
    m = np.zeros((H, W), np.float32)
    x = 30 + i * 6
    cv2.rectangle(m, (x, 120), (x + 60, 230), 1.0, -1)
    return cv2.GaussianBlur(m, (0, 0), 3)


def test_line_extraction_is_not_vacuous():
    """線が実際に出ていること。ここが 0 だと以降のテストが無意味になる。"""
    f = cel.flatten(synth(0))
    e = cel.lines(f, t0=0.10, span=0.20)
    assert (e > 0.5).mean() > 0.002, "主線が1本も出ていない"


def test_quantize_keeps_shadows_off_black():
    """ビン中央値＋lift により、影が真っ黒に潰れないこと。"""
    out = cel.quantize(cel.flatten(synth(0)), tones=5, lift=0.10)
    assert out.min() > 0.01
    assert np.isfinite(out).all()


def _flicker(seq):
    return float(np.mean([np.abs(seq[i] - seq[i - 1]).mean() for i in range(1, len(seq))]))


def test_pipeline_runs_to_completion():
    stab = Stabilizer(alpha=DEFAULT["alpha"])
    for i in range(N):
        bgr = synth(i)
        gray = cv2.cvtColor((bgr * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
        styl, edge = stylize(bgr, mask_of(i), DEFAULT)
        out = stab(gray, styl, edge)
        assert out.shape == (H, W, 3) and np.isfinite(out).all()
        assert 0.0 <= out.min() and out.max() <= 1.0


def test_stabilizer_does_not_worsen_flicker():
    """安定化ありが、なしより悪化しないこと。

    入力そのものとの比較ではない。量子化は帯の位置がフレーム間で飛ぶため、
    スタイル適用自体がちらつきを増やす（実素材で 0.060→0.028、合成素材では
    0.016→0.033）。安定化器が制御できるのは『スタイル適用後』の差分だけなので、
    回帰テストはそこを見る。実素材での低減幅は約10%。
    """
    plain, stabilized = [], []
    stab = Stabilizer(alpha=DEFAULT["alpha"])
    for i in range(N):
        bgr = synth(i)
        gray = cv2.cvtColor((bgr * 255).astype(np.uint8), cv2.COLOR_BGR2GRAY)
        styl, edge = stylize(bgr, mask_of(i), DEFAULT)
        plain.append(styl)
        stabilized.append(stab(gray, styl, edge))

    d_plain, d_stab = _flicker(plain), _flicker(stabilized)
    assert d_stab <= d_plain * 1.05, f"安定化が悪化させている: {d_plain:.5f} → {d_stab:.5f}"
