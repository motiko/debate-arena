import type { Format } from '../domain';

export const CLASSIC_FORMAT: Format = {
  id: 'classic',
  name: 'Classic',
  phases: [
    { name: 'Opening', order: ['for', 'against'], maxWords: 300, maxSeconds: 120 },
    { name: 'Rebuttal', order: ['for', 'against'], maxWords: 200, maxSeconds: 80 },
    { name: 'Closing', order: ['for', 'against'], maxWords: 150, maxSeconds: 60 },
  ],
  rubric: {
    criteria: [
      { name: 'Argument strength', description: 'Makes a clear, well-reasoned case for its Side of the Motion.' },
      { name: 'Rebuttal quality', description: "Engages directly with the other Side's strongest points." },
      { name: 'Evidence', description: 'Supports claims with accurate, relevant facts or examples.' },
      { name: 'Clarity', description: 'Is easy to follow, well structured and free of padding.' },
    ],
  },
  votingMethod: { kind: 'oxford', windowDays: 7 },
};
