import streamlit as st
from moviepy.editor import VideoFileClip, concatenate_videoclips, vfx
import tempfile
import os
import numpy as np
from PIL import Image, ImageEnhance

# ページ設定
st.set_page_config(page_title="EMO-VLOG Creator", layout="wide")

# カスタムCSS
st.markdown("""
    <style>
    .stButton > button {
        width: 100%;
        border-radius: 12px;
        height: 3em;
        font-weight: bold;
    }
    .main-header {
        text-align: center;
        margin-bottom: 2rem;
    }
    </style>
    """, unsafe_allow_html=True)

# ヘッダー
st.markdown('<div class="main-header"><h1>🎞️ EMO-VLOG Creator</h1><p>あなたの日常を、レトロでシネマティックな物語へ。</p></div>', unsafe_allow_html=True)

# 2カラムレイアウト
col1, col2 = st.columns([1, 1])

with col1:
    st.markdown("### 🎬 Step 1: 素材を選ぶ")
    uploaded_files = st.file_uploader("動画ファイルをアップロード (.mp4, .mov)", type=["mp4", "mov"], accept_multiple_files=True)

with col2:
    st.markdown("### ✨ Step 2: エモさを加える")
    process_button = st.button("✨ クリエイティブを開始する ✨", type="primary", disabled=not uploaded_files)

def apply_emo_filter(image):
    """
    画像をレトロでエモい雰囲気に加工する関数
    - 彩度を落とす
    - わずかにセピア調（暖色）または青みを加える
    """
    img = Image.fromarray(image)
    
    # 彩度を少し落とす (0.7)
    converter = ImageEnhance.Color(img)
    img = converter.enhance(0.7)
    
    # コントラストを少し上げる (1.1)
    contrast = ImageEnhance.Contrast(img)
    img = contrast.enhance(1.1)
    
    # カラーオーバーレイ (微かなセピア/オレンジ調)
    # RGB各チャンネルにわずかなバイアスをかける
    data = np.array(img).astype(np.float32)
    data[:, :, 0] *= 1.05  # Red
    data[:, :, 1] *= 1.02  # Green
    data[:, :, 2] *= 0.95  # Blue
    
    return np.clip(data, 0, 255).astype(np.uint8)

if process_button and uploaded_files:
    with st.status("動画を加工中...", expanded=True) as status:
        temp_dir = tempfile.TemporaryDirectory()
        temp_paths = []
        clips = []
        
        try:
            # 1. 保存
            status.update(label="ファイルを読み込み中...")
            for uploaded_file in uploaded_files:
                temp_path = os.path.join(temp_dir.name, uploaded_file.name)
                with open(temp_path, "wb") as f:
                    f.write(uploaded_file.getbuffer())
                temp_paths.append(temp_path)
            
            # 2. トリミング (3秒)
            status.update(label="トリミング中...")
            for path in temp_paths:
                clip = VideoFileClip(path)
                duration = min(clip.duration, 3.0)
                clips.append(clip.subclip(0, duration))
            
            # 3. 結合
            status.update(label="動画を結合中...")
            final_clip = concatenate_videoclips(clips, method="compose")
            
            # 4. フィルター適用
            status.update(label="エモいフィルターを適用中...")
            emo_clip = final_clip.fl_image(apply_emo_filter)
            
            # 5. 書き出し
            status.update(label="最終レンダリング中 (iPhone向け最適化)...")
            output_filename = "emo_output.mp4"
            emo_clip.write_videofile(output_filename, codec="libx264", audio_codec="aac", temp_audiofile="temp-audio.m4a", remove_temp=True)
            
            status.update(label="完成しました！", state="complete", expanded=False)
            
            st.balloons()
            
            # 結果表示
            st.markdown("---")
            st.markdown("### 🎉 完成したVLOG")
            st.video(output_filename)
            
            with open(output_filename, "rb") as file:
                st.download_button(
                    label="📥 iPhoneに保存する",
                    data=file,
                    file_name="emo_vlog.mp4",
                    mime="video/mp4"
                )
                
        except Exception as e:
            st.error(f"エラーが発生しました: {e}")
        finally:
            # クリーンアップ
            for clip in clips:
                clip.close()
            if 'final_clip' in locals(): final_clip.close()
            if 'emo_clip' in locals(): emo_clip.close()
            temp_dir.cleanup()
            if os.path.exists("emo_output.mp4"):
                pass
else:
    if not uploaded_files:
        st.info("まずは左側のエリアから動画をアップロードしてください。")
