# Why Strumentario is helpful

This is for developers and teams who already run Cursor or Claude Code against a Hindsight bank, often with more than one agent in play, and sometimes with an unattended pass later.
The bank already answers what is true in the project.
Strumentario answers a different question: what may be done to a piece of shared content, the same way, every time an agent touches it.

Related: [how the stack fits together](architecture/stack-seams.md) · [several agents at once](multi-agent.md) · [change journal](journal.md) · [Orto / Hindsight bank](orto-brain-details.md)

## Memory and the edit are different jobs

A host wired to your banks can recall a standard and then edit whatever file is open.
That recall stays in the host.
The write is an ordinary file change: the model picks a path, the editor applies a patch, and the record is git.
A second agent in another window can patch the same content with no revision check.
A retried turn can apply the same change twice.
Nothing on that path checks the draft against a schema before it lands, and nothing scores whether the agent validated first.
The bank made the agent better informed.
It did not give the write a contract.

Strumentario is that contract for a small content store.
The agent still recalls from the bank through Orto's own tools.
Strumentario never reads the bank, and the bank never calls Strumentario.
Putting both servers in one host config is the whole integration.
After recall, the agent calls the instruments: `query`, `validate`, and `mutate`.

`query` returns the page and its `revision`.
`validate` checks the draft and returns the errors.
`mutate` previews with `dryRun: true`, then writes only with `dryRun: false`, `expectedRevision`, and an `idempotencyKey`.
A stale revision comes back as `conflict` with the current page, so the agent merges and retries.
Replaying the same key does not write again.
The journal appends one line per outcome (`applied`, `dry_run`, `conflict`, `rejected`) with the agent id and no page body.

Those calls are the product.
Cursor, Claude Code, the CLI, `strumentario batch`, the widget, and the AI SDK path all use that list.
A Maglio stage can call them overnight with no editor and no model in the loop, and branch on `conflict` or `invalid` the same way a person would.
Read-only stages can hold `MCP_READ_TOKEN` and be refused on `mutate`.
The [tool-selection eval](evals/2026-11-10-agent-tool-selection.md) is how you tell whether a prompt change made the agent pick `validate` before `mutate`.

## A shared notebook

Long-term memory holds the rule: a handbook page needs a title, a slug, and a body, and you check a draft before you change the notebook.
Asking that memory is the bank.
You can recite the rule perfectly and still ruin the page, because remembering a standard does not perform the edit.
The edit is a separate procedure.
That procedure is Strumentario.

Picture two people and one notebook.

You recall the rule, then you look at the page as it is right now and notice which version you are holding.
That look is `query`, and the version is `revision`.
The rule in memory is not a copy of the page.
Working memory only has to hold the snapshot you just read.

Before the pen touches paper, you check the new wording against the rule.
That pause is `validate`.
If the slug is wrong, you fix the draft and check again.
The notebook has not changed.

Then you say the change out loud and wait.
That is `mutate` with `dryRun: true`.
The other person can hear exactly what would be written.
The page stays as it was until someone agrees.

When you do write, you write only if the page is still the version you read.
If the other person marked it while you were talking, you stop, read their version, and merge.
That is `expectedRevision` and a `conflict`.
You also notice when you already made this exact change, and you do not write it a second time.
That is the `idempotencyKey`.

Afterward you remember the act, not a second copy of the page: "I tried to update getting-started, and it landed," or "it conflicted."
That sparse episodic trace is the journal.
It records who acted and how it turned out.
It does not store the body.

Once that sequence is a habit, you can do it half asleep, and you can hand the same steps to a routine that runs overnight.
The routine does not re-derive the standard.
Declarative memory still holds why the rule exists.
The habit only runs look, check, preview, write, and stop if the page moved.
A Maglio stage calling the same tools is that habit with no one at the notebook.

| What you do with the notebook | In a person | In this stack |
| --- | --- | --- |
| Recall the rule | Semantic memory | Orto / Hindsight |
| Look at the page as it is now | A snapshot in working memory | `query` and its `revision` |
| Check the wording before ink | The pause before you commit | `validate` |
| Say the change out loud and wait | A preview the other person can hear | `mutate` with `dryRun: true` |
| Write only if the page has not moved | Re-read and merge | `expectedRevision`, or `conflict` with the current page |
| Refuse to do the same change twice | Recognizing the repetition | `idempotencyKey` |
| Remember the act, not a second copy of the page | An episodic trace | The [change journal](journal.md) |
| Run the same steps with no one watching | A habit | A Maglio stage calling the same tools |

A Cursor or Claude session on the bank alone is the person who remembers the rule vividly and then writes straight into the notebook from whatever they currently believe the page says.
Often that is enough, when you are the only person and the page is a file in front of you.
The procedure starts to matter when more than one person, or a later unattended pass, will touch the same page and you want every one of them to look, check, and write in the same order.

## When the bank is the whole workflow

Use the bank alone when the work is code, or a one-off edit in the repo you have open.
Add Strumentario when the artifact is shared content that more than one agent, or a later factory job, will read and write, and you want that write to be valid, attributable, and safe to retry.
Today that content is a handbook page (`title`, `slug`, `body`).
The bank keeps the standard.
The instruments are how a change to those notes survives a second agent.

The [multi-agent guide](multi-agent.md) walks through two agents racing on one page.
The [stack seams](architecture/stack-seams.md) name what Orto, Strumentario, and Maglio each own.
