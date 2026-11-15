// Everything the CLI prints goes through here. Motions, Turns and errors come from Members, models and servers,
// so control characters are dropped (an escape sequence could retitle or clear the terminal, or hide text);
// newlines and tabs stay. The API token is never printed, whatever a server or the network echoes back.

// Matching control characters is the point here.
// oxlint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export const printable = (text: string): string => text.replace(CONTROL, '');

export function safeOutput(
  sink: { out: (text: string) => void; err: (text: string) => void },
  token: string | undefined,
): { out: (text: string) => void; err: (text: string) => void } {
  const clean = (text: string) => printable(token ? text.split(token).join('[token]') : text);
  return { out: text => sink.out(clean(text)), err: text => sink.err(clean(text)) };
}
