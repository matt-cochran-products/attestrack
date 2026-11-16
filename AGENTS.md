<junior>
Use the installed Junior skill for delegation, CPM planning, FMECA risk, crossmatrix traceability and investigations; run `junior routes "<request>"` when unsure which command fits. Review receipts and independent checks before accepting work.

ADR compliance checkpoints (ADR 0018). Run the check, and if it reports findings, stop and show them to the human; never record a decision yourself:
- Design: before accepting a design, plan or brief, `junior adr check --stage design --input <file>`.
- Ticket proposal: before filing a ticket, `junior adr check --stage ticket --draft <file>`.
- Ticket pickup: before starting work on a ticket, `junior adr check --stage ticket --ticket <id>`.
- Implementation: before opening a pull request, `junior adr check --stage implementation`.
The human resolves a finding with `junior adr decide` (override with a reason, amend the ADR, or revise the work). If the repository has no ADRs, offer `junior adr init` and ask before running it.
</junior>
