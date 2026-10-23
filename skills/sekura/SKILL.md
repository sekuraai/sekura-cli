---
name: sekura
description: Use when the user wants a GitHub repository scanned for vulnerabilities, wants to read scan findings or a report, or wants to put a repository on a recurring Sekura scan. Covers the sekura MCP tools and the rule that every scan and plan is quoted first and started only after the user agrees.
argument-hint: "[help | repos | scan <owner/repo> | scans | scan-status <scan> | report <scan> | always <owner/repo>]"
---

# Sekura

Sekura is an AI red team as a service. It scans a GitHub repository the user has
granted it, exploits what it finds to prove each finding, and delivers a report.
The `sekura` MCP server (https://sekura.ai/mcp) exposes it to this tool. Signing in is the
user's GitHub login on sekura.ai: if a tool answers that the user is signed out,
tell them to run `npx sekura@latest login` in a terminal (it signs in once and
gives every tool the key), or to run `/mcp`, choose `sekura`, and approve in the
browser.

## Commands

When the user types `/sekura` followed by arguments (here: `$ARGUMENTS`), read
the first word:

- `help`, `-h`, `--help` or `?`: reply with the help text below exactly as written,
  and call no tool.
- nothing: call `getAccount` and `listRepositories`, summarise who is signed in,
  whether the free first scan is available, and the repositories Sekura can scan,
  then end with "Type `/sekura help` for commands."
- `repos`: `listRepositories`.
- `scan <owner/repo>`: `startScan` for that repository. This answers with a quote;
  the two-step rule below applies.
- `scans`: `listScans`.
- `scan-status <scan>`: `getScan`. `findings <scan>`: `getScanFindings`.
- `report <scan>`: `getReportLink`.
- `always <owner/repo>`: `startAlways`, quoted first like a scan.
- `plans`: `getPlans`. `billing`: `getBilling`.
- anything else: treat the whole text as an ordinary request about Sekura.

The help text:

```
Sekura: AI red team scans for your GitHub repositories

  /sekura                      account, free scan and repositories at a glance
  /sekura repos                repositories Sekura can scan
  /sekura scan <owner/repo>    quote a scan; it starts only after you agree
  /sekura scans                your scans and their status
  /sekura scan-status <scan>   one scan's progress
  /sekura findings <scan>      a scan's findings, with proof
  /sekura report <scan>        link to the report
  /sekura always <owner/repo>  quote a recurring Sekura Always plan
  /sekura plans                repositories on a recurring plan
  /sekura billing              what is being billed
  /sekura help                 this list

Every scan and plan is quoted first (price and authorization) and started
only after you say yes. Your free first scan is started on sekura.ai:
https://sekura.ai/app/start

Setup, in a terminal:
  npx sekura@latest login      sign in again, or pick another repository
  npx sekura@latest status     what is connected on this machine

Add repositories: https://sekura.ai/app (the Sekura GitHub App)
Documentation:    https://sekura.ai/connect/
```

## Tools

Read, free, no confirmation:

- `getAccount`: who is signed in, what is billed, and whether the account's free first scan is still available on sekura.ai.
- `listRepositories`: the repositories the Sekura GitHub App is installed on.
- `listScans`, `getScan`, `getScanFindings`, `getReportLink`: scans, their status, their findings and the report.
- `getPlans`, `getBilling`: the repositories on a recurring plan, and a billing summary without card numbers.

Write, each in two steps:

- `startScan`: a Sekura Once scan of one repository.
- `startAlways`: a recurring Sekura Always plan for one repository.
- `runNow`: bring an Always plan's next scheduled run forward. Charges nothing.
- `cancelScan`, `cancelPlan`: stop a scan, or end a plan.

## The two-step rule

Every write tool answers first with a preview: what will run, against which
repository, under which authorization wording, and the price. Show that text to
the user as it stands, including the price and the authorization sentence.
Start nothing until the user has agreed in the conversation. Then call the same
tool again with the arguments the preview names (`confirmArguments` in the
JSON block). Never invent a confirmation argument, and never pass one before the
user has said yes.

A card is charged only after the user approves the quoted amount. If no card is
on file, the answer carries a Stripe Checkout link: give it to the user and stop;
the scan starts once they have paid on sekura.ai.

## What to tell the user

- The free first scan is taken on sekura.ai, never through this tool: when `getAccount` says it is still available, tell the user they can start it themselves at https://sekura.ai/app/start, and that a scan started here is Sekura Once at the quoted price.
- A scan can take a while. Offer `getScan` to check on it rather than polling in a loop.
- Findings carry proof. When summarising, keep the evidence the finding gives; do not soften a severity.
- Sekura scans only repositories the user has granted through the Sekura GitHub App. To add one: https://sekura.ai/app.

Documentation for every tool and client: https://sekura.ai/connect/
