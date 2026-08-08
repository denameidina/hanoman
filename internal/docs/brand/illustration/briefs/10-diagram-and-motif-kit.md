# Technical diagram and motif kit

## Asset ID
`DGM-001` technical diagram kit · `MTF-001` lakon/Buntut motif kit.

## Objective
Provide literal accessible system primitives and culturally grounded decorative connectors without confusing the two roles.

## Product truth
Diagrams must explain actual actors, artifacts, isolation, states, and flows even when the viewer has no wayang knowledge; motifs never create product semantics alone.

## Character tier
Editorial cameo only. Most primitives are non-character symbols; `MOD-001` governs any Anoman appearance.

## Locked anchors
Character cameos retain `MOD-001`; Buntut uses one directional line, and the four lakon motifs keep their approved meaning and joins.

## Composition
`DGM-001` uses a grid, clear boundaries, external text labels, arrow direction, and shape-plus-label states.
`MTF-001` uses modular strips/tiles with approved single joins and ample quiet field.

| ID | Included primitives | Behavior |
|---|---|---|
| `DGM-001` | human, agent, docs, backlog, session, terminal, branch, worktree, arrows, state, boundary | Literal at 16/24/32 px; readable monochrome; labels remain real text |
| `MTF-001` | Buntut connector; Duta ring/path; Obong ember/check; Dronagiri strata; Chiranjivi continuity/ground | Join end-to-end without false loops; one-color and semantic-role variants |

## Layer map
`grid / boundary / actors / artifacts / states / connectors / motif / labels-guide`; deliver each primitive as a named component and expanded SVG.

## Responsive outputs
Diagram icons at 16/24/32/48 px; example flows in 16:9 and 4:3; motif tile, strip, corner, divider,
and one-color versions. Arrows and state differences survive grayscale and zoom.

## Alt-text intent
Diagrams receive a textual equivalent describing nodes, boundaries, direction, and state. Decorative motifs use empty alt.

## Human handoff
Human-first vector construction. Validate technical meaning with product owner and cultural joins with reviewer; do not use generative output as final geometry.

## Do
Pair status with label/shape, distinguish branch from worktree, and keep motif decoration subordinate to information.

## Don't
Don't require wayang knowledge, use motifs as unlabeled status icons, make Buntut direction ambiguous, or mix diagram and decorative semantics.

## Acceptance
Gate 0 verifies every primitive against product docs; Gates 1–2 review motif/profile; Gate 3 tests sample
flows; Gate 4 passes monochrome, 16 px, grayscale, text-equivalent, and join tests; Gate 5 packages editable components, examples, rights, and two manifests.
