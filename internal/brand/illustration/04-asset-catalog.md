# Asset catalog / Katalog aset

Katalog ini adalah daftar deliverable produksi, bukan jumlah export atau crop. Satu baris berarti satu
master aset yang dapat menghasilkan beberapa output responsif. Dependency `MOD-001` atau `MSC-001`
wajib lulus Gate 2 sebelum aset turunannya diproduksi.

## Inventory

| ID | Family | Name | Qty unit | Tier | Priority | Surface | Master ratio | Executor | Dependency | Brief |
|---|---|---|---:|---|---|---|---|---|---|---|
| `MOD-001` | Model | Character model | 1 | Narrative–Mascot | P0 | Production | Sheet | Human-first | References | [Model sheet](02-character-model-sheet.md) |
| `MSC-001` | Model | Mascot model | 1 | Mascot | P0 | Production | Sheet | Human-first | MOD-001 | [Mascot system](03-mascot-system.md) |
| `HRO-001` | Hero | Homepage hero | 1 | Narrative | P0 | Website | 16:9 | Hybrid | MOD-001 | [Hero brief](briefs/00-homepage-hero.md) |
| `LKN-001` | Lakon | Anoman Duta | 1 | Narrative | P0 | Brand/editorial | 4:3 | Hybrid | MOD-001 | [Duta brief](briefs/01-anoman-duta.md) |
| `LKN-002` | Lakon | Anoman Obong | 1 | Narrative | P0 | Brand/editorial | 4:3 | Hybrid | MOD-001 | [Obong brief](briefs/02-anoman-obong.md) |
| `LKN-003` | Lakon | Gunung Dronagiri | 1 | Narrative | P0 | Brand/editorial | 4:3 | Hybrid | MOD-001 | [Dronagiri brief](briefs/03-gunung-dronagiri.md) |
| `LKN-004` | Lakon | Chiranjivi | 1 | Narrative | P0 | Brand/editorial | 4:3 | Hybrid | MOD-001 | [Chiranjivi brief](briefs/04-chiranjivi.md) |
| `SPT-001` | Spot | Context | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `SPT-002` | Spot | Visibility | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `SPT-003` | Spot | Isolation | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `SPT-004` | Spot | Human control | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `SPT-005` | Spot | Parallel work | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `SPT-006` | Spot | Durable knowledge | 1 | Editorial | P1 | Docs/marketing | 1:1 | Hybrid | MOD-001 | [Spot brief](briefs/05-spot-illustrations.md) |
| `PST-001` | Product state | Onboarding | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `PST-002` | Product state | Empty backlog | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `PST-003` | Product state | Session active | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `PST-004` | Product state | Awaiting decision | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `PST-005` | Product state | Success | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `PST-006` | Product state | Recoverable error | 1 | Editorial | P1 | Dashboard | 4:3 | Hybrid | MOD-001 | [Product brief](briefs/06-product-states.md) |
| `MPS-001` | Mascot pose | Neutral | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-002` | Mascot pose | Welcome | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-003` | Mascot pose | Observe | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-004` | Mascot pose | Work | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-005` | Mascot pose | Ask | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-006` | Mascot pose | Warn | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-007` | Mascot pose | Celebrate | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `MPS-008` | Mascot pose | Carry knowledge | 1 | Mascot | P1 | Product/social | 1:1 | Human-first | MSC-001 | [Pose brief](briefs/07-mascot-pose-pack.md) |
| `STK-001` | Sticker | Ready | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-002` | Sticker | Working | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-003` | Sticker | Waiting | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-004` | Sticker | Blocked | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-005` | Sticker | Shipped | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-006` | Sticker | Review | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-007` | Sticker | Thanks | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `STK-008` | Sticker | Docs updated | 1 | Mascot | P2 | Community/chat | 1:1 | Human-first | MSC-001 | [Sticker brief](briefs/08-sticker-pack.md) |
| `SOC-001` | Social | Square | 1 | Editorial | P2 | Social | 1:1 | Hybrid | MOD-001 | [Social brief](briefs/09-social-release-templates.md) |
| `SOC-002` | Social | Portrait | 1 | Editorial | P2 | Social | 4:5 | Hybrid | MOD-001 | [Social brief](briefs/09-social-release-templates.md) |
| `SOC-003` | Social | Landscape | 1 | Editorial | P2 | Social | 16:9 | Hybrid | MOD-001 | [Social brief](briefs/09-social-release-templates.md) |
| `SOC-004` | Social | Story | 1 | Editorial | P2 | Social | 9:16 | Hybrid | MOD-001 | [Social brief](briefs/09-social-release-templates.md) |
| `DGM-001` | Diagram | Technical diagram kit | 1 | Editorial | P2 | Docs/product | Modular | Human-first | MOD-001 | [Kit brief](briefs/10-diagram-and-motif-kit.md) |
| `MTF-001` | Motif | Lakon/Buntut motif kit | 1 | Editorial | P2 | Cross-surface | Tile/strip | Human-first | MOD-001 | [Kit brief](briefs/10-diagram-and-motif-kit.md) |

## Machine-checkable summary

| Family | Quantity |
|---|---:|
| Model | 2 |
| Hero | 1 |
| Lakon | 4 |
| Spot | 6 |
| Product state | 6 |
| Mascot pose | 8 |
| Sticker | 8 |
| Social | 4 |
| Diagram | 1 |
| Motif | 1 |
| **Total** | **41** |

## Phase order

1. Phase A — reference board, `MOD-001`, `MSC-001`.
2. Phase B — `HRO-001`, `LKN-001`–`LKN-004`.
3. Phase C — `SPT-001`–`SPT-006`, `PST-001`–`PST-006`.
4. Phase D — `MPS-001`–`MPS-008`, `STK-001`–`STK-008`.
5. Phase E — `SOC-001`–`SOC-004`, `DGM-001`, `MTF-001`.

Gate berikutnya hanya dibuka setelah dependency dan manifest fase sebelumnya diterima. Priority
menentukan urutan manfaat produk; phase order menentukan urutan konsistensi produksi.
