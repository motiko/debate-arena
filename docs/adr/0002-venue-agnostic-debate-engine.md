# Venue-agnostic Debate engine behind a platform API

Debates must eventually run in many Venues: the web app and CLI first, later a Telegram channel, a WhatsApp group, an IRC channel or a Zoom call. So the Debate engine knows nothing about any Venue: it runs Debates and exposes them through one platform API, and every Venue, including our own web app and CLI, is a client of that API that presents Debates in its own medium (text messages, rendered pages, speech).

## Consequences

- Turns are Venue-neutral content; formatting, chunking and text-to-speech belong to the Venue.
- Anything a Venue needs (starting a Debate, following it live, casting Audience Votes) must be available through the API, not built into one front-end.
- The CLI is a platform client, not a standalone local runner.
- Initially only the web Venue accepts Audience Votes; other Venues (including the CLI) show Debates and link to the web to vote. Opening voting to another Venue first requires linking its identities to Members, so one person still gets one vote pair per Debate.
