import { motionData, sideLabel, UNTRUSTED_NOTICE } from '../debate/prompts';
import { MAX_ATTEMPTS, nextSlot } from '../debate/schedule';
import type { DebateSetup, ModelId, Motion, Stance, Turn } from '../domain';
import { DebateNotFinishedError, StanceParseError } from '../errors';
import type { ModelClient, ModelMessage } from '../models/client';
import { computeOxfordResult, type OxfordResult } from './oxford';

export const STANCE_OUTPUT_TOKENS = 10;

/** An Oxford result over AI Voters, plus the voter ids (`index:model`) left out for unparseable stances. */
export interface AiAudienceResult extends OxfordResult { dropped: string[] }

const STANCES: readonly Stance[] = ['for', 'against', 'undecided'];

export function parseStance(text: string): Stance | null {
  const first = text.trim().toLowerCase().match(/^\p{L}+/u)?.[0];
  return STANCES.find(s => s === first) ?? null;
}

function stanceMessages(motion: Motion, turns?: Turn[]): ModelMessage[] {
  const system = [
    'You are an audience member at a debate, voting on the Motion.',
    'Answer with exactly one English word: for, against or undecided.',
    UNTRUSTED_NOTICE,
  ].join('\n');
  const transcript = turns && JSON.stringify(turns.map(t => ({ side: sideLabel(t.side), text: t.text })), null, 2);
  const user = transcript
    ? `Motion: ${motionData(motion)}\n\nYou have heard the whole debate. Turns:\n${transcript}\n\nWhat is your position now?`
    : `Motion: ${motionData(motion)}\n\nThe debate has not started. What is your position?`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

/** Before-stance without `turns` (Motion only); after-stance with the full transcript. */
export async function castAiStance(motion: Motion, model: ModelId, client: ModelClient, turns?: Turn[]): Promise<Stance> {
  const messages = stanceMessages(motion, turns);
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const response = await client.complete({ model, messages, maxOutputTokens: STANCE_OUTPUT_TOKENS });
    const stance = parseStance(response.text);
    if (stance) return stance;
  }
  throw new StanceParseError(`${model} did not return a valid stance`);
}

/**
 * Runs every AI Voter's before- and after-stance on a finished Debate and returns the AI Audience Result.
 * A voter that never gives a valid stance is left out rather than failing the whole result, but is listed in
 * `dropped` so callers can disclose it, or reject the result when too many drop (a Turn may try to cause this).
 */
export async function runAiAudience(
  setup: DebateSetup,
  turns: Turn[],
  voters: ModelId[],
  client: ModelClient,
): Promise<AiAudienceResult> {
  if (nextSlot(setup.format, turns)) throw new DebateNotFinishedError('The Debate still has Turns to come');
  const settled = await Promise.allSettled(
    voters.map(async (model, index) => ({
      voterId: `${index}:${model}`,
      before: await castAiStance(setup.motion, model, client),
      after: await castAiStance(setup.motion, model, client, turns),
    })),
  );
  const dropped: string[] = [];
  settled.forEach((r, index) => {
    if (r.status === 'fulfilled') return;
    if (!(r.reason instanceof StanceParseError)) throw r.reason;
    dropped.push(`${index}:${voters[index]}`);
  });
  const votes = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
  return { ...computeOxfordResult(votes), dropped };
}
