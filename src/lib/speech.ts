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
import {
  autoNatural,
  kokoroReady,
  kokoroVoice,
  loadEngine,
  primeKokoroAudio,
  speakKokoro,
  stopKokoro,
} from './kokoro';

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
  // The engines that actually sound like people say so in their own name.
  if (/natural|neural/.test(name)) score += 60;
  if (/siri/.test(name)) score += 50;
  // Apple ships a plain and a good version of the same voice under one name,
  // distinguished only by this suffix. The plain one is the robot.
  if (/\(enhanced\)|\(premium\)/.test(name)) score += 45;
  if (/google/.test(name)) score += 30;
  // Cloud voices are the newer generation; local ones are the OS synthesiser.
  if (voice.localService === false) score += 25;
  // The ones people mean by "robotic".
  if (/espeak|festival|pico|flite|mbrola|compact|eloquence/.test(name)) score -= 80;
  // Apple's novelty voices are in the same list as the real ones and are not
  // voices anyone wants to be spoken to by.
  if (/zarvox|trinoids|bubbles|bahh|boing|deranged|hysterical|wobble|whisper|bells|cellos|organ|good news|bad news|jester|superstar|albert|junior|ralph|bruce|kathy|fred/.test(name)) {
    score -= 70;
  }
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
export function sayable(text: string): string {
  return (
    text
      // Nothing inside a code fence is worth reading out.
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\*\*?([^*]+)\*\*?/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/^[ \t]*[#>*-]+[ \t]+/gm, '')
      .replace(/[_~]/g, ' ')
      // A dash is a beat in writing and a stumble in synthesis; a comma is the
      // same beat and every engine knows what to do with it.
      .replace(/[\u2014\u2013]/g, ', ')
      .replace(/\u2026/g, '...')
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2018\u2019]/g, "'")
      // Emoji read aloud as their own names, which is worse than silence.
      .replace(/[\u{1f300}-\u{1faff}\u{2190}-\u{27bf}\u{fe0f}]/gu, '')
      .replace(/\s+/g, ' ')
      .replace(/ ([,.!?])/g, '$1')
      .trim()
  );
}

/**
 * How a sentence should be said, as opposed to merely read.
 *
 * A voice that says every sentence at exactly one rate and one pitch is the
 * other half of sounding robotic — the half a better voice does not fix. This
 * is tiny and deliberate: a question lifts, an exclamation quickens, a long
 * sentence settles, and a repeating drift keeps two sentences in a row from
 * being acoustically identical. Deterministic, so it is testable and so the
 * same reply is said the same way twice.
 */
export function prosody(sentence: string, index: number): { rate: number; pitch: number } {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const drift = [0, 0.035, -0.025, 0.015][index % 4];
  let rate = 1.02 + drift;
  let pitch = 1.03 + drift * 0.8;
  if (/\?["')]*\s*$/.test(sentence)) {
    pitch += 0.07;
    rate -= 0.03;
  }
  if (/!["')]*\s*$/.test(sentence)) {
    pitch += 0.04;
    rate += 0.04;
  }
  if (sentence.length > 90) rate -= 0.02;
  return { rate: clamp(rate, 0.85, 1.2), pitch: clamp(pitch, 0.9, 1.25) };
}

/**
 * Pulls finished sentences out of a buffer that is still being written to.
 *
 * The reply arrives a few characters at a time, and the whole point is to
 * start speaking before it has finished arriving. This returns the sentences
 * that are definitely complete and whatever is left over, so the leftover can
 * wait for the rest of itself.
 *
 * A sentence is only complete when something follows the full stop — without
 * that rule "3." in "3.5" would be a sentence, and so would every half-typed
 * abbreviation. `min` keeps a stray "Oh." from becoming its own utterance
 * with all the gap that implies, while still being short enough that the
 * first thing said arrives quickly.
 */
export function cutSentences(buffer: string, min = 10): [string[], string] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < buffer.length - 1; i++) {
    const c = buffer[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '\n') continue;
    // Run past "?!" and "..." so they stay with the sentence they belong to.
    let end = i;
    while (end + 1 < buffer.length && '.!?'.includes(buffer[end + 1])) end++;
    const after = buffer[end + 1];
    if (after !== undefined && !/\s/.test(after)) continue;
    const sentence = buffer.slice(start, end + 1).trim();
    if (sentence.length < min) continue;
    out.push(sentence);
    start = end + 1;
    i = end;
  }
  return [out, buffer.slice(start)];
}

export function splitForSpeech(text: string, max = 180): string[] {
  const clean = sayable(text);
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
let voiceList: { name: string; lang: string }[] = [];

/**
 * Which voice to use, by name, when the person has chosen one.
 *
 * Scoring gets the best voice *installed*, and on some machines the best one
 * installed is still not good. Rather than keep guessing at that from here,
 * the panel offers the list and this remembers the answer.
 */
export const VOICE_NAME_KEY = 'jst-voice-name';

let preferredName: string | null | undefined;

export function getVoiceName(): string {
  if (preferredName === undefined) {
    try {
      preferredName = localStorage.getItem(VOICE_NAME_KEY);
    } catch {
      preferredName = null;
    }
  }
  return preferredName ?? '';
}

export function setVoiceName(name: string) {
  preferredName = name || null;
  try {
    if (name) localStorage.setItem(VOICE_NAME_KEY, name);
    else localStorage.removeItem(VOICE_NAME_KEY);
  } catch {
    /* ignore — it still applies for this session */
  }
  refreshVoice();
  // Chosen is chosen: start fetching it now rather than at the first reply,
  // so the download overlaps with whatever is said next.
  const natural = naturalVoice();
  if (natural) void loadEngine(natural);
  announce();
}

export const serverVoiceName = (): string => '';

/**
 * The natural voice to use right now, or null to use the browser's.
 *
 * An explicit choice always wins, in both directions: picking a browser voice
 * by name turns the natural one off. With no choice made, a capable device
 * gets a natural voice anyway — which is the point. Leaving it behind a
 * dropdown meant the default was still the flat synthesiser everybody was
 * complaining about, and a default nobody finds is not a feature.
 */
export function naturalVoice(): string | null {
  const preference = getVoiceName();
  return preference ? kokoroVoice(preference) : autoNatural();
}

/**
 * The installed voices, best first.
 *
 * A stable array reference, rebuilt only when the browser's list actually
 * changes, because this is read through `useSyncExternalStore` and a fresh
 * array every call is an infinite render.
 */
export function listVoices(): { name: string; lang: string }[] {
  return voiceList;
}

export const serverVoiceList = (): { name: string; lang: string }[] => [];

/** Re-reads the installed voices. They arrive asynchronously in most browsers. */
function refreshVoice() {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return;
    const lang = navigator?.language || 'en-GB';

    const ranked = voices
      .map((v) => ({ name: v.name, lang: v.lang, score: voiceScore(v, lang) }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    // Voices in another language are not candidates, and a list of ninety of
    // them is not a menu. They are only worth offering if there is nothing in
    // the right language at all.
    const usable = ranked.filter((v) => v.score >= 0);
    const next = (usable.length ? usable : ranked).map(({ name, lang: l }) => ({ name, lang: l }));
    // Only a new array when it is genuinely a new list. `listVoices` is read
    // through `useSyncExternalStore`, which compares by reference.
    const same =
      next.length === voiceList.length && next.every((v, i) => v.name === voiceList[i].name);
    if (!same) voiceList = next;

    const wanted = getVoiceName();
    chosenVoice =
      (wanted ? (voices.find((v) => v.name === wanted) ?? null) : null) ?? pickVoice(voices, lang);
  } catch {
    chosenVoice = null;
  }
}

if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  refreshVoice();
  try {
    // Chrome populates the list after a tick and fires this; without it the
    // first reply of a session gets the default robotic voice.
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      refreshVoice();
      // The picker is rendered from this list, so it has to hear about it.
      announce();
    });
  } catch {
    /* older engines expose no event; the eager read above is all there is */
  }
}

/**
 * Unlocks audio, from inside the tap that asked for it.
 *
 * Mobile Safari will not start speech or audio that did not begin in a user
 * gesture, and "in a gesture" means synchronously inside the handler — not in
 * an effect after the panel mounts, and not after a `setTimeout`. Anything
 * later is silently refused, and because the refusal is silent the `onend`
 * that hands the conversation on never fires either, so the whole thing
 * stalls at hello. This is the one call that has to be made from the tap.
 *
 * Both engines need it: `speechSynthesis` wants one utterance, and an
 * `AudioContext` starts suspended and needs resuming. Both are cheap and both
 * are safe to repeat.
 */
export function primeAudio() {
  if (typeof window === 'undefined') return;
  try {
    if ('speechSynthesis' in window) {
      // A single space rather than an empty string: some engines drop an
      // empty utterance without counting it as the unlock.
      const nudge = new SpeechSynthesisUtterance(' ');
      nudge.volume = 0;
      window.speechSynthesis.speak(nudge);
      window.speechSynthesis.resume();
    }
  } catch {
    /* an engine that refuses is an engine we fall back from anyway */
  }
  primeKokoroAudio();
  primeMicrophone();
}

/**
 * Whether the microphone has been granted, as far as we have been told.
 *
 * `null` means nobody has asked yet.
 */
let micReady: boolean | null = null;

/**
 * Gets the microphone permission out of the way up front.
 *
 * Speech recognition asks for the microphone the moment it starts, and while
 * that prompt is on screen it reports `not-allowed` — which the conversation
 * was treating as a real refusal and resting on. The result is the bug where
 * opening it does nothing and you have to press the microphone button
 * yourself afterwards, by which time permission has been granted and it
 * works. Asking here, inside the tap, means the prompt happens once, before
 * anything depends on the answer.
 *
 * Deliberately not awaited: the tap must not block on a dialogue, and the
 * conversation copes either way.
 */
export function primeMicrophone() {
  if (micReady !== null) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then((stream) => {
      // The permission is the point; the stream itself is not wanted, and
      // leaving it open would light the recording indicator for the session.
      stream.getTracks().forEach((track) => track.stop());
      micReady = true;
    })
    .catch(() => {
      micReady = false;
    });
}

/**
 * How long to wait for an engine to say it has finished before assuming it
 * never will.
 *
 * `onend` is not reliable. Mobile Safari drops it when a tab is backgrounded
 * mid-sentence, and a refused utterance fires nothing at all. Without a
 * backstop the conversation stops dead in `speaking` and the microphone never
 * reopens — which is exactly what "it does not work on my phone" looks like.
 */
export const SPEECH_WATCHDOG_MS = 6_000;

/**
 * How long to wait for an engine to make a sound before deciding it will not.
 *
 * A refused utterance — the usual outcome on mobile Safari when the gesture
 * has already ended — fires no events whatsoever. `onstart` is the difference
 * between "speaking, be patient" and "silently declined", and catching the
 * second case in under two seconds is the difference between a conversation
 * that recovers and one that looks broken.
 */
export const SPEECH_START_MS = 1_800;

/** Roughly how long something will take to say, in milliseconds. */
export function speakingTime(text: string): number {
  // About three words a second, plus a beat per sentence, plus headroom.
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const sentences = splitForSpeech(text).length || 1;
  return Math.min(60_000, 1_500 + (words / 3) * 1_000 + sentences * 400);
}

/**
 * Reads a reply aloud, sentence by sentence, in the best voice available.
 *
 * `onDone` fires when the whole thing has been said — or immediately when
 * muted or unsupported, because the conversation loop hands the turn on from
 * there and would otherwise stop dead the first time someone hit mute.
 */
export { loadEngine };

export function speak(text: string, onDone?: () => void, queue = false) {
  // Whichever comes first — the engine saying it is done, or the clock
  // deciding it never will. Called at most once either way, because handing
  // the same turn on twice would open the microphone under a live voice.
  let handed = false;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (handed) return;
    handed = true;
    if (watchdog) clearTimeout(watchdog);
    onDone?.();
  };
  const guard = () => {
    watchdog = setTimeout(finish, SPEECH_WATCHDOG_MS + speakingTime(text));
  };

  if (!getVoice() || typeof window === 'undefined') {
    finish();
    return;
  }

  // Until the model is ready the browser's own voice answers, so the natural
  // one never costs anyone a silent conversation while it downloads.
  const natural = naturalVoice();
  if (natural) {
    if (kokoroReady()) {
      guard();
      speakKokoro(sayable(text), natural, splitForSpeech, finish, queue);
      return;
    }
    void loadEngine(natural);
  }

  if (!('speechSynthesis' in window)) {
    finish();
    return;
  }

  const parts = splitForSpeech(text);
  if (!parts.length) {
    finish();
    return;
  }

  try {
    guard();
    // A queued line waits its turn, rather than cutting off what is already
    // being said.
    if (!queue) window.speechSynthesis.cancel();
    if (!chosenVoice) refreshVoice();

    // If nothing has made a sound by the time this fires, the engine refused
    // and is not going to say so. Cleared the moment anything starts.
    let began: ReturnType<typeof setTimeout> | null = setTimeout(finish, SPEECH_START_MS);
    const started = () => {
      if (began) clearTimeout(began);
      began = null;
    };

    parts.forEach((part, i) => {
      const utterance = new SpeechSynthesisUtterance(part);
      if (chosenVoice) utterance.voice = chosenVoice;
      utterance.onstart = started;
      // Close to a speaking voice rather than a reading one, and varied
      // sentence by sentence — see `prosody`.
      const { rate, pitch } = prosody(part, i);
      utterance.rate = rate;
      utterance.pitch = pitch;
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
  stopKokoro();
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

export const canSpeak = (): boolean =>
  typeof window !== 'undefined' && ('speechSynthesis' in window || 'AudioContext' in window);

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

/**
 * How long a pause has to be before it counts as "they have finished".
 *
 * Long enough to think mid-sentence without being cut off, short enough that
 * a finished sentence does not sit there. Chrome's own endpointing fires at
 * every natural pause, which is far too eager for a conversation — "so, um" on
 * its own is not a question.
 */
export const END_OF_THOUGHT_MS = 1100;

/**
 * How many refusals to sit through before believing one.
 *
 * The microphone permission prompt reports a refusal for as long as it is on
 * screen, so the first few mean "nobody has answered the dialogue yet" rather
 * than "no". Reading them literally is what made opening the panel appear to
 * do nothing at all.
 */
export const PATIENCE = 4;

/** Long enough that a refusal loop is not a spin, short enough to feel instant. */
export const RETRY_MS = 400;

export type ListenHandlers = {
  /** Fires as they speak, for the live caption. Never final. */
  onPartial: (text: string) => void;
  /** A finished thought, after they have stopped for a moment. */
  onUtterance: (text: string) => void;
  /** Already translated — never a raw API error string. */
  onError: (message: string) => void;
};

/**
 * Opens the microphone and keeps it open.
 *
 * Continuous, not one-shot. The old version stopped at the first pause and
 * needed a button press to start again, which is not a conversation — it is a
 * walkie-talkie. This stays open, collects what it hears, and hands over a
 * whole thought once they have actually stopped talking.
 *
 * It also restarts itself. Browsers end a recognition session on their own
 * after a stretch of quiet, and without this the microphone would quietly die
 * partway through a conversation with nothing on screen to say so.
 *
 * Returns a stop function that means it. Every outcome is reported through the
 * handlers and always asynchronously, because the caller starts this from an
 * effect and a failure reported synchronously would be a state change caused
 * by the render that started it rather than by the microphone.
 */
export function listen(handlers: ListenHandlers): () => void {
  const Recognition = recognitionConstructor();
  if (!Recognition) {
    queueMicrotask(() =>
      handlers.onError('This browser will not do speech recognition. You can type instead.'),
    );
    return () => {};
  }

  let recognition: RecognitionLike | null = null;
  let stopped = false;
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;

  const flush = () => {
    const text = pending.trim();
    pending = '';
    if (text) handlers.onUtterance(text);
  };

  const restartEndpoint = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, END_OF_THOUGHT_MS);
  };

  const open = () => {
    if (stopped) return;
    try {
      recognition = new Recognition();
    } catch {
      queueMicrotask(() =>
        handlers.onError('The microphone could not be opened. You can type instead.'),
      );
      return;
    }
    recognition.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-GB' : 'en-GB';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) pending += `${result[0].transcript} `;
        else interim += result[0].transcript;
      }
      handlers.onPartial((pending + interim).trim());
      restartEndpoint();
    };

    recognition.onerror = (event) => {
      // Quiet is not a failure when the microphone is meant to stay open.
      if (event.error === 'no-speech' || event.error === 'aborted') return;

      // A permission prompt that is still on screen reports exactly this, and
      // treating it as a refusal is what made opening the panel do nothing.
      // It is only a real refusal once we have asked a few times and kept
      // being told no.
      const fatal = event.error === 'not-allowed' || event.error === 'service-not-allowed';
      failures += 1;
      if (!fatal || failures > PATIENCE) {
        handlers.onError(recognitionMessage(event.error));
        stopped = true;
        return;
      }
      // Otherwise say nothing and let `onend` try again in a moment.
    };

    // Browsers end a session on their own after a stretch of quiet, and a
    // refused one ends immediately. Reopening is what makes "it keeps
    // listening" true; the delay is what keeps a refusal from becoming a spin.
    recognition.onend = () => {
      if (stopped) return;
      reopen(failures ? RETRY_MS : 0);
    };

    try {
      recognition.start();
      // A session that starts is a session that works; anything that went
      // wrong before this does not count against the next one.
      failures = 0;
    } catch {
      // Already running, or refused outright. Either way `onend` may never
      // come, so the retry has to be armed here as well.
      reopen(RETRY_MS);
    }
  };

  const reopen = (delay: number) => {
    if (stopped || retry) return;
    retry = setTimeout(() => {
      retry = null;
      open();
    }, delay);
  };

  open();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (retry) clearTimeout(retry);
    try {
      recognition?.abort();
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
