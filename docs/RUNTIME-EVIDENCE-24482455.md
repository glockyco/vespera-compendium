# Runtime evidence — build 24482455

Ran at: 2026-07-31T07:11:29.741Z

PASS 38 · FAIL 0 · SKIPPED 0 · UNRESOLVED 0

## Transformation categories

| Category | PASS | FAIL | SKIPPED | UNRESOLVED |
|---|---:|---:|---:|---:|
| abilities.base-table | 1 | 0 | 0 | 0 |
| abilities.tag-overlay | 1 | 0 | 0 | 0 |
| achievements.active-filter | 1 | 0 | 0 | 0 |
| affixes.base-table | 1 | 0 | 0 | 0 |
| enemies.drop-normalization | 1 | 0 | 0 | 0 |
| enemies.runtime-extension | 1 | 0 | 0 | 0 |
| enemies.stat-scaling | 1 | 0 | 0 | 0 |
| formulas.probe | 5 | 0 | 0 | 0 |
| gathering.drop-normalization | 1 | 0 | 0 | 0 |
| gathering.runtime-extension | 1 | 0 | 0 | 0 |
| gems.base-table | 1 | 0 | 0 | 0 |
| gems.description-overlay | 1 | 0 | 0 | 0 |
| items.normalization | 1 | 0 | 0 | 0 |
| items.runtime-overlay | 1 | 0 | 0 | 0 |
| items.stat-scaling | 1 | 0 | 0 | 0 |
| parity.probe | 11 | 0 | 0 | 0 |
| quests.chain-rewrite | 1 | 0 | 0 | 0 |
| quests.reward-rebalance | 1 | 0 | 0 | 0 |
| quests.runtime-overlay | 1 | 0 | 0 | 0 |
| recipes.input-normalization | 1 | 0 | 0 | 0 |
| recipes.runtime-filtering | 1 | 0 | 0 | 0 |
| save.probe | 1 | 0 | 0 | 0 |
| shopListings.base-table | 1 | 0 | 0 | 0 |
| zonesDungeons.base-table | 1 | 0 | 0 | 0 |

## Probe details

| Suite | Category | Probe | Status | Detail |
|---|---|---|---|---|
| parity | parity.probe | items | PASS | items: alias=I live=949 static=949 |
| parity | parity.probe | enemies | PASS | enemies: alias=t live=137 static=137 |
| parity | parity.probe | recipes | PASS | recipes: alias=R live=585 static=585 |
| parity | parity.probe | gatheringNodes | PASS | gatheringNodes: alias=G live=61 static=61 |
| parity | parity.probe | quests | PASS | quests: alias=Q live=161 static=161 |
| parity | parity.probe | abilities | PASS | abilities: alias=U live=108 static=108 |
| parity | parity.probe | affixes | PASS | affixes: alias=d live=70 static=70 |
| parity | parity.probe | gems | PASS | gems: alias=O live=28 static=28 |
| parity | parity.probe | shopListings | PASS | shopListings: alias=T live=28 static=28 |
| parity | parity.probe | zonesDungeons | PASS | zonesDungeons: alias=$ live=32 static=32 |
| parity | parity.probe | achievements | PASS | achievements: alias=a live=100 static=100 |
| records | items.runtime-overlay | items | PASS | items: 10 deterministic samples matched |
| records | items.normalization | items | PASS | items: 10 deterministic samples matched |
| records | items.stat-scaling | items | PASS | items: 10 deterministic samples matched |
| records | enemies.runtime-extension | enemies | PASS | enemies: 10 deterministic samples matched |
| records | enemies.stat-scaling | enemies | PASS | enemies: 10 deterministic samples matched |
| records | enemies.drop-normalization | enemies | PASS | enemies: 10 deterministic samples matched |
| records | recipes.runtime-filtering | recipes | PASS | recipes: 10 deterministic samples matched |
| records | recipes.input-normalization | recipes | PASS | recipes: 10 deterministic samples matched |
| records | gathering.runtime-extension | gatheringNodes | PASS | gatheringNodes: 9 deterministic samples matched |
| records | gathering.drop-normalization | gatheringNodes | PASS | gatheringNodes: 9 deterministic samples matched |
| records | quests.runtime-overlay | quests | PASS | quests: 10 deterministic samples matched |
| records | quests.chain-rewrite | quests | PASS | quests: 10 deterministic samples matched |
| records | quests.reward-rebalance | quests | PASS | quests: 10 deterministic samples matched |
| records | abilities.base-table | abilities | PASS | abilities: 10 deterministic samples matched |
| records | abilities.tag-overlay | abilities | PASS | abilities: 10 deterministic samples matched |
| records | affixes.base-table | affixes | PASS | affixes: 10 deterministic samples matched |
| records | gems.base-table | gems | PASS | gems: 10 deterministic samples matched |
| records | gems.description-overlay | gems | PASS | gems: 10 deterministic samples matched |
| records | shopListings.base-table | shopListings | PASS | shopListings: 10 deterministic samples matched |
| records | zonesDungeons.base-table | zonesDungeons | PASS | zonesDungeons: 8 deterministic samples matched |
| records | achievements.active-filter | achievements | PASS | achievements: 10 deterministic samples matched |
| formulas | formulas.probe | sellValueRarityMultipliers | PASS | sellValueRarityMultipliers: ratios=[1,1.1,1.22,1.36,1.52,1.7,1.52] |
| formulas | formulas.probe | xpGainMultiplier | PASS | xpGainMultiplier: base XP 100 returned 100 |
| formulas | formulas.probe | mitigationCap | PASS | mitigationCap: low-level=0.9987515605493134 capped-level=0.75; grid={"defenses":[0,100,1000,100000],"levels":[1,50,256,10000],"values":[[0,0,0,0],[0.4444444444444444,0.06896551724137931,0.015151515151515152,0.015151515151515152],[0.8888888888888888,0.425531914893617,0.13333333333333333,0.13333333333333333],[0.9987515605493134,0.986679822397632,0.9389671361502347,0.75]]} |
| formulas | formulas.probe | mitigationLevelClamp | PASS | mitigationLevelClamp: level256=0.13333333333333333 level10000=0.13333333333333333 |
| formulas | formulas.probe | achievementActiveSplit | PASS | achievementActiveSplit: runtime raw=184 static raw=184 |
| save | save.probe | saveEnvelope | PASS | saveEnvelope: store=bz saveEra=vespera-launch-1 keys=i18nextLng, vespera-account-academy-buildings-v1, vespera-language, vespera-window-mode, vespera_music_timeless_willow_intro_played_v1 |

## Save structure

Top-level key names: i18nextLng, vespera-account-academy-buildings-v1, vespera-language, vespera-window-mode, vespera_music_timeless_willow_intro_played_v1
