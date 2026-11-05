---
name: Invoice match check
category: Finance
status: published
bots: penny
triggers: invoice, match, reconcile
description: Three-way match of supplier invoice against PO and receiving before anything is approved. Use when asked to "match an invoice" or "reconcile supplier invoices".
---
## Steps

1. Pull the invoice, the purchase order, and the receiving record for the same supplier and period. If any one of the three is missing, stop and say which.
2. Compare line by line: item, quantity, unit price, and total. Prices must match the PO exactly — a supplier's newer price list never overrides a PO.
3. If every line matches, mark the invoice clean and queue it for the owner's approval with the match summary attached.
4. If any line differs, compute the dollar difference, hold the invoice, and file an issue in Knowledge with the invoice number and the amount. Never approve a mismatched invoice, and never pay one — payment is refused by guardrails regardless.
5. Report back in one line: invoice, PO, matched or held, and the difference if held.
