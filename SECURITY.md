# Security

## Reporting a vulnerability

Email **security@sendandretain.com**. Please do not open a public issue for a security
report — an issue is visible to everyone the moment you file it, including
before we can act on it.

Include what you can: what you did, what happened, and what you expected. A
proof of concept helps but is not required to report something.

**We will acknowledge within 3 business days** and tell you whether we can
reproduce it. If we can, we will keep you updated until it is fixed and credit
you in the release notes unless you would rather we did not.

## Scope

This repo publishes the interface to Send & Retain — a spec, a tool
catalogue, a plugin, or a generated client. The product itself runs at
https://sendandretain.com.

In scope here: anything in this repo that would mislead a consumer into an
insecure integration — a wrong signature recipe, an example that skips
verification, a documented endpoint that is not the real one.

Also in scope, and more valuable: anything about the hosted API itself. Report
it to the same address.

## Credentials

API keys are prefixed `aem_` and are secrets. If one is ever
committed anywhere — this repo, your own, a gist, a screenshot — revoke it in
the dashboard rather than deleting the commit. **Deleting a commit does not
un-publish it**; the key must be assumed compromised from the moment it was
pushed.
