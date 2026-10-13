# Super Sketch Dudes

Pushing master is deploying: .github/workflows/deploy.yml runs `scripts/deploy.sh` (check, build, ship) on every push. Don't run deploy.sh by hand for the live game; a push that fails the check doesn't ship, and the run's log is on the repo's Actions tab (`gh run watch`).

Only push master. Old branches and backup/* contain personal data (the school and players' real names); .git/hooks/pre-push refuses anything else.

## Settled decisions
- The forge agent runs Opus at medium effort. Ben benched about 10 model/effort combinations on 10/1 and cheaper ones made less fun fighters; fun beats cost. Don't propose a cheaper model or lower effort for the forge.
- The moderation judges are Opus by choice. Don't propose cheaper judges.
