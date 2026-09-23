/**
 * Whose turn it is.
 *
 * A spoken conversation is a loop — it greets you, listens, thinks, answers,
 * then listens again — and the bugs in one are all about the loop getting
 * stuck: listening while it is talking, talking over you, or quietly ending up
 * somewhere with no way back. That is a state machine, so it is written as one
 * here, pure, rather than as a pile of booleans inside a component.
 *
 * `canHear` and `canSpeak` are threaded through every transition because the
 * loop has to degrade honestly: a browser with no speech recognition never
 * enters `listening`, and one with no synthesis never enters `speaking`, and
 * in both cases the conversation still works by typing.
 */
export type Turn =
  /** Panel shut. */
  | 'closed'
  /** Saying hello, before anything has been asked. */
  | 'greeting'
  /** Microphone open, waiting for you. */
  | 'listening'
  /** Working out a reply. */
  | 'thinking'
  /** Reading a reply aloud. */
  | 'speaking'
  /** Open, but the loop is paused — you stopped it, or it ran out of things
   *  to hear. Always one tap from starting again. */
  | 'resting';

export type TurnEvent =
  | 'open'
  | 'close'
  /** Whatever was being said aloud has finished. */
  | 'spoke'
  /** Something was heard, and is about to be sent. */
  | 'heard'
  /** The microphone closed without hearing anything. Not an ending. */
  | 'silence'
  /** A reply came back. */
  | 'reply'
  /** Anything went wrong, at any point. */
  | 'error'
  /** The person asked it to stop. */
  | 'stop'
  /** The person asked it to start listening again. */
  | 'listen';

export type Capabilities = { canHear: boolean; canSpeak: boolean };

/** Where the loop goes after something is said aloud, or after a reply lands. */
const afterTalking = ({ canHear }: Capabilities): Turn => (canHear ? 'listening' : 'resting');

export function nextTurn(turn: Turn, event: TurnEvent, can: Capabilities): Turn {
  // These three win from anywhere, including mid-sentence. A stop control that
  // only works in some states is not a stop control.
  if (event === 'close') return 'closed';
  if (event === 'stop') return 'resting';
  if (event === 'error') return 'resting';

  switch (turn) {
    case 'closed':
      // Opening it is the whole gesture: it says hello out loud, and only
      // falls back to listening or waiting where it cannot.
      return event === 'open' ? (can.canSpeak ? 'greeting' : afterTalking(can)) : 'closed';

    case 'greeting':
    case 'speaking':
      if (event === 'spoke') return afterTalking(can);
      // Saying something while it is still talking interrupts it. This used
      // to be dropped on the floor, which left the turn in `speaking` with a
      // reply already on its way: no thinking dots, and when the first reply
      // finally finished the microphone opened underneath the second one.
      if (event === 'heard') return 'thinking';
      // Cutting it off to say something instead. The microphone is shut while
      // it talks — it would otherwise hear the companion and answer it — so
      // interrupting is a deliberate act rather than a barge-in, and it has to
      // land straight back in `listening` rather than in `resting`. Stopping
      // it and then having to press a second button to be heard is not an
      // interruption, it is two interruptions.
      if (event === 'listen') return can.canHear ? 'listening' : 'resting';
      return turn;

    case 'listening':
      if (event === 'heard') return 'thinking';
      // Quiet is not the end of the conversation. It used to stop the loop and
      // wait to be asked again, which meant every pause cost a button press —
      // the opposite of talking to someone.
      if (event === 'silence') return 'listening';
      return turn;

    case 'thinking':
      if (event === 'reply') return can.canSpeak ? 'speaking' : afterTalking(can);
      // Changed their mind before the reply landed. Same rule as above.
      if (event === 'listen') return can.canHear ? 'listening' : 'resting';
      return turn;

    case 'resting':
      if (event === 'listen') return can.canHear ? 'listening' : 'resting';
      // A typed message skips straight past the microphone.
      if (event === 'heard') return 'thinking';
      return turn;

    default:
      return turn;
  }
}

/** True while the conversation is waiting for you — the halo, the level meter. */
export const isHearing = (turn: Turn): boolean => turn === 'listening';

/**
 * True while the microphone should be open at all.
 *
 * Wider than `isHearing`, and that difference is what makes talking over it
 * possible. The microphone used to be shut for the whole time the companion
 * spoke, so that it could never hear itself and answer it — which also meant
 * there was no way to interrupt by talking, only by pressing something.
 *
 * It stays open through the speaking turns now, and what stops it hearing
 * itself is `isEcho` in speech.ts rather than a closed microphone: we know
 * exactly what the companion is saying, so anything that comes back matching
 * it is discarded instead of acted on.
 *
 * Not during `thinking`. There is nothing to interrupt — nothing is being
 * said — and whatever is heard there is a new thought, which `listening`
 * already handles once the reply lands.
 */
export const micOpen = (turn: Turn): boolean =>
  turn === 'listening' || turn === 'greeting' || turn === 'speaking';

/** True while something is being read aloud. */
export const isTalking = (turn: Turn): boolean => turn === 'greeting' || turn === 'speaking';

/**
 * The figure's pose for a turn.
 *
 * This is the whole status indicator. A spinner would tell you the same thing
 * and tell you nothing about who you are talking to.
 */
export function poseForTurn(turn: Turn): 'idle' | 'talking' | 'listening' | 'floating' {
  switch (turn) {
    case 'greeting':
    case 'speaking':
      return 'talking';
    case 'listening':
      return 'listening';
    case 'thinking':
      // Floating rather than casting: it loops, and a figure bobbing while it
      // works reads as "working" to someone who is not reading anything.
      return 'floating';
    default:
      return 'idle';
  }
}

/** One line of plain English for the live region. Never a state name. */
export function captionFor(turn: Turn, name: string): string {
  switch (turn) {
    case 'greeting':
    case 'speaking':
      return `${name} is talking…`;
    case 'listening':
      // Short on purpose. It sits under the name in a panel that is 360 px
      // wide on the smallest phone this has to work on, and a status line
      // that ends in an ellipsis because it did not fit is worse than one
      // that simply says less. The instruction it used to carry is on the
      // control it belongs to.
      return 'Listening';
    case 'thinking':
      // Deliberately nothing. The wait is shown — the figure bobs and three
      // dots move — rather than narrated. A label saying "Thinking…", or a
      // stock phrase said out loud to cover the gap, both draw attention to
      // the machinery instead of away from it.
      return '';
    case 'resting':
      return 'Paused';
    default:
      return '';
  }
}
