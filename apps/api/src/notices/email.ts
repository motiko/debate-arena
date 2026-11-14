// Transactional email for DSA notices. Scaleway Transactional Email keeps everything in the EU (ADR 0005);
// without it configured, notices are only logged (they stay visible in the app: Blocked page, data export).

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

const SCALEWAY = 'https://api.scaleway.com/transactional-email/v1alpha1/regions/fr-par/emails';

export class ScalewayEmailSender implements EmailSender {
  private readonly fetcher: typeof fetch;

  constructor(
    private readonly secretKey: string,
    private readonly projectId: string,
    private readonly from: string,
    fetcher?: typeof fetch,
  ) {
    this.fetcher = fetcher ?? ((input, init) => fetch(input, init));
  }

  async send(message: EmailMessage): Promise<void> {
    const response = await this.fetcher(SCALEWAY, {
      method: 'POST',
      headers: { 'X-Auth-Token': this.secretKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: { email: this.from },
        to: [{ email: message.to }],
        subject: message.subject,
        text: message.text,
        project_id: this.projectId,
      }),
    });
    if (!response.ok) throw new Error(`Scaleway email ${response.status}: ${await response.text().catch(() => '')}`);
  }
}

/** No email provider: logs that a notice would have gone out, without the address or the text. */
export class NoEmailSender implements EmailSender {
  async send(message: EmailMessage): Promise<void> {
    console.log(`Email not sent (EMAIL_PROVIDER "none"): ${message.subject}`);
  }
}

export interface EmailEnv {
  EMAIL_PROVIDER: string;
  EMAIL_FROM: string;
  SCALEWAY_SECRET_KEY?: string;
  SCALEWAY_PROJECT_ID?: string;
}

export function createEmailSender(env: EmailEnv): EmailSender {
  if (env.EMAIL_PROVIDER !== 'scaleway') return new NoEmailSender();
  if (!env.SCALEWAY_SECRET_KEY || !env.SCALEWAY_PROJECT_ID || !env.EMAIL_FROM) {
    throw new Error('EMAIL_PROVIDER "scaleway" needs SCALEWAY_SECRET_KEY, SCALEWAY_PROJECT_ID and EMAIL_FROM');
  }
  return new ScalewayEmailSender(env.SCALEWAY_SECRET_KEY, env.SCALEWAY_PROJECT_ID, env.EMAIL_FROM);
}
