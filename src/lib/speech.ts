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
export function speak(text: string, onDone?: () => void) {
  const finish = () => onDone?.();
  if (!getVoice() || typeof window === 'undefined' || !('speechSynthesis' in window)) {
    // Muted or unsupported still has to hand the turn back, or the loop stops
    // dead the first time someone mutes it.
    finish();
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.04;
    utterance.pitch = 1.18;
    utterance.onend = finish;
    // A synthesis error must not strand the conversation mid-turn either.
    utterance.onerror = finish;
    window.speechSynthesis.speak(utterance);
  } catch {
    finish();
  }
}

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
