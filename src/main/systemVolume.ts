import { execFile, spawn, type ChildProcess } from 'node:child_process';

// How much the device's volume setting turns sound down, in dB (0 at full, negative below), for
// sounds that make up for it (the dictation cues). In dB rather than the volume slider's 0-100%,
// because the slider isn't linear in loudness. Read in the background and cached, so a key press
// never waits on it. Until the first reading (or where it can't be read) this stands in.
const FALLBACK_DB = -10;
let volumeDb = FALLBACK_DB;

export const getSystemVolumeDb = () => volumeDb;

const remember = (db: number) => {
  if (Number.isFinite(db) && db <= 0) {
    volumeDb = db;
  }
};

// Windows has no command for this, so one hidden PowerShell asks Core Audio for the default output
// device's volume level in dB every second (the default device each time, so switching speakers is picked up).
// It compiles the COM bindings once and keeps running; it exits by itself if Browsie goes away
// without stopping it.
const WINDOWS_SCRIPT = `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume {
  int f(); int g(); int h(); int i(); int j();
  int GetMasterVolumeLevel(out float levelDb);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice {
  int Activate(ref Guid id, int context, int parameters, out IAudioEndpointVolume endpoint);
}
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator {
  int f();
  int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
}
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator { }
public static class BrowsieVolume {
  public static float Read() {
    var devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device;
    Marshal.ThrowExceptionForHR(devices.GetDefaultAudioEndpoint(0, 1, out device));
    var id = typeof(IAudioEndpointVolume).GUID;
    IAudioEndpointVolume endpoint;
    Marshal.ThrowExceptionForHR(device.Activate(ref id, 23, 0, out endpoint));
    float levelDb;
    Marshal.ThrowExceptionForHR(endpoint.GetMasterVolumeLevel(out levelDb));
    return levelDb;
  }
}
"@
$parent = ${process.pid}
while ($true) {
  if (-not (Get-Process -Id $parent -ErrorAction SilentlyContinue)) { exit }
  try { [Console]::Out.WriteLine([BrowsieVolume]::Read().ToString([Globalization.CultureInfo]::InvariantCulture)) } catch { }
  Start-Sleep -Milliseconds 1000
}
`;

let watcher: ChildProcess | null = null;
let macTimer: ReturnType<typeof setInterval> | null = null;

const watchWindows = () => {
  const encoded = Buffer.from(WINDOWS_SCRIPT, 'utf16le').toString('base64');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  let pending = '';

  child.stdout?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? '';
    const latest = lines.filter(Boolean).pop();

    if (latest) {
      remember(Number.parseFloat(latest));
    }
  });
  child.on('error', () => undefined);
  child.on('exit', () => {
    if (watcher === child) {
      watcher = null;
    }
  });
  watcher = child;
};

// macOS only reports the slider (0-100). Its curve is close to amplitude = slider², so this
// estimates the dB from that.
const readMac = () => {
  execFile('osascript', ['-e', 'output volume of (get volume settings)'], (error, stdout) => {
    const slider = Number.parseFloat(stdout) / 100;

    if (!error && slider >= 0 && slider <= 1) {
      remember(slider > 0 ? 40 * Math.log10(slider) : -Infinity);
    }
  });
};

export const startSystemVolume = () => {
  if (watcher || macTimer) {
    return;
  }

  if (process.platform === 'win32') {
    watchWindows();
  } else if (process.platform === 'darwin') {
    readMac();
    macTimer = setInterval(readMac, 2000);
  }
};

export const stopSystemVolume = () => {
  watcher?.kill();
  watcher = null;

  if (macTimer) {
    clearInterval(macTimer);
    macTimer = null;
  }
};
