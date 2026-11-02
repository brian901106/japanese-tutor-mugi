// Chat types shared by the tutor screen, the Claude brain and the tutor's saved history.
import type { LookupLevel } from './lookup';

/** reply tones: how she says it, read from her meta tag (no gesture is played in this app) */
export type Tone =
  | 'explain' | 'agree' | 'nod' | 'ask' | 'confused' | 'refuse' | 'think' | 'greet' | 'bye' | 'happy' | 'shy' | 'angry'
  | 'surprised' | 'sad';

/**
 * `sent`: for a message of yours, the exact string sent to Claude (situation prefix included), fixed when it was sent so the
 * prompt cache stays valid; `win`: marks the line where the request window restarts (claudeBrain.markWindowReset or
 * markIdleReset); `tip`: her 小提醒 (teacher mode), shown in its own bubble and never voiced; `topic`: her 開話題 line
 * (a pocket topic she opened with, not a reply to anything), so an idle check can skip it (claudeBrain.isTopicLine);
 * `pk`: the persona key (claudeBrain.personaKey) the line was sent under: yours and hers, a tip too; a change of persona
 * restarts the request window at the new line (claudeBrain.markPersonaReset). Old saves have none. `tipLevel`: the JLPT level
 * badge of a tip line (undefined when there is none, and in old saves).
 */
export type ChatLine = {
  from: 'me' | 'her'; text: string; t: number; sent?: string; win?: boolean; tip?: boolean; topic?: boolean; pk?: string; tipLevel?: LookupLevel;
};
