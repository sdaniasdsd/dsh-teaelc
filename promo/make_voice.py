"""
把 12 段中文旁白按分镜时间轴贴到 65 秒轨道上，并做旁白优先的混音。

用法：
  python make_voice.py

产物：
  voice_track.wav  65 秒旁白轨（无旁白时段为静音）
  mixed.wav        旁白 + 配乐，旁白段配乐自动压低
"""
import os
import shutil
import subprocess
import wave

DUR = 65.0
SR = 48000

# 分镜时间轴：每段旁白从该段开始后 0.25s 进入
PLACEMENTS = [
    ('01-hook',  0.30),
    ('02-title', 4.30),
    ('03-s00',   6.90),
    ('04-s01',  14.05),
    ('05-s02',  19.90),
    ('06-s03',  25.10),
    ('07-c1',   30.30),
    ('08-s05',  34.20),
    ('09-c2',   39.40),
    ('10-s07',  43.30),
    ('11-live', 47.20),
    ('12-end',  55.70),
]

ROOT = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.join(ROOT, 'voice')
OUT = os.path.join(ROOT, 'voice_track.wav')
BED = os.path.join(ROOT, 'audio_bed.wav')
MIXED = os.path.join(ROOT, 'mixed.wav')


def duration_of(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', path],
        capture_output=True, text=True, encoding='utf-8', errors='ignore'
    )
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def main():
    # 1) 用 ffmpeg 把每段旁白按时间点叠加到 65 秒静音轨
    inputs = []
    filters = []
    # 静音基底
    filters.append(f'anullsrc=r={SR}:cl=mono:d={DUR}[base]')
    idx = 0
    for i, (name, at) in enumerate(PLACEMENTS, start=1):
        p = os.path.join(VOICE, name + '.wav')
        if not os.path.exists(p):
            print(f'[警告] 缺少 {name}.wav，跳过')
            continue
        inputs.extend(['-i', p])
        # 每段旁白统一重采样并延迟到时间点
        delay_ms = int(at * 1000)
        filters.append(
            f'[{idx}:a]aresample={SR},aformat=channel_layouts=mono,'
            f'volume=1.0,adelay={delay_ms}|{delay_ms}[v{i}]'
        )
        idx += 1

    seg_labels = ''.join(
        f'[v{i}]' for i in range(1, len([1 for n, _ in PLACEMENTS
                                         if os.path.exists(os.path.join(VOICE, n + '.wav'))]) + 1)
    )
    n = len([1 for nn, _ in PLACEMENTS if os.path.exists(os.path.join(VOICE, nn + '.wav'))])
    mix_expr = ''.join(f'[v{i}]' for i in range(1, n + 1))
    filters.append(
        f'[base]{mix_expr}amix=inputs={n + 1}:duration=first:normalize=0[out]'
    )

    cmd = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error']
    cmd += inputs
    cmd += ['-filter_complex', ';'.join(filters), '-map', '[out]',
            '-ar', str(SR), '-ac', '1', OUT]
    subprocess.run(cmd, check=True)
    print(f'voice_track.wav 写入完成（{duration_of(OUT):.2f}s）')

    # 2) 旁白优先混音：旁白出现时配乐 ducking
    #    用 sidechaincompress，让 voice 作为 sidechain 压 music
    mix_filter = (
        '[1:a]aresample=48000,volume=1.0[voice];'
        '[0:a]aresample=48000,volume=1.0[music];'
        '[music][voice]sidechaincompress='
        'threshold=0.05:ratio=6:attack=60:release=420:makeup=1[ducked];'
        '[ducked][voice]amix=inputs=2:duration=first:normalize=0[out]'
    )
    subprocess.run(
        ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
         '-i', BED, '-i', OUT,
         '-filter_complex', mix_filter, '-map', '[out]',
         '-ar', str(SR), '-ac', '2', MIXED],
        check=True
    )
    print(f'mixed.wav 写入完成（{duration_of(MIXED):.2f}s）')


if __name__ == '__main__':
    main()
