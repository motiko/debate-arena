import type { DebateRecord } from '../db/debates';
import type { ModerationDecision } from '../db/moderation';
import type { EmailMessage, EmailSender } from './email';
import { reportDecision, reportReceipt, statementOfReasons } from './messages';

export interface NoticeDeps {
  db: D1Database;
  sender: EmailSender;
  /** The site's address, for links in notices. */
  siteUrl: string;
  /** Where people can reply to contest a decision. */
  contact: string;
}

/** Notices are best-effort: a failed email is logged, and never fails the Report or the decision. */
async function sendBestEffort(sender: EmailSender, message: EmailMessage): Promise<void> {
  try {
    await sender.send(message);
  } catch (error) {
    console.error(`Could not send "${message.subject}"`, error);
  }
}

const debateUrl = (deps: NoticeDeps, id: string) => `${deps.siteUrl.replace(/\/$/, '')}/debates/${id}`;

/** DSA Art. 16(4): confirm receipt to a reporter who left an email. */
export async function noticeReportReceived(deps: NoticeDeps, debateId: string, email: string): Promise<void> {
  await sendBestEffort(deps.sender, { to: email, ...reportReceipt(debateUrl(deps, debateId)) });
}

/**
 * After a Moderator's decision: tell every reporter since the previous review who left an email (DSA Art. 16(5)),
 * and on a Block send the author the statement of reasons (Art. 17), if their account still exists.
 */
export async function noticeDecision(
  deps: NoticeDeps,
  debate: DebateRecord,
  decision: ModerationDecision,
  previousReview: string | null,
): Promise<void> {
  const url = debateUrl(deps, debate.id);
  const { results: reporters } = await deps.db
    .prepare('SELECT DISTINCT reporter_email FROM reports WHERE debate_id = ? AND reporter_email IS NOT NULL AND created_at >= ?')
    .bind(debate.id, previousReview ?? '')
    .all<{ reporter_email: string }>();
  for (const { reporter_email } of reporters) {
    await sendBestEffort(deps.sender, { to: reporter_email, ...reportDecision(url, decision.action) });
  }

  if (decision.action !== 'block') return;
  // A deleted author's Debates carry a random id, so no account (and no email) is found.
  const author = await deps.db.prepare('SELECT email FROM "user" WHERE id = ?').bind(debate.memberId).first<{ email: string }>();
  if (!author?.email) return;
  await sendBestEffort(deps.sender, {
    to: author.email,
    ...statementOfReasons({
      debateUrl: url,
      motion: debate.setup.motion.text,
      ground: decision.ground,
      groundRef: decision.groundRef,
      explanation: decision.explanation,
      decidedAt: decision.decidedAt,
      automatedDetection: decision.automatedDetection,
      contact: deps.contact,
    }),
  });
}
