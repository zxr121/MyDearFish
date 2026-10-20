# 录音回环 v4 —— 支持「固定 N 秒」和「等停止文件」两种模式；DLL 首次编译、之后秒开。
#   powershell -File 录音回环.ps1 -秒 25 -输出 out.wav                    固定时长
#   powershell -File 录音回环.ps1 -停 stop.txt -输出 out.wav            一直录，直到 stop.txt 存在才停
param(
  [int]$秒 = 0,
  [string]$停 = '',
  [int]$段 = 0,
  [int]$智能 = 0,
  [string]$输出 = "$env:USERPROFILE\Desktop\listen-test.wav"
)
$ErrorActionPreference = 'Stop'

$代码 = @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

public static class Wasapi {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] public class MMDeviceEnumerator {}

  [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IntPtr devices);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice endpoint);
    int GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IntPtr device);
    int RegisterEndpointNotificationCallback(IntPtr cb);
    int UnregisterEndpointNotificationCallback(IntPtr cb);
  }
  [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IMMDevice {
    int Activate(ref Guid iid, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IntPtr props);
    int GetId(out IntPtr id);
    int GetState(out int state);
  }
  [Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioClient {
    int Initialize(int share, int flags, long bufDur, long per, IntPtr fmt, ref Guid g);
    int GetBufferSize(out uint frames);
    int GetStreamLatency(out long hns);
    int GetCurrentPadding(out uint padding);
    int IsFormatSupported(int share, IntPtr fmt, out IntPtr closest);
    int GetMixFormat(out IntPtr fmt);
    int GetDevicePeriod(out long defPeriod, out long minPeriod);
    int Start();
    int Stop();
    int Reset();
    int SetEventHandle(IntPtr evt);
    int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object o);
  }
  [Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IAudioCaptureClient {
    int GetBuffer(out IntPtr data, out uint frames, out int flags, out long pos, out long qpc);
    int ReleaseBuffer(uint frames);
    int GetNextPacketSize(out uint frames);
  }

  static byte[] ConvertTo16(byte[] src, short tag, short bits) {
    int bps = bits / 8;
    if (bps <= 0) bps = 2;
    int n = src.Length / bps;
    var outb = new byte[n * 2];
    for (int i = 0; i < n; i++) {
      int off = i * bps;
      short v = 0;
      if (tag == 3 && bps == 4) {
        float f = BitConverter.ToSingle(src, off);
        f = Math.Max(-1f, Math.Min(1f, f));
        v = (short)(f * 32767f);
      } else if (tag == 1) {
        if (bits == 16) v = BitConverter.ToInt16(src, off);
        else if (bits == 32) v = (short)(BitConverter.ToInt32(src, off) >> 16);
        else if (bits == 24) {
          int x = src[off] | (src[off + 1] << 8) | (src[off + 2] << 16);
          if ((x & 0x800000) != 0) x |= unchecked((int)0xFF000000);
          v = (short)(x >> 8);
        }
      }
      outb[2 * i] = (byte)(v & 0xff);
      outb[2 * i + 1] = (byte)((v >> 8) & 0xff);
    }
    return outb;
  }

  public static string Record(int maxSec, string stopFile, string outPath) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev = null;
    int hr = en.GetDefaultAudioEndpoint(0, 1, out dev);
    if (hr != 0 || dev == null) return "FAIL:GetDefaultAudioEndpoint 0x" + hr.ToString("X");

    object clientObj = null;
    var iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    hr = dev.Activate(ref iidClient, 1, IntPtr.Zero, out clientObj);
    if (hr != 0) return "FAIL:Activate 0x" + hr.ToString("X");
    var client = (IAudioClient)clientObj;

    IntPtr fmtPtr = IntPtr.Zero;
    client.GetMixFormat(out fmtPtr);
    short tag = (short)Marshal.ReadInt16(fmtPtr, 0);
    short ch = (short)Marshal.ReadInt16(fmtPtr, 2);
    int sr = Marshal.ReadInt32(fmtPtr, 4);
    short bits = (short)Marshal.ReadInt16(fmtPtr, 14);
    short 实tag = tag;
    if (tag == (short)-2) 实tag = (short)Marshal.ReadInt32(fmtPtr, 24);

    var g = Guid.Empty;
    hr = client.Initialize(0, 0x00020000, 0, 0, fmtPtr, ref g);
    if (hr != 0) return "FAIL:Initialize 0x" + hr.ToString("X");
    if (fmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(fmtPtr);

    object capObj = null;
    var iidCap = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    hr = client.GetService(ref iidCap, out capObj);
    if (hr != 0) return "FAIL:GetService 0x" + hr.ToString("X");
    var cap = (IAudioCaptureClient)capObj;

    client.Start();
    var chunk = new List<byte>();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    long maxMs = (long)maxSec * 1000;
    int 每帧字节 = (bits / 8) * ch;
    if (每帧字节 <= 0) 每帧字节 = 2;
    while (sw.ElapsedMilliseconds < maxMs) {
      System.Threading.Thread.Sleep(10);
      uint pkts = 0;
      cap.GetNextPacketSize(out pkts);
      while (pkts > 0) {
        IntPtr data; uint frames; int flags; long p1, p2;
        cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
        int bytes = (int)(frames * (uint)每帧字节);
        if (bytes > 0) {
          byte[] buf = new byte[bytes];
          Marshal.Copy(data, buf, 0, bytes);
          chunk.AddRange(ConvertTo16(buf, 实tag, bits));
        }
        cap.ReleaseBuffer(frames);
        cap.GetNextPacketSize(out pkts);
      }
      if (!string.IsNullOrEmpty(stopFile) && File.Exists(stopFile)) break;
    }
    client.Stop();

    byte[] all = chunk.ToArray();
    using (var fs = new FileStream(outPath, FileMode.Create))
    using (var bw = new BinaryWriter(fs)) {
      int blockAlign = ch * 2;
      int rate = sr > 0 ? sr : 44100;
      bw.Write(Encoding.ASCII.GetBytes("RIFF"));
      bw.Write((uint)(36 + all.Length));
      bw.Write(Encoding.ASCII.GetBytes("WAVE"));
      bw.Write(Encoding.ASCII.GetBytes("fmt "));
      bw.Write((uint)16);
      bw.Write((ushort)1);
      bw.Write((ushort)ch);
      bw.Write((uint)rate);
      bw.Write((uint)(rate * blockAlign));
      bw.Write((ushort)blockAlign);
      bw.Write((ushort)16);
      bw.Write(Encoding.ASCII.GetBytes("data"));
      bw.Write((uint)all.Length);
      bw.Write(all);
    }
    if (!string.IsNullOrEmpty(stopFile)) { try { File.Delete(stopFile); } catch {} }
    return "OK ch=" + ch + " sr=" + sr + " bytes=" + all.Length;
  }

  static void WriteWav(byte[] data, string path, int ch, int sr) {
    string tmp = path + ".part";
    int blockAlign = ch * 2;
    int rate = sr > 0 ? sr : 44100;
    using (var fs = new FileStream(tmp, FileMode.Create))
    using (var bw = new BinaryWriter(fs)) {
      bw.Write(Encoding.ASCII.GetBytes("RIFF"));
      bw.Write((uint)(36 + data.Length));
      bw.Write(Encoding.ASCII.GetBytes("WAVE"));
      bw.Write(Encoding.ASCII.GetBytes("fmt "));
      bw.Write((uint)16);
      bw.Write((ushort)1);
      bw.Write((ushort)ch);
      bw.Write((uint)rate);
      bw.Write((uint)(rate * blockAlign));
      bw.Write((ushort)blockAlign);
      bw.Write((ushort)16);
      bw.Write(Encoding.ASCII.GetBytes("data"));
      bw.Write((uint)data.Length);
      bw.Write(data);
    }
    if (File.Exists(path)) File.Delete(path);
    File.Move(tmp, path);
  }

  // 边录边切：每 segSec 秒把已经攒到的音频写成一个独立 wav（带完整头），
  // 文件名 = basePath-000.wav / -001.wav ... 看门狗见一个发一个，不用等整段念完。
  // 先写 .part 再改名成 .wav，保证看门狗读到的都是写完整了的文件。
  public static string RecordSegmented(int maxSec, string stopFile, string basePath, int segSec) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev = null;
    int hr = en.GetDefaultAudioEndpoint(0, 1, out dev);
    if (hr != 0 || dev == null) return "FAIL:GetDefaultAudioEndpoint 0x" + hr.ToString("X");

    object clientObj = null;
    var iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    hr = dev.Activate(ref iidClient, 1, IntPtr.Zero, out clientObj);
    if (hr != 0) return "FAIL:Activate 0x" + hr.ToString("X");
    var client = (IAudioClient)clientObj;

    IntPtr fmtPtr = IntPtr.Zero;
    client.GetMixFormat(out fmtPtr);
    short tag = (short)Marshal.ReadInt16(fmtPtr, 0);
    short ch = (short)Marshal.ReadInt16(fmtPtr, 2);
    int sr = Marshal.ReadInt32(fmtPtr, 4);
    short bits = (short)Marshal.ReadInt16(fmtPtr, 14);
    short realTag = tag;
    if (tag == (short)-2) realTag = (short)Marshal.ReadInt32(fmtPtr, 24);

    var g = Guid.Empty;
    hr = client.Initialize(0, 0x00020000, 0, 0, fmtPtr, ref g);
    if (hr != 0) return "FAIL:Initialize 0x" + hr.ToString("X");
    if (fmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(fmtPtr);

    object capObj = null;
    var iidCap = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    hr = client.GetService(ref iidCap, out capObj);
    if (hr != 0) return "FAIL:GetService 0x" + hr.ToString("X");
    var cap = (IAudioCaptureClient)capObj;

    client.Start();
    var chunk = new List<byte>();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    long maxMs = (long)maxSec * 1000;
    long segMs = (long)(segSec > 0 ? segSec : 1) * 1000;
    int frameBytes = (bits / 8) * ch;
    if (frameBytes <= 0) frameBytes = 2;
    int idx = 0;
    int segCount = 0;
    long nextFlush = segMs;
    while (sw.ElapsedMilliseconds < maxMs) {
      System.Threading.Thread.Sleep(10);
      uint pkts = 0;
      cap.GetNextPacketSize(out pkts);
      while (pkts > 0) {
        IntPtr data; uint frames; int flags; long p1, p2;
        cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
        int bytes = (int)(frames * (uint)frameBytes);
        if (bytes > 0) {
          byte[] buf = new byte[bytes];
          Marshal.Copy(data, buf, 0, bytes);
          chunk.AddRange(ConvertTo16(buf, realTag, bits));
        }
        cap.ReleaseBuffer(frames);
        cap.GetNextPacketSize(out pkts);
      }
      if (sw.ElapsedMilliseconds >= nextFlush && chunk.Count > 0) {
        WriteWav(chunk.ToArray(), basePath + "-" + idx.ToString("D3") + ".wav", ch, sr);
        chunk.Clear();
        idx++; segCount++;
        nextFlush += segMs;
      }
      if (!string.IsNullOrEmpty(stopFile) && File.Exists(stopFile)) break;
    }
    client.Stop();
    if (chunk.Count > 0) {
      WriteWav(chunk.ToArray(), basePath + "-" + idx.ToString("D3") + ".wav", ch, sr);
      segCount++;
    }
    if (!string.IsNullOrEmpty(stopFile)) { try { File.Delete(stopFile); } catch {} }
    return "OK ch=" + ch + " sr=" + sr + " segs=" + segCount;
  }

  // 智能切段：目标是 ~目标秒 一段，但**尽量切在停顿处（一句念完的空当）**
  //  · 录满 minSec 秒之后，一旦连续静音超过 350ms，就在那里切
  //  · 一直没停顿的话，最多 maxSegSec 秒就硬切兜底
  public static string RecordSmart(int maxSec, string stopFile, string basePath, int minSec, int maxSegSec) {
    var en = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice dev = null;
    int hr = en.GetDefaultAudioEndpoint(0, 1, out dev);
    if (hr != 0 || dev == null) return "FAIL:GetDefaultAudioEndpoint 0x" + hr.ToString("X");

    object clientObj = null;
    var iidClient = new Guid("1CB9AD4C-DBFA-4c32-B178-C2F568A703B2");
    hr = dev.Activate(ref iidClient, 1, IntPtr.Zero, out clientObj);
    if (hr != 0) return "FAIL:Activate 0x" + hr.ToString("X");
    var client = (IAudioClient)clientObj;

    IntPtr fmtPtr = IntPtr.Zero;
    client.GetMixFormat(out fmtPtr);
    short tag = (short)Marshal.ReadInt16(fmtPtr, 0);
    short ch = (short)Marshal.ReadInt16(fmtPtr, 2);
    int sr = Marshal.ReadInt32(fmtPtr, 4);
    short bits = (short)Marshal.ReadInt16(fmtPtr, 14);
    short realTag = tag;
    if (tag == (short)-2) realTag = (short)Marshal.ReadInt32(fmtPtr, 24);

    var g = Guid.Empty;
    hr = client.Initialize(0, 0x00020000, 0, 0, fmtPtr, ref g);
    if (hr != 0) return "FAIL:Initialize 0x" + hr.ToString("X");
    if (fmtPtr != IntPtr.Zero) Marshal.FreeCoTaskMem(fmtPtr);

    object capObj = null;
    var iidCap = new Guid("C8ADBD64-E71E-48a0-A4DE-185C395CD317");
    hr = client.GetService(ref iidCap, out capObj);
    if (hr != 0) return "FAIL:GetService 0x" + hr.ToString("X");
    var cap = (IAudioCaptureClient)capObj;

    client.Start();
    var chunk = new List<byte>();
    var sw = System.Diagnostics.Stopwatch.StartNew();
    long maxMs = (long)maxSec * 1000;
    long minMs = (long)(minSec > 0 ? minSec : 1) * 1000;
    long maxSegMs = (long)(maxSegSec > minSec ? maxSegSec : minSec + 1) * 1000;
    int quietThresh = 400;   // 16bit 绝对幅度 < 400（约 -38 dBFS）算静音
    long pauseMs = 350;       // 连续静音达到 350ms 才算「一句念完」
    int frameBytes = (bits / 8) * ch;
    if (frameBytes <= 0) frameBytes = 2;
    int rate = sr > 0 ? sr : 44100;
    long segStartMs = 0;
    long silentMs = 0;
    int idx = 0;
    int segCount = 0;
    while (sw.ElapsedMilliseconds < maxMs) {
      System.Threading.Thread.Sleep(10);
      uint pkts = 0;
      cap.GetNextPacketSize(out pkts);
      while (pkts > 0) {
        IntPtr data; uint frames; int flags; long p1, p2;
        cap.GetBuffer(out data, out frames, out flags, out p1, out p2);
        int bytes = (int)(frames * (uint)frameBytes);
        if (bytes > 0) {
          byte[] buf = new byte[bytes];
          Marshal.Copy(data, buf, 0, bytes);
          byte[] pcm = ConvertTo16(buf, realTag, bits);
          int peak = 0;
          for (int i = 0; i + 1 < pcm.Length; i += 2) {
            int v = (short)(pcm[i] | (pcm[i + 1] << 8));
            int a = v < 0 ? -v : v;
            if (a > peak) peak = a;
          }
          chunk.AddRange(pcm);
          long frameMs = (long)frames * 1000L / rate;
          if (peak < quietThresh) silentMs += frameMs; else silentMs = 0;
        }
        cap.ReleaseBuffer(frames);
        cap.GetNextPacketSize(out pkts);
      }
      long now = sw.ElapsedMilliseconds;
      long segLen = now - segStartMs;
      bool cut = false;
      if (segLen >= minMs && silentMs >= pauseMs) cut = true;   // 句末停顿，切
      if (segLen >= maxSegMs) cut = true;                        // 超长兜底硬切
      if (cut && chunk.Count > 0) {
        WriteWav(chunk.ToArray(), basePath + "-" + idx.ToString("D3") + ".wav", ch, sr);
        chunk.Clear();
        idx++; segCount++;
        segStartMs = now;
        silentMs = 0;
      }
      if (!string.IsNullOrEmpty(stopFile) && File.Exists(stopFile)) break;
    }
    client.Stop();
    if (chunk.Count > 0) {
      WriteWav(chunk.ToArray(), basePath + "-" + idx.ToString("D3") + ".wav", ch, sr);
      segCount++;
    }
    if (!string.IsNullOrEmpty(stopFile)) { try { File.Delete(stopFile); } catch {} }
    return "OK ch=" + ch + " sr=" + sr + " segs=" + segCount;
  }
}
'@

# 首次编译成 DLL 缓存，之后秒开（不用每次重新编 C#）
$Dll = Join-Path (Split-Path $PSCommandPath) 'Wasapi.dll'
$已加载 = $false
if (Test-Path $Dll) {
  try { Add-Type -Path $Dll; $已加载 = $true } catch { $已加载 = $false }
}
if (-not $已加载) {
  Add-Type -TypeDefinition $代码 -OutputAssembly $Dll -OutputType Library
  Add-Type -Path $Dll
}

try {
  if ($智能 -gt 0) {
    $r = [Wasapi]::RecordSmart(600, $停, $输出, ([Math]::Max(1, $智能 - 2)), ($智能 + 2))
  } elseif ($段 -gt 0) {
    $r = [Wasapi]::RecordSegmented(600, $停, $输出, $段)
  } elseif ($停 -ne '') {
    $r = [Wasapi]::Record(600, $停, $输出)
  } else {
    $s = [Math]::Max(1, $秒)
    $r = [Wasapi]::Record($s, $null, $输出)
  }
  Write-Output $r
  Write-Output ("saved=" + $输出)
} catch {
  Write-Output ("ERROR: " + $_.Exception.Message)
  exit 1
}