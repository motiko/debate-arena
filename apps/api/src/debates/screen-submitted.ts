import { screenMotion, type ModelClient, type ModelId, type ScreenedText } from '@debate-arena/engine';
import { flagDebate } from '../db/moderation';

/**
 * Screens text a Custom Debater submitted (a Turn, or its nickname and model), as a Motion is screened: a Flag
 * Unlists the Debate for a Moderator to review; it never removes anything. It fails closed: a failed screen, or no
 * screener to ask, Flags. It never throws.
 */
export async function screenSubmitted(
  screening: () => Promise<{ client: ModelClient; screener: ModelId }>,
  db: D1Database,
  debateId: string,
  text: string,
  what: Exclude<ScreenedText, 'motion'>,
): Promise<void> {
  let flagged = true;
  try {
    const { client, screener } = await screening();
    flagged = (await screenMotion(text, screener, client, { what })).flagged;
  } catch (error) {
    console.error(`Could not screen a submitted ${what} of Debate ${debateId}`, error);
  }
  if (flagged) await flagDebate(db, debateId);
}
