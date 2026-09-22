'use client';

/**
 * The browser's own speech in and speech out.
 *
 * Zero dependency and zero extra cost on both sides: recognition is the Web
 * Speech API, synthesis is `speechSynthesis`. Neither is universally
 * available — recognition in particular is Chrome and Edge and not much else —
 * so both are capability-checked and the panel always has a typed path that
 * works without either.
 *
 * Voice OUT is off by default and opts in once, exactly like the tick sound in
 * effects.ts. An app that starts talking the first time you open a panel reads
 * as broken. Voice IN is stronger than a preference: it is a per-use click
 * every time, never remembered, because a microphone that switches itself on
 * because you once said yes is not something to ship.
 */
import { announce } from './appearance';

// --------------------------------------------------------------- preference
export const VOICE_KEY = 'jst-voice';

let cachedVoice: boolean | null = null;

/**
 * Whether replies are read aloud. On unless muted.
 *
 * This flipped when the companion became something you talk to rather than
 * type at: clicking the character is an unambiguous "talk to me", and
 * answering it silently would be the broken behaviour. Nothing here speaks
 * outside a conversation the person opened by clicking, and muting sticks.
 */
export function getVoice(): boolean {
  if (cachedVoice !== null) return cachedVoice;
  try {
    cachedVoice = localStorage.getItem(VOICE_KEY) !== 'off';
  } catch {
    cachedVoice = true;
  }
  return cachedVoice;
}

export function setVoice(on: boolean) {
  cachedVoice = on;
  try {
    localStorage.setItem(VOICE_KEY, on ? 'on' : 'off');
  } catch {
    /* ignore — it still applies for this session */
  }
  if (!on) stopSpeaking();
  announce();
}

export const serverVoice = (): boolean => true;

// -------------------------------------------------------------- speaking
/**
 * Reads a reply aloud, if and only if voice out is on.
 *
 * Cancels whatever is queued first: two replies talking over each other is
 * worse than a missed one, and there has to be a way to cut it off.
 */
/**
 * How natural a voice is likely to sound, higher is better.
 *
 * Browsers hand back whatever is installed and pick the first one by default,
 * which is almost always the worst — the flat formant-synth voice everyone
 * means when they say a computer sounds robotic. The good ones are there, they
 * just have to be asked for, and they are identifiable: the modern neural
 * voices say so in their name, and cloud voices report `localService: false`
 * because they are not the OS's built-in synthesiser.
 *
 * Pure and taking plain objects so the ranking can be tested without a browser.
 */
export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean };

export function voiceScore(voice: VoiceLike, lang = 'en'): number {
  const name = voice.name.toLowerCase();
  const language = (voice.lang || '').toLowerCase();
  const want = lang.toLowerCase().slice(0, 2);
  // A voice in the wrong language is not a candidate at any quality.
  if (want && language && !language.startsWith(want)) return -1;

  let score = 0;
  // The engines that actually sound like people announce it.
  if (/natural|neural/.test(name)) score += 60;
  if (/google/.test(name)) score += 30;
  // Cloud voices are the newer generation; local ones are the OS synthesiser.
  if (voice.localService === false) score += 25;
  // The ones people mean by "robotic".
  if (/espeak|compact|eloquence/.test(name)) score -= 60;
  if (/\bdavid\b|\bzira\b|\bmark\b/.test(name) && /desktop/.test(name)) score -= 30;
  // An exact regional match beats a generic one, gently.
  if (language === lang.toLowerCase()) score += 6;
  return score;
}

/** The best installed voice for a language, or null to leave it to the browser. */
export function pickVoice<T extends VoiceLike>(voices: readonly T[], lang = 'en'): T | null {
  let best: T | null = null;
  let bestScore = 0;
  for (const voice of voices) {
    const score = voiceScore(voice, lang);
    // Strictly better, so the first of equals wins and the choice is stable
    // between calls rather than flickering with list order.
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Breaks a reply into things to say one at a time.
 *
 * Two reasons. Some engines quietly truncate or stumble on a long utterance,
 * and speaking sentence by sentence puts a real pause at each full stop —
 * which is most of the difference between reading a paragraph and talking.
 */
export function splitForSpeech(text: string, max = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = clean.match(/[^.!?]+[.!?]*/g) ?? [clean];
  const out: string[] = [];
  for (const raw of sentences) {
    const sentence = raw.trim();
    if (!sentence) continue;
    const last = out[out.length - 1];
    // Glue short fragments back together — one-word sentences said alone
    // sound clipped.
    if (last && last.length + sentence.length + 1 <= max) out[out.length - 1] = `${last} ${sentence}`;
    else out.push(sentence);
  }
  return out;
}

let chosenVoice: SpeechSynthesisVoice | null = null;

/** Re-reads the installed voices. They arrive asynchronously in most browsers. */
function refreshVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (voices.length) {
      chosenVoice = pickVoice(voices, navigator?.language || 'en-GB');
    }
  } catch {
    chosenVoice = null;
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoice();
  try {
    // Chrome populates the list after a tick and fires this; without it the
    // first reply of a session gets the default robotic voice.
    window.speechSynthesis.addEventListener('voiceschanged', refreshVoice);
  } catch {
    /* older engines expose no event; the eager read above is all there is */
  }
}

/**
 * Reads a reply aloud, sentence by sentence, in the best voice available.
 *
 * `onDone` fires when the whole thing has been said — or immediately when
 * muted or unsupported, because the conversation loop hands the turn on from
 * there and would otherwise stop dead the first time someone hit mute.
 */
export function speak(text: string, onDone?: () => void) {
  const finish = () => onDone?.();
  if (!getVoice() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    finish();
    return;
  }

  const parts = splitForSpeech(text);
  if (!parts.length) {
    finish();
    return;
  }

  try {
    window.speechSynthesis.cancel();
    if (!chosenVoice) refreshVoice();

    parts.forEach((part, i) => {
      const utterance = new SpeechSynthesisUtterance(part);
      if (chosenVoice) utterance.voice = chosenVoice;
      // Close to a speaking voice rather than a reading one. The pitch used to
      // be 1.18, which is most of the way to sounding like a cartoon and was
      // making the flat default voice worse rather than better.
      utterance.rate = 1.0;
      utterance.pitch = 1.04;
      if (i === parts.length - 1) {
        utterance.onend = finish;
        // A synthesis error must not strand the conversation mid-turn either.
        utterance.onerror = finish;
      }
      window.speechSynthesis.speak(utterance);
    });
  } catch {
    finish();
  }
}

/** Cuts off whatever is being said, including everything still queued. */
export function stopSpeaking() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

export const canSpeak = (): boolean => typeof window !== 'undefined' && 'speechSynthesis' in window;

// -------------------------------------------------------------- listening
type RecognitionAlternative = { transcript: string };
type RecognitionResult = { 0: RecognitionAlternative; isFinal: boolean; length: number };
type RecognitionEvent = { resultIndex: number; results: { length: number } & Record<number, RecognitionResult> };
type RecognitionErrorEvent = { error: string };

type RecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type RecognitionWindow = Window & {
  SpeechRecognition?: new () => RecognitionLike;
  webkitSpeechRecognition?: new () => RecognitionLike;
};

function recognitionConstructor(): (new () => RecognitionLike) | null {
  if (typeof window === 'undefined') return null;
  const w = window as RecognitionWindow;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const canListen = (): boolean => recognitionConstructor() !== null;

/** What the caller needs to know while a dictation is running. */
export type ListenHandlers = {
  /** Fires as they speak. `final` marks the last version of a phrase. */
  onTranscript: (text: string, final: boolean) => void;
  /** Already translated — never a raw API error string. */
  onError: (message: string) => void;
  onEnd: () => void;
};

/**
 * Starts one dictation. Always returns a stop function.
 *
 * Every outcome — including "this browser cannot do it at all" — is reported
 * through the handlers rather than through the return value, and always
 * asynchronously. That is not ceremony: the caller starts this from an effect,
 * and a failure reported synchronously would be a state change caused by the
 * render that started it rather than by the microphone.
 *
 * Deliberately one-shot rather than continuous: an always-on microphone is
 * both a battery and a trust problem, and the panel's "stop" has to mean it.
 */
const NO_OP = () => {};

export function listen(handlers: ListenHandlers): () => void {
  const unavailable = () => {
    queueMicrotask(() =>
      handlers.onError('This browser will not do speech recognition. You can type instead.'),
    );
    return NO_OP;
  };

  const Recognition = recognitionConstructor();
  if (!Recognition) return unavailable();

  let recognition: RecognitionLike;
  try {
    recognition = new Recognition();
  } catch {
    return unavailable();
  }
  recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-GB' : 'en-GB';
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let text = '';
    let final = false;
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      text += result[0].transcript;
      if (result.isFinal) final = true;
    }
    handlers.onTranscript(text.trim(), final);
  };
  recognition.onerror = (event) => {
    handlers.onError(recognitionMessage(event.error));
  };
  recognition.onend = handlers.onEnd;

  try {
    recognition.start();
  } catch {
    // Already running, or blocked before it began.
    queueMicrotask(handlers.onEnd);
    return NO_OP;
  }

  return () => {
    try {
      recognition.abort();
    } catch {
      /* ignore */
    }
  };
}

/**
 * Turns a recognition error code into something worth reading.
 *
 * The codes are short machine strings — "not-allowed", "audio-capture" — and
 * showing them raw is the same mistake as showing Notion's error text.
 */
export function recognitionMessage(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Your browser is blocking the microphone. Allow it for this site, then try again.';
    case 'audio-capture':
      return 'No microphone was found.';
    case 'no-speech':
      return 'Nothing was picked up. Try again a little closer to the microphone.';
    case 'network':
      return 'Speech recognition needs a connection and could not reach it.';
    case 'aborted':
      return '';
    default:
      return 'The microphone stopped unexpectedly. You can type instead.';
  }
}
