import { formatTranscript, motionData, UNTRUSTED_NOTICE } from '../debate/prompts';
import { nextSlot } from '../debate/schedule';
import type { DebateSetup, ModelId, Side, Turn, Verdict } from '../domain';
import { DebateNotFinishedError, VerdictParseError } from '../errors';
import type { ModelClient, ModelMessage } from '../models/client';
import { validatePanel } from './panel';

export const JUDGE_OUTPUT_TOKENS = 800;

export function buildJudgeMessages(setup: DebateSetup, turns: Turn[]): ModelMessage[] {
  const rubric = setup.format.rubric.criteria.map(c => `- ${c.name}: ${c.description}`).join('\n');
  const system = [
    'You are the Judge of a structured debate. Decide which Side argued better.',
    `Score the debate against this Rubric:\n${rubric}`,
    'You must choose one Side, For or Against. A draw is not allowed.',
    'Reply with JSON only, in this shape: {"winner": "for" | "against", "reasoning": "<a few sentences>"}',
    "Write the reasoning in the Motion's language.",
    UNTRUSTED_NOTICE,
  ].join('\n\n');
  const user = `Motion: ${motionData(setup.motion)}\n\nTurns:\n${formatTranscript(setup.format, turns)}`;
  return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseVerdict(text: string): { winner: Side; reasoning: string } | null {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const { winner, reasoning } = value as Record<string, unknown>;
  if ((winner !== 'for' && winner !== 'against') || typeof reasoning !== 'string' || !reasoning.trim()) return null;
  return { winner, reasoning };
}

async function askJudge(setup: DebateSetup, turns: Turn[], judge: ModelId, client: ModelClient) {
  const messages = buildJudgeMessages(setup, turns);
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await client.complete({ model: judge, messages, maxOutputTokens: JUDGE_OUTPUT_TOKENS });
    const verdict = parseVerdict(response.text);
    if (verdict) return verdict;
  }
  throw new VerdictParseError(`${judge} did not return a valid Verdict`);
}

/** Asks the Panel for a Verdict on a finished Debate. Panels hold one Judge in this release. */
export async function judgeDebate(setup: DebateSetup, turns: Turn[], client: ModelClient): Promise<Verdict> {
  if (nextSlot(setup.format, turns)) throw new DebateNotFinishedError('The Debate still has Turns to come');
  validatePanel(setup.panel);
  const judge = setup.panel[0]!;
  const { winner, reasoning } = await askJudge(setup, turns, judge, client);
  return { winner, reasoning, judges: [...setup.panel] };
}
