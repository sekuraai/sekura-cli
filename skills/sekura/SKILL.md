---
name: sekura
description: Use when the user wants a GitHub repository scanned for vulnerabilities, wants to read scan findings or a report, or wants to put a repository on a recurring Sekura scan. Covers the sekura MCP tools and the rule that every scan and plan is quoted first and started only after the user agrees.
argument-hint: "[help | repos | scan <owner/repo> | scans | scan-status <scan> | findings <scan> | report <scan> | cancel <scan|owner/repo> | always <owner/repo> | schedule <owner/repo> | plans | billing]"
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
  anything the account still needs on sekura.ai, and the repositories Sekura can
  scan, then end with "Type `/sekura help` for commands."
- `repos`: `listRepositories`.
- `scan <owner/repo>`: `quoteScan` for that repository, then the two-step rule below.
- `scans`: `listScans`.
- `scan-status <scan>`: `getScan`. `findings <scan>`: `getScanFindings`.
- `report <scan>`: `getReportLink`.
- `cancel <scan>`: `previewCancelScan` with that scan id. `cancel <owner/repo>`:
  `previewCancelPlan` with that repository. An argument with a `/` in it is a
  repository; anything else is a scan id. Then the two-step rule below.
- `always <owner/repo>`: `quoteAlways` for that repository, then the two-step rule.
  It needs a schedule; if the user gave none, ask when it should run (daily,
  weekly on a weekday, or monthly on the Nth weekday, at what time, in which time
  zone) before quoting. The plan (`tier`) is `always` unless the user asks for
  `plus` or `pro`.
- `schedule <owner/repo>`: `updateSchedule` for that repository with the schedule
  the user gives; ask for one if they gave none.
- `plans`: `getPlans`. `billing`: `getBilling`.
- anything else: treat the whole text as an ordinary request about Sekura.

The help text:

```
Sekura: AI red team scans for your GitHub repositories

  /sekura                         account and repositories at a glance
  /sekura repos                   repositories Sekura can scan
  /sekura scan <owner/repo>       quote a scan; it starts only after you agree
  /sekura scans                   your scans and their status
  /sekura scan-status <scan>      one scan's progress
  /sekura findings <scan>         a scan's findings, with proof
  /sekura report <scan>           link to the report
  /sekura cancel <scan>           what cancelling a scan means; cancels only after you agree
  /sekura cancel <owner/repo>     the same for a repository's Sekura Always plan
  /sekura always <owner/repo>     quote a recurring Sekura Always plan
  /sekura schedule <owner/repo>   change when a Sekura Always plan runs
  /sekura plans                   repositories on a recurring plan
  /sekura billing                 what is being billed
  /sekura help                    this list

Every scan and plan is quoted first (price and authorization) and started
only after you say yes. Cancelling is shown first too.

Setup, in a terminal:
  npx sekura@latest login         sign in again, or pick another repository
  npx sekura@latest status        what is connected on this machine
  npx sekura@latest billing       your saved cards (--open to change them)

Add repositories: https://sekura.ai/app (the Sekura GitHub App)
Documentation:    https://sekura.ai/connect/
```

## Tools

The server has eighteen tools. Read, change nothing, no confirmation:

- `getAccount`: who is signed in, whether the Terms are accepted and the email verified, where the Sekura GitHub App is installed, and what is billed. Call it first.
- `listRepositories`: the repositories the Sekura GitHub App is installed on.
- `listScans`, `getScan`, `getScanFindings`, `getReportLink`: scans, their status, their findings and the report.
- `getPlans`, `getBilling`: the repositories on a recurring plan, and a billing summary without card numbers.

Quote, then confirm. The quote changes nothing and charges nothing:

- `quoteScan` → `startScan`: a Sekura Once scan of one repository.
- `quoteAlways` → `startAlways`: a recurring Sekura Always plan for one repository.

Preview, then act. The preview cancels nothing:

- `previewCancelScan` → `cancelScan`: stop a scan inside its five-minute window.
- `previewCancelPlan` → `cancelPlan`: end a repository's Sekura Always plan.

One call, charges nothing:

- `updateSchedule`: change when a repository on Sekura Always is scanned.
- `runNow`: bring an Always plan's next scheduled run forward. It is one of the plan's own runs, so there is no quote.

## The two-step rule

A scan or a plan is never started in one call.

1. Call the quote: `quoteScan` with `repository`, or `quoteAlways` with
   `repository`, `schedule` and, if the user chose one, `tier`. It answers with
   prose (what will run, against which repository, the authorization wording,
   the price, and how it can be paid) and a JSON block whose `confirmArguments`
   are the exact arguments of the confirm: for `startScan` the `repository`,
   `disclosureVersion` and `amountCents`; for `startAlways` the same plus
   `schedule` and `tier`.
2. Show the prose to the user as it stands, including the price and the
   authorization wording, and ask whether they agree. Start nothing until they
   have said yes in the conversation.
3. Then call `startScan` or `startAlways` with `confirmArguments` exactly as the
   quote returned them, plus the `payment` for the way the user chose to pay (see
   Paying, below). Never invent a `disclosureVersion` or an `amountCents`, never
   reuse one from an older quote, and never call a confirm before the user has
   said yes. A confirm without the `disclosureVersion` is refused.

If the confirm is refused because the wording or the price changed, the answer
carries a fresh quote: show that one to the user and ask again.

Cancelling is the same: call `previewCancelScan` (with `scanId`) or
`previewCancelPlan` (with `planId` or `repository`), show its answer to the
user, and call `cancelScan` or `cancelPlan` with the same arguments only after
they agree.

`updateSchedule` and `runNow` take one call each and charge nothing; call them
only when the user has asked for that change.

## Paying

The quote's `paymentOptions` are the only ways to pay. Show them to the user as a
numbered list, each by its `label`, in the quote's order, and ask which one they
want together with whether they agree:

- With saved cards: one line per card, masked as the quote gives it (for example
  `Visa •••• •••• •••• 4242`), then `Pay with a Checkout link`, then
  `Change payment method`. Never show more of a card than the quote does.
- With no saved card: only `Pay with a Checkout link`. The first payment is
  always made in the browser, and the card used there is saved for next time.

Then:

- **A saved card**: call the confirm with that option's `payment`, which is
  `{ "savedCard": { "card": "pm_…" } }` with the card the user picked. Only that
  card is charged, in place, with no browser. Relay the answer: what was charged
  to which card ("Charged $199 to Visa ending 4242"), the scan id and the link.
- **Pay with a Checkout link**: call the confirm with no `payment`. It answers 402
  with `checkoutUrl` and `planId`. Run, in the terminal, with a timeout of ten
  minutes:

  ```
  npx sekura@latest pay "<checkoutUrl>" --plan <planId>
  ```

  It opens the link in the user's browser (where they are signed in to Sekura)
  and waits until the payment lands, then prints the scan id and link, or that
  Checkout was closed unpaid. Tell the user the page is open and you are
  waiting, then relay what it printed. If the command cannot run here, give the
  user the link to open, and once they say they have paid, call `getPlans` and
  report the plan and its scan.
- **Change payment method**: starts and charges nothing. Run
  `npx sekura@latest billing --open`, which opens the page where the user adds
  or changes a card and waits for the change. Then call the quote again and show
  its updated list of cards, and ask again.

Nothing is charged without a quote and the user's yes, and only the card the user
picked is charged.

## What to tell the user

- Through this connection a scan is Sekura Once at the quoted price. Do not mention or offer any free scan.
- When `getAccount` says the Terms or the email are not done, or the GitHub App is not installed, give the user the sekura.ai link it names; a scan cannot start before that.
- A scan can take a while. Offer `getScan` to check on it rather than polling in a loop.
- Findings carry proof. When summarising, keep the evidence the finding gives; do not soften a severity.
- Sekura scans only repositories the user has granted through the Sekura GitHub App. To add one: https://sekura.ai/app.

Documentation for every tool and client: https://sekura.ai/connect/
