import type { Debater, ModelId } from '../domain';
import { InvalidPanelError } from '../errors';

export function modelFamily(model: ModelId): string {
  return model.split('/')[0] ?? model;
}

function aiModels(debaters: Debater[]): ModelId[] {
  return debaters.flatMap(d => (d.kind === 'ai' ? [d.model] : []));
}

/** Suggests a one-Judge Panel, preferring a model family no AI Debater uses. */
export function suggestPanel(debaters: Debater[], candidates: ModelId[]): ModelId[] {
  const first = candidates[0];
  if (first === undefined) throw new InvalidPanelError('No candidate Judges');
  const models = aiModels(debaters);
  const families = new Set(models.map(modelFamily));
  const judge =
    candidates.find(c => !families.has(modelFamily(c))) ??
    candidates.find(c => !models.includes(c)) ??
    first;
  return [judge];
}

export function isSelfJudging(panel: ModelId[], debaters: Debater[]): boolean {
  const models = aiModels(debaters);
  return panel.some(judge => models.includes(judge));
}

export function validatePanel(panel: ModelId[]): void {
  if (panel.length !== 1) throw new InvalidPanelError(`A Panel must hold exactly one Judge, got ${panel.length}`);
}
