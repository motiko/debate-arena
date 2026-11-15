# Debate Arena

A public platform where Debates are argued, then decided by an AI Judge and by the audience.

## Language

### Running a Debate

**Debate**:
A structured argument between two opposing Debaters, watched and voted on by an audience.
_Avoid_: Match, battle, round

**Motion**:
The claim a Debate is about, phrased so one can be For or Against it (e.g. "This house believes remote work is better").
_Avoid_: Topic, subject, prompt, question

**Side**:
One of a Motion's two positions: For or Against.
_Avoid_: Pro/Con, Proposition/Opposition, team

**Debater**:
A participant arguing one Side of a Debate; either a human or an AI.
_Avoid_: Player, contestant, bot

**Format**:
The rules that structure a Debate: its ordered Phases and which Side speaks in each, its Rubric, and its Voting Method.
_Avoid_: Template, mode, ruleset, style

**Phase**:
A named stage of a Format, such as Opening, Rebuttal or Closing. Each Phase sets the word and time limits for its Turns.
_Avoid_: Round, stage, section

**Budget**:
The total AI cost a Debate may consume, covering its AI Debaters, Judges, AI Voters and Motion screening. Reserved in full before the Debate begins; unused cost is returned.
_Avoid_: Credits, allowance, cost limit

**Quota**:
How many Debates a Member may start per day. A Slow Debate counts as less than a full Debate.
_Avoid_: Budget, limit, credits, allowance

**Rubric**:
The criteria a Judge scores a Debate against. Each Format has its own Rubric.
_Avoid_: Scoring guide, criteria, scorecard

**Turn**:
One contribution by one Debater within a Phase.
_Avoid_: Message, speech, argument, post

**Venue**:
A place where a Debate is presented and its audience takes part: the web app, the CLI, or later a Telegram channel, WhatsApp group, IRC channel or Zoom call. One Debate can be in many Venues at once, and Audience Votes from all of them form one Audience Result.
_Avoid_: Platform, channel, client, frontend, integration

**Premiere**:
A Debate shown live at a scheduled time, with before-voting open until it starts and Turns revealed at a human pace.
_Avoid_: Live, broadcast, event, stream

**On-Demand**:
A Debate that can be watched at any time rather than at a scheduled moment, either from the start or as a replay after its Premiere.
_Avoid_: Replay, recording, VOD

**Slow Debate**:
A Debate generated entirely through slower, cheaper batch processing and published only once complete. Always labeled as such; it uses only batch-capable models, costs less of a Member's quota, has no Premiere and takes no Audience Votes, so its outcome is the Verdict and, if it has AI Voters, the AI Audience Result. In code and the API it is the `batch` kind, after the providers' Batch APIs it runs on.
_Avoid_: Batch Debate (in anything a Viewer reads), offline debate, async debate, background debate, delayed debate, cheap debate

### People

**Viewer**:
Anyone watching a Debate, signed in or not.
_Avoid_: Visitor, spectator, audience member

**Member**:
A Viewer with an account; only Members can cast Audience Votes and start Debates.
_Avoid_: User, account, subscriber

**API token**:
A secret a Member creates on their account page so a Venue that is not a browser, such as the CLI, can start Debates as them. Shown once, revocable, and it expires.
_Avoid_: API key, access token, personal access token

**AI Voter**:
An AI model that casts votes on a Debate under the Format's Voting Method, standing in for the audience. A Debate has AI Voters only if its starting Member opts in; the platform chooses which models, and any AI Voter that is the same model as a Debater is disclosed, as with Self-Judging.
_Avoid_: Bot voter, synthetic voter, AI Judge

**AI Audience Result**:
The outcome produced by a Debate's AI Voters. Shown alongside the Verdict and the Audience Result, never merged with either.
_Avoid_: AI poll, model consensus

### Moderation

**Moderator**:
A person with authority to Block Debates.
_Avoid_: Admin, mod, reviewer

**Flag**:
An automatic AI marking of a Motion as potentially abusive. A Flag never removes anything by itself.
_Avoid_: Warning, strike, auto-block

**Unlisted**:
A Debate reachable by direct link but absent from public feeds. A Debate becomes Unlisted when Flagged or when it reaches the Report threshold, and stays so until a Moderator reviews it.
_Avoid_: Hidden, private, pending

**Report**:
A complaint, by anyone, that a Debate is abusive or illegal. Only Members' Reports count toward Unlisting.
_Avoid_: Flag, complaint, ticket

**Block**:
A Moderator's decision to take a Debate down so it is no longer visible.
_Avoid_: Ban, delete, remove, takedown

### Deciding a Debate

**Judge**:
An AI model that evaluates a finished Debate against the Format's Rubric and decides which Side won.
_Avoid_: Referee, scorer, evaluator

**Panel**:
The set of one or more Judges assigned to a Debate. The platform suggests the Panel; the starting Member may override it.
_Avoid_: Jury, committee, judges

**Self-Judging**:
A Judge on the Panel is the same model as one of the Debaters. Always disclosed to Viewers alongside the Verdict.
_Avoid_: Conflict of interest, bias, same-model

**Verdict**:
The Panel's decision on which Side won a Debate, with its reasoning. Always names one Side; never a draw.
_Avoid_: Ruling, score, result

**Voting Method**:
How a Format collects Audience Votes and turns them into an Audience Result, including when voting closes and the result becomes final. The default is Oxford: before-and-after votes decided by Swing.
_Avoid_: Voting mode, ballot type, scoring

**Audience Vote**:
A Member's stated position on the Motion: For, Against, or Undecided. Under the Oxford Voting Method it is cast once before the Debate and once after.
_Avoid_: Poll, rating, like

**Swing**:
The change in support for a Side between before-votes and after-votes, counting only Members who cast both.
_Avoid_: Delta, shift, momentum

**Audience Result**:
The audience's outcome of a Debate, decided by the Format's Voting Method (under Oxford, the Side with the larger Swing). Shown alongside the Verdict, never merged with it.
_Avoid_: Popular vote, crowd score
