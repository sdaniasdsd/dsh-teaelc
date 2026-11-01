#!/usr/bin/env bash
# 合成：帧序列 + 配乐 + 旁白 → 成片 MP4
set -euo pipefail
cd "$(dirname "$0")"

OUT="电路小实验 DSH插件 65s.mp4"

ffmpeg -y -hide_banner -loglevel warning \
  -framerate 30 -f image2 -c:v mjpeg -i "out/f_%05d.jpg" \
  -i audio_bed.wav -i voice_track.wav \
  -filter_complex "
    [1:a]aresample=48000,volume=0.85[music];
    [2:a]aresample=48000,volume=1.5[voice];
    [music][voice]sidechaincompress=threshold=0.06:ratio=5:attack=50:release=380[ducked];
    [ducked][voice]amix=inputs=2:duration=first:normalize=0,
      loudnorm=I=-17:TP=-1.5:LRA=11:print_format=summary[out]
  " \
  -map "[out]" -map 0:v \
  -c:v libx264 -crf 17 -preset medium -pix_fmt yuv420p \
  -ar 48000 -ac 2 \
  -movflags +faststart -shortest \
  "$OUT"

echo "成片: $OUT"
ffprobe -v error -show_entries format=duration,size -of default=nw=1 "$OUT"
