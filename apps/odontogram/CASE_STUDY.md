# Odontogram — Case Study

> Answers (`A:`) are written by Daniel. `> Note (Claude):` blocks flag things the
> code shows that an answer may have missed.

## The project

**Q: What is the odontogram and why did you build it (real dental use case / who's it for)?**
A:

## Domain model

**Q: How is the dental domain modeled (teeth numbering, tooth zones, treatment types, tooth-treatment status)? What was tricky to get right?**
A:

## The interactive chart

**Q: How is the tooth chart rendered and made interactive (SVG? per-zone hit areas? how a click maps to a tooth zone)?**
A:

**Q: How do treatments get visualized on a tooth (colors/states per zone)?**
A:

## Data access

**Q: There's both an in-memory service and an API service (`odontogram-memory.ts` vs `odontogram-api.ts`) behind a shared interface, tested with `*.shared-spec.ts`. Why build both, and how do you switch?**
A:

**Q: Does the deployed app talk to a real backend (`BACK_API_*` env) or run fully in-memory as a demo? Why?**
A:

## CRUD feature

**Q: The full CRUD feature — how is edit state managed and persisted, and what was the hardest part of the UX?**
A:
