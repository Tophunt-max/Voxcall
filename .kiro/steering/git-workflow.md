# Git Workflow (Repo-specific)

## Push directly to `main`

For **this repository**, push all commits **directly to the `main` branch**.
Do NOT create feature branches. Do NOT open pull requests.

- Use `github_push_to_remote` with `remote_branch_name: "main"`.
- Commit locally on `main`, then push.
- Never leave uncommitted work behind.

## Rationale

The repo owner reviews commits directly on `main` and does not want the
overhead of PRs for iterative UI/backend changes.

## Exceptions

Ignore this rule ONLY if the user explicitly says something like:
"open a PR", "use a feature branch", or "don't push to main".
