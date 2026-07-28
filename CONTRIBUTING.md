# Contributing to Strumentario

Thanks for your interest. Strumentario is in the earliest public stage; the highest-leverage help right now is feedback on the vision, the initial CLI/server surface, and the eval strategy.

## Ways to help

1. **Open an issue** with a concrete use case, friction point, or design question.
2. **Try the Phase 1 server** once it lands and report what broke in your agent host.
3. **Small, focused PRs** once the foundation is tagged:
   - Additional tools or scorers
   - Improvements to the React MCP widget or AI SDK path
   - Docs, architecture notes, or failure postmortems
   - Scaffold recipes for common schemas

## Working agreements

- Prefer depth on MCP + evals + one surface over broad feature lists.
- Keep secrets out of the tree (`.env.example` only).
- Match the existing TypeScript and package structure.
- Every meaningful tool or scaffold change should ideally be accompanied by an eval case or a note in `docs/`.
- AGENTS.md / Cursor rules / skills in this repo describe how *agents working on Strumentario itself* should behave; keep them accurate.

## Development

```bash
# Once packages exist
npm install
npm run typecheck
npm test
# Eval suite (requires Braintrust keys)
npm run eval
```

See [ROADMAP.md](./ROADMAP.md) for the current phase and definition of done.

## Code of conduct

Be respectful. Assume good intent. Focus on the work.
