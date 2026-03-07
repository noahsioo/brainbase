# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in BrainBase, please report it responsibly.

**Do not open a public GitHub issue.**

Instead, email: **security@brainbase.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if you have one)

## Response time

You'll receive an acknowledgment within 48 hours. A fix or mitigation will be prioritized based on severity.

## Scope

BrainBase runs 100% locally. The main security concerns are:
- Data leakage through context injection
- Unauthorized access to the local knowledge graph
- Vulnerabilities in the watcher daemon (HTTP port 7899)
- MCP server security

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
