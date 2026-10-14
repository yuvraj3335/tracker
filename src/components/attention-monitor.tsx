'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, CameraOff, Eye, EyeOff, ScanFace } from 'lucide-react';
import type { FaceLandmarker } from '@mediapipe/tasks-vision';
import { advanceAttention, gazeFromLandmarks, INITIAL_ATTENTION, looksAtScreen, type AttentionState, type Gaze } from '@/lib/attention';
import { Button } from './ui/button';

const PREFERENCE = 'jst-attention-minutes';
const CHANGE = 'jst-attention-minutes-change';
const DEFAULT_MINUTES = 3;

function minutesSnapshot() {
  try {
    const n = Number(localStorage.getItem(PREFERENCE));
    return Number.isInteger(n) && n >= 1 && n <= 60 ? n : DEFAULT_MINUTES;
  } catch { return DEFAULT_MINUTES; }
}
function subscribeMinutes(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE, onChange);
  };
}
function setMinutes(n: number) {
  try { localStorage.setItem(PREFERENCE, String(n)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(CHANGE));
}

type MonitorStatus = 'off' | 'starting' | 'ready' | 'error';

/**
 * Opt-in only. The camera, video element, WASM and model all stay in this
 * browser. No frame, landmark, or attention event is posted to the server.
 * Leaving the route or pressing Stop releases every MediaStreamTrack.
 */
export function AttentionMonitor({ active }: { active: boolean }) {
  const minutes = useSyncExternalStore(subscribeMinutes, minutesSnapshot, () => DEFAULT_MINUTES);
  const [status, setStatus] = useState<MonitorStatus>('off');
  const [error, setError] = useState('');
  const [present, setPresent] = useState<boolean | null>(null);
  const [hasFace, setHasFace] = useState(false);
  const [awaySeconds, setAwaySeconds] = useState(0);
  const [alertOpen, setAlertOpen] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const landmarker = useRef<FaceLandmarker | null>(null);
  const interval = useRef<ReturnType<typeof setInterval> | null>(null);
  const generation = useRef(0);
  const attention = useRef<AttentionState>(INITIAL_ATTENTION);
  const baseline = useRef<Gaze | null>(null);
  const latestGaze = useRef<Gaze | null>(null);
  const activeRef = useRef(active);
  const minutesRef = useRef(minutes);
  const dismiss = useRef<HTMLButtonElement>(null);

  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { minutesRef.current = minutes; }, [minutes]);

  const release = useCallback(() => {
    generation.current += 1;
    if (interval.current) clearInterval(interval.current);
    interval.current = null;
    landmarker.current?.close();
    landmarker.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    attention.current = INITIAL_ATTENTION;
    latestGaze.current = null;
  }, []);

  useEffect(() => () => release(), [release]);
  useEffect(() => {
    if (alertOpen) dismiss.current?.focus();
  }, [alertOpen]);

  const stop = () => {
    release();
    setStatus('off');
    setPresent(null);
    setHasFace(false);
    setAwaySeconds(0);
    setAlertOpen(false);
    setError('');
  };

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('Camera access requires a supported browser and HTTPS.');
      return;
    }
    setStatus('starting');
    setError('');
    const run = ++generation.current;
    let acquired: MediaStream | null = null;
    let model: FaceLandmarker | null = null;
    try {
      // Camera permission is requested only from this explicit button press.
      acquired = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: 640, height: 480 } });
      if (run !== generation.current) { acquired.getTracks().forEach((track) => track.stop()); return; }
      stream.current = acquired;
      acquired.getVideoTracks()[0]?.addEventListener('ended', () => {
        if (run !== generation.current) return;
        release();
        setStatus('error');
        setError('Camera disconnected. Reconnect it and retry when you want to.');
      }, { once: true });
      if (!video.current) throw new Error('Video element unavailable');
      video.current.srcObject = acquired;
      await video.current.play();

      // Loaded only when requested, from same-origin static assets. The model
      // sees local video frames; it makes no inference request to a service.
      const { FaceLandmarker, FilesetResolver } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks('/mediapipe');
      model = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/mediapipe/face_landmarker.task', delegate: 'CPU' },
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      if (run !== generation.current) { model.close(); return; }
      landmarker.current = model;
      setStatus('ready');

      let lastVideoTime = -1;
      let lastSample = performance.now();
      interval.current = setInterval(() => {
        const camera = video.current;
        if (!camera || camera.readyState < 2 || !landmarker.current) return;
        if (camera.currentTime === lastVideoTime) return;
        lastVideoTime = camera.currentTime;
        const now = performance.now();
        // A suspended tab is not proof that someone looked away. Require a
        // fresh continuous run of samples rather than counting the gap.
        if (now - lastSample > 5_000 || !activeRef.current) attention.current = INITIAL_ATTENTION;
        lastSample = now;
        if (!activeRef.current) { setPresent(null); setAwaySeconds(0); return; }
        try {
          const landmarks = landmarker.current.detectForVideo(camera, now).faceLandmarks[0];
          const gaze = gazeFromLandmarks(landmarks);
          latestGaze.current = gaze;
          setHasFace(Boolean(gaze));
          const looking = looksAtScreen(gaze, baseline.current ?? undefined);
          setPresent(looking);
          const prior = attention.current;
          const next = advanceAttention(prior, looking, now, minutesRef.current * 60_000);
          attention.current = next;
          setAwaySeconds(next.awaySince === null ? 0 : Math.floor((now - next.awaySince) / 1000));
          if (!prior.alerted && next.alerted) setAlertOpen(true);
        } catch {
          release();
          setStatus('error');
          setError('Eye detection stopped unexpectedly. You can retry.');
        }
      }, 850);
    } catch (cause) {
      if (run !== generation.current) return;
      if (model && landmarker.current !== model) model.close();
      release();
      setStatus('error');
      setError(cause instanceof DOMException && cause.name === 'NotAllowedError'
        ? 'Camera permission was declined. You can still use the timer.'
        : 'Camera or eye model could not start. You can still use the timer.');
    }
  };

  return (
    <section className="skin-card relative border border-hairline bg-surface p-4 sm:p-5" aria-labelledby="attention-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-xl">
          <div className="flex items-center gap-2">
            <ScanFace className="size-5 text-accent" aria-hidden />
            <h2 id="attention-title" className="text-sm font-semibold text-ink">Eyes-on-screen reminder</h2>
            <span className="skin-pill border border-hairline px-2 py-0.5 text-micro text-ink-muted">Optional</span>
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
            A camera-based estimate of whether your face and eyes point toward the screen. It can be wrong with glasses, lighting or an off-axis camera. Frames stay in this browser; no video or gaze data is saved or uploaded.
          </p>
        </div>
        {status === 'ready' || status === 'starting' ? (
          <Button type="button" variant="outline" className="min-h-11" onClick={stop}>
            <CameraOff className="size-4" /> Stop camera
          </Button>
        ) : (
          <Button type="button" variant="outline" className="min-h-11" onClick={() => void start()}>
            <Camera className="size-4" /> {status === 'error' ? 'Retry camera' : 'Enable camera'}
          </Button>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-hairline pt-4">
        <label htmlFor="away-threshold" className="text-xs font-medium text-ink-2">Alert after</label>
        <select
          id="away-threshold"
          value={minutes}
          onChange={(e) => setMinutes(Number(e.target.value))}
          className="skin-pill min-h-11 border border-control bg-surface-2 px-3 text-xs text-ink focus-visible:outline-2 focus-visible:outline-accent"
        >
          {Array.from({ length: 60 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n} minute{n === 1 ? '' : 's'}</option>)}
        </select>
        <span className="text-xs text-ink-muted">of continuous looking away during a focus session</span>
      </div>

      {status !== 'off' && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs" role="status">
          <span className={`inline-flex size-2 rounded-full ${status === 'error' ? 'bg-critical' : 'bg-accent'}`} aria-hidden />
          <span className="font-medium text-ink-2">
            {status === 'starting' ? 'Starting camera and local eye model…'
              : status === 'error' ? 'Camera off'
              : !active ? 'Camera on · reminders paused outside a running focus session'
              : present === null ? 'Camera on · finding your face…'
              : present ? 'Looking at screen' : `Looking away · ${Math.floor(awaySeconds / 60)}:${String(awaySeconds % 60).padStart(2, '0')}`}
          </span>
          {status === 'ready' && hasFace && (
            <button
              type="button"
              onClick={() => { baseline.current = latestGaze.current; attention.current = INITIAL_ATTENTION; setAwaySeconds(0); }}
              className="skin-pill ml-auto min-h-11 px-3 text-xs text-accent hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
            >
              Calibrate while looking at screen
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-critical" role="alert">{error}</p>}
      <video ref={video} muted playsInline className="pointer-events-none absolute size-px opacity-0" aria-hidden />

      {alertOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-4" role="alertdialog" aria-modal="true" aria-labelledby="away-alert-title" aria-describedby="away-alert-description">
          <div className="skin-card w-full max-w-xl border-2 border-critical bg-surface p-6 text-center shadow-2xl sm:p-10">
            <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-critical/15 text-critical">
              {present ? <Eye className="size-9" /> : <EyeOff className="size-9" />}
            </div>
            <h2 id="away-alert-title" className="mt-4 text-3xl font-bold tracking-tight text-ink sm:text-4xl">Look back at the screen</h2>
            <p id="away-alert-description" className="mt-3 text-base text-ink-2">
              The camera estimated you were looking away for at least {minutes} minute{minutes === 1 ? '' : 's'}. Take a moment, then continue when ready.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Button ref={dismiss} type="button" className="min-h-12 px-6" onClick={() => setAlertOpen(false)}>I’m back</Button>
              <Button type="button" variant="outline" className="min-h-12" onClick={stop}>Stop camera</Button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
