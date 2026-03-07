# Security Policy

Found a security issue? First of all — thank you. Seriously. Please report it privately so I can fix it before it becomes a problem.

## Reporting

Use [GitHub's private vulnerability reporting](https://github.com/noahsioo/brainbase/security/advisories/new) — this is the fastest way.

If that doesn't work for you, email **security@brainbase.dev** and I'll take it from there.

## What to include

- What you found
- Steps to reproduce
- How serious you think it is
- A suggested fix (if you have one)

Reports without reproduction steps will take longer to process.

## Scope

BrainBase runs 100% locally. The main areas to look at:

- Watcher daemon (HTTP port 7899)
- MCP server (stdio JSON-RPC)
- Knowledge graph access
- Context injection / data leakage

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
