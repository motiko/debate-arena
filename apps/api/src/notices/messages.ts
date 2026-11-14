// The text of DSA notices (Arts. 16 and 17). Plain text, English.

export interface Notice {
  subject: string;
  text: string;
}

const signature = '\n\n— Debate Arena';

export function reportReceipt(debateUrl: string): Notice {
  return {
    subject: 'We received your Report',
    text:
      `Thank you for reporting this Debate:\n${debateUrl}\n\n` +
      'A Moderator will review it, and we will tell you what we decided. Reports are reviewed by a person.' +
      signature,
  };
}

export function reportDecision(debateUrl: string, action: 'relist' | 'block'): Notice {
  const outcome =
    action === 'block'
      ? 'A Moderator has blocked it. It is no longer visible.'
      : 'A Moderator reviewed it and found no breach of the law or our terms, so it stays visible (it is back in the feed).';
  return {
    subject: action === 'block' ? 'The Debate you reported was blocked' : 'Decision on the Debate you reported',
    text: `You reported this Debate:\n${debateUrl}\n\n${outcome}\n\nIf you disagree, reply to this email and a person will look at it again.${signature}`,
  };
}

export interface StatementOfReasons {
  debateUrl: string;
  motion: string;
  ground: 'illegal' | 'terms' | null;
  groundRef: string | null;
  explanation: string | null;
  decidedAt: string;
  automatedDetection: boolean;
  contact: string;
}

/** DSA Art. 17: what was restricted and how, the facts and grounds, whether automation was used, and redress. */
export function statementOfReasons(s: StatementOfReasons): Notice {
  const ground = s.ground === 'illegal' ? 'Illegal content' : 'Breach of our terms of use';
  return {
    subject: 'Your Debate was blocked: statement of reasons',
    text: [
      `A Moderator blocked your Debate on ${s.decidedAt.slice(0, 10)}:`,
      `“${s.motion}”`,
      s.debateUrl,
      '',
      'Restriction: the Debate is no longer visible, worldwide, with no end date.',
      `Ground: ${ground}${s.groundRef ? ` (${s.groundRef})` : ''}.`,
      `Explanation: ${s.explanation ?? '—'}`,
      s.automatedDetection
        ? 'It was first flagged by our automated (AI) screen; the decision to block it was made by a person.'
        : 'It was brought to our attention by Reports or by a Moderator; the decision was made by a person.',
      '',
      `To contest this decision, write to ${s.contact}; a person will review it again. You may also turn to a certified out-of-court dispute settlement body or to the courts.`,
    ].join('\n') + signature,
  };
}
