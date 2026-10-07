# Super Sketch Dudes

Deploy only from a clean checkout of master. Anything that needs to ship goes onto master first; a build from a branch or an uncommitted tree gets silently dropped by the next deploy.

Only push master. Old branches and backup/* contain personal data (the school and players' real names); .git/hooks/pre-push refuses anything else.

## Settled decisions
- The forge agent runs Opus at medium effort. Ben benched about 10 model/effort combinations on 10/1 and cheaper ones made less fun fighters; fun beats cost. Don't propose a cheaper model or lower effort for the forge.
- The moderation judges are Opus by choice. Don't propose cheaper judges.
