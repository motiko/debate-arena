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

**Custom Debater**:
A Debater whose Turns the starting Member submits through the platform API, written by hand or by their own program, instead of a platform model generating them. It may carry a nickname and a self-reported model, which the platform shows but does not verify. Its Turns are labelled as submitted via API, never as AI-generated. In code: `kind: 'api'`.
_Avoid_: API Debater (former name), Human Debater, external bot, BYO model

**Format**:
The rules that structure a Debate: its ordered Phases and which Side speaks in each, its Rubric, and its Voting Method.
_Avoid_: Template, mode, ruleset, style

**Phase**:
A named stage of a Format, such as Opening, Rebuttal or Closing. Each Phase sets the word and time limits for its Turns.
_Avoid_: Round, stage, section

**Budget**:
The total AI cost a Debate may consume, covering its AI Debaters, Judges, AI Voters and Motion screening and labelling. Reserved in full before the Debate begins; unused cost is returned.
_Avoid_: Credits, allowance, cost limit

**Quota**:
How many Quota points a Member may spend per day on starting Debates. A Debate costs points in proportion to its worst-case Budget, so free models and Slow Debates cost less and expensive models, Judges or AI Voters more.
_Avoid_: Budget, limit, credits, allowance

**Category**:
The broad subject a Debate belongs to, one from a fixed list (Politics, Economics, Technology, Science, Health, Environment, Philosophy, Society, Culture, Sport). Assigned by an AI model from the Motion and labelled as AI-generated; a Debate whose labelling failed has none.
_Avoid_: Topic, section, genre, channel

**Tag**:
A short lower-case label naming what a Debate is about, more specific than its Category (e.g. "remote work"). A Debate has up to three, assigned by an AI model with its Category.
_Avoid_: Keyword, hashtag, label

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
An AI model that casts votes on a Debate under the Format's Voting Method, standing in for the audience. A Debate has AI Voters only if its starting Member opts in and chooses how many; the platform chooses which models, and any AI Voter that is the same model as a Debater is disclosed, as with Self-Judging.
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
An AI model that decides, from a finished Debate's own arguments and evidence, whether the Motion stands, and scores how each Side argued against the Format's Rubric (ADR 0008).
_Avoid_: Referee, scorer, evaluator

**Panel**:
The one or three Judges assigned to a Debate, each answering on its own Ballot; three decide by majority. The platform suggests one Judge, or three from different model families on request; the starting Member may choose them instead.
_Avoid_: Jury, committee, judges

**Rubric Score**:
A Judge's mark from 1 to 10 for one Side on one Rubric criterion: how well that Side argued. The Verdict is on the Motion, not the sum of the Rubric Scores, so they may favour the Side that loses.
_Avoid_: Rating, points, grade

**Self-Judging**:
A Judge on the Panel is the same model as one of the Debaters. Always disclosed to Viewers alongside the Verdict.
_Avoid_: Conflict of interest, bias, same-model

**Verdict**:
The Panel's decision on whether the Motion stands (For) or falls (Against), on the arguments and evidence in the Debate, with its reasoning, Confidence, Crux and Claim Checks. Always names one Side; never a draw. Verdicts from before ADR 0008 said which Side debated better.

**Ballot**:
One Judge's answer on a Panel: its Side, Confidence, reasoning, Crux, Rubric Scores and Claim Checks. The Verdict shows the first Ballot on the majority Side.
_Avoid_: Vote (that is the audience's), opinion

**Confidence**:
How sure a Ballot is that the Motion stands or falls: clear, likely, or narrow ("too close to call").
_Avoid_: Probability, certainty, margin

**Crux**:
The one question a Debate's disagreement comes down to, named in the Verdict.
_Avoid_: Key issue, main point

**Claim Check**:
A factual claim one Side made, marked supported, disputed or false by a Judge from its own knowledge, without sources.
_Avoid_: Fact-check (implies sources), citation
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
The audience's outcome of a Debate, decided by the Format's Voting Method (under Oxford, the Side with the larger Swing). It measures persuasion, not who is right. Shown alongside the Verdict, never merged with it.
_Avoid_: Popular vote, crowd score
