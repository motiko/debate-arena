import type { Debater, ModelId } from '../domain';
import { InvalidPanelError } from '../errors';

export function modelFamily(model: ModelId): string {
  return model.split('/')[0] ?? model;
}

function aiModels(debaters: Debater[]): ModelId[] {
  return debaters.flatMap(d => (d.kind === 'ai' ? [d.model] : []));
}

/**
 * Suggests a Panel of `size` Judges (one or three; ADR 0008), each from a different model family where it can,
 * preferring families no AI Debater uses and never seating a Debater's own model unless nothing else fits.
 * Fewer candidates than `size` suggests one Judge.
 */
export function suggestPanel(debaters: Debater[], candidates: ModelId[], size: 1 | 3 = 3): ModelId[] {
  const first = candidates[0];
  if (first === undefined) throw new InvalidPanelError('No candidate Judges');
  const models = aiModels(debaters);
  const families = new Set(models.map(modelFamily));
  const unique = [...new Set(candidates)];
  if (size === 1 || unique.length < size) {
    const judge =
      unique.find(c => !families.has(modelFamily(c))) ??
      unique.find(c => !models.includes(c)) ??
      first;
    return [judge];
  }
  const panel: ModelId[] = [];
  const seated = new Set<string>();
  const take = (fits: (c: ModelId) => boolean) => {
    for (const c of unique) {
      if (panel.length === size) return;
      if (!panel.includes(c) && fits(c)) {
        panel.push(c);
        seated.add(modelFamily(c));
      }
    }
  };
  take(c => !families.has(modelFamily(c)) && !seated.has(modelFamily(c)));
  take(c => !models.includes(c) && !seated.has(modelFamily(c)));
  take(c => !models.includes(c));
  take(() => true);
  return panel;
}

export function isSelfJudging(panel: ModelId[], debaters: Debater[]): boolean {
  const models = aiModels(debaters);
  return panel.some(judge => models.includes(judge));
}

/** A Panel holds one Judge or three distinct ones, so a majority always decides (ADR 0008). */
export function validatePanel(panel: ModelId[]): void {
  if (panel.length !== 1 && panel.length !== 3) throw new InvalidPanelError(`A Panel must hold one or three Judges, got ${panel.length}`);
  if (new Set(panel).size !== panel.length) throw new InvalidPanelError('A Panel must not seat the same Judge twice');
}
