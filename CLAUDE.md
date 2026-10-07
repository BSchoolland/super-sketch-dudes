# Super Sketch Dudes

Deploy only from a clean checkout of master. Anything that needs to ship goes onto master first; a build from a branch or an uncommitted tree gets silently dropped by the next deploy.

Only push master. Old branches and backup/* contain personal data (the school and players' real names); .git/hooks/pre-push refuses anything else.
