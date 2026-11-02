/* AI for game accessibility. Talk data.
   One entry per case on the shelf, in talk order. The pages themselves live in index.html.
   WG.items, WG.awards and WG.coverage are written as strict JSON so the text form (../talk-texts-form.html)
   can read them with the same script that reads index.html. */
window.WG = window.WG || {};

WG.site = 'https://nadiadileo.neocities.org';
WG.spineTitle = 'AI FOR GAME ACCESSIBILITY';

/* kind: "title" (the talk's own case), "case" (a topic), "label" (shelf label opening a part divider),
   "end" / "refs" (closing items). Spines are in WG.spines below; shelf positions in app.js (LAYOUT). */
WG.items = [
  { "id": "title", "kind": "title", "num": "00", "title": "AI for game accessibility",
    "blurb": "Auditing prototypes and mapping released games.",
    "pages": [{ "id": "title", "label": "Title screen" }] },

  { "id": "intro", "kind": "case", "num": "01", "title": "What this talk asks",
    "blurb": "The question behind the talk and the route through its two parts.",
    "pages": [{ "id": "p-roadmap", "label": "What this talk asks" }] },

  { "id": "part1", "kind": "label", "num": "", "part": 1, "title": "Auditing games",
    "blurb": "Can a model help check a game against the guidelines?",
    "pages": [{ "id": "p-part1", "label": "Part 1" }] },

  { "id": "awards", "kind": "case", "num": "02", "part": 1, "title": "The 2025 nominees",
    "blurb": "A 121-guideline audit of the five games nominated for Innovation in Accessibility at The Game Awards 2025.",
    "pages": [{ "id": "p-awards-1", "label": "The audit" }, { "id": "p-awards-2", "label": "Game by game" }, { "id": "p-awards-3", "label": "What the five games share" }] },

  { "id": "pointcheck", "kind": "case", "num": "03", "part": 1, "title": "PointCheck",
    "blurb": "A web accessibility tester that checks what is drawn on screen.",
    "pages": [{ "id": "p-pointcheck", "label": "PointCheck" }] },

  { "id": "builds", "kind": "case", "num": "04", "part": 1, "title": "From web pages to playable builds",
    "blurb": "What a game version of that workflow would look at, and what it would hand to a specialist.",
    "pages": [{ "id": "p-builds", "label": "From web pages to playable builds" }] },

  { "id": "model", "kind": "case", "num": "05", "part": 1, "title": "A model for games",
    "blurb": "A grant application, under review, to train small open models that check game builds against the guidelines.",
    "pages": [{ "id": "p-model", "label": "A model for games" }, { "id": "p-model-2", "label": "How the model would be trained" }] },

  { "id": "part2", "kind": "label", "num": "", "part": 2, "title": "Mapping games",
    "blurb": "Can a model map what players and studios already publish?",
    "pages": [{ "id": "p-part2", "label": "Part 2" }] },

  { "id": "attention", "kind": "case", "num": "06", "part": 2, "title": "More material to map",
    "blurb": "Reviews and accessibility awards, 2018–2026.",
    "pages": [{ "id": "p-attention", "label": "More material to map" }] },

  { "id": "cipt", "kind": "case", "num": "07", "part": 2, "title": "What 448 reviews talk about",
    "blurb": "Six themes in Can I Play That? accessibility reviews, 2019–2024.",
    "pages": [{ "id": "p-cipt", "label": "What 448 reviews talk about" }, { "id": "p-cipt-2", "label": "How the themes were found" }] },

  { "id": "checklists", "kind": "case", "num": "08", "part": 2, "title": "From checklists to playability",
    "blurb": "479 reviews mapped onto the Game Accessibility Guidelines by hand.",
    "pages": [{ "id": "p-check-1", "label": "The mapping" }, { "id": "p-check-2", "label": "What the reviews mention" }] },

  { "id": "llm", "kind": "case", "num": "09", "part": 2, "title": "Scaling the mapping",
    "blurb": "A language model for the first pass, people for the rest, and the experiment that should come first.",
    "pages": [{ "id": "p-llm", "label": "Scaling the mapping" }, { "id": "p-llm-2", "label": "Testing the first pass" }] },

  { "id": "record", "kind": "case", "num": "10", "part": 2, "title": "One record for both workflows",
    "blurb": "The fields every observation should carry.",
    "pages": [{ "id": "p-record", "label": "One record for both workflows" }] },

  { "id": "limits", "kind": "case", "num": "11", "part": 2, "title": "Where it can go wrong",
    "blurb": "Failure modes, gaps in the data, and a first precaution for each.",
    "pages": [{ "id": "p-limits", "label": "Where it can go wrong" }] },

  { "id": "claims", "kind": "case", "num": "12", "part": 2, "title": "What a report can claim",
    "blurb": "What the records support, what they do not, and a small workflow to try.",
    "pages": [{ "id": "p-claims", "label": "What a report can claim" }] },

  { "id": "end", "kind": "end", "num": "13", "title": "Thank you",
    "blurb": "Contacts.",
    "pages": [{ "id": "p-end", "label": "Thank you" }] },

  { "id": "refs", "kind": "refs", "num": "14", "title": "References",
    "blurb": "Works cited in this talk.",
    "pages": [{ "id": "p-refs", "label": "References" }] }
];

/* Spines on the shelf: each case borrows its side from a real cover.
   file: the palette-dithered spine; with color: true, "<file>-c.png" holds the original colours, shown on hover. */
WG.spines = {
  intro:      { file: 'spyro.png',                 color: true, game: 'Spyro: Year of the Dragon', platform: 'PlayStation' },
  awards:     { file: 'hollow-knight.png',         color: true, game: 'Hollow Knight', platform: 'Nintendo Switch' },
  pointcheck: { file: 'metroid-samus-returns.png', color: true, game: 'Metroid: Samus Returns', platform: 'Nintendo 3DS' },
  builds:     { file: 'minecraft.png',             color: true, game: 'Minecraft', platform: 'Xbox One' },
  model:      { file: 'celeste.png',               color: true, game: 'Celeste', platform: 'Nintendo Switch' },
  attention:  { file: 'thrillville.png',           color: true, game: 'Thrillville', platform: 'Xbox' },
  cipt:       { file: 'yakuza-0.png',              color: true, game: 'Yakuza 0', platform: 'PlayStation 4' },
  checklists: { file: 'fallout-76.png',            color: true, game: 'Fallout 76', platform: 'Xbox One' },
  llm:        { file: 'sekiro.png',                color: true, game: 'Sekiro: Shadows Die Twice', platform: 'PlayStation 4' },
  record:     { file: 'pokemon-moon.png',          color: true, game: 'Pokémon Moon', platform: 'Nintendo 3DS' },
  limits:     { file: 'life-is-strange.png',       color: true, game: 'Life is Strange: Before the Storm', platform: 'PlayStation 4' },
  claims:     { file: 'undertale.png',             color: true, game: 'Undertale', platform: 'Nintendo Switch' },
  end:        { file: 'animal-crossing.png',       color: true, game: 'Animal Crossing: New Leaf', platform: 'Nintendo 3DS' },
  refs:       { file: 'manual.png' }
};

/* Award nominees, Di Leo (2026a). impl: % of applicable GAG items implemented; doc: % of implemented features
   documented in official materials (Table 1). heat: % implemented by category (rows) and level (columns:
   basic, intermediate, advanced), read from the paper's Figures 1–5; null = no applicable guidelines. */
WG.awards = [
  { "id": "ac", "name": "Assassin’s Creed Shadows", "short": "AC Shadows", "impl": 77.0, "doc": 26.5, "app": 102,
    "heat": [[100, 82, 50], [71, 67, 70], [100, 91, 75], [100, 88, 33], [100, null, null], [50, 86, 0]],
    "note": "Strongest on vision and motor. Cognitive support is the weakest area: the settings menu is labelled “Animus”, and there is no central accessibility menu." },
  { "id": "atom", "name": "Atomfall", "short": "Atomfall", "impl": 83.0, "doc": 31.0, "app": 100,
    "heat": [[100, 86, 100], [100, 80, 50], [80, 100, 40], [100, 88, 50], [100, null, null], [100, 100, 50]],
    "note": "All basic and advanced motor guidelines are met. Instead of one gore toggle, Phobia Safe Modes cover seven specific triggers, from mice to crabs." },
  { "id": "doom", "name": "DOOM: The Dark Ages", "short": "DOOM", "impl": 79.7, "doc": 40.6, "app": 101, "tag": "Award winner",
    "heat": [[100, 82, 33], [100, 90, 40], [100, 100, 40], [100, 75, 0], [100, null, null], [100, 83, 0]],
    "note": "Meets every basic guideline. Removing the double jump and the dash lowered the physical demands of combat for every player. There is little for blind players, and no way to reduce gore." },
  { "id": "fc", "name": "EA Sports FC 26", "short": "FC 26", "impl": 74.5, "doc": 48.6, "app": 108,
    "heat": [[100, 68, 67], [86, 92, 60], [100, 91, 33], [100, 64, 0], [100, 50, 0], [100, 86, 100]],
    "note": "Lowest implementation and highest documentation. The Two Button control scheme, its most accessible option, is switched off in competitive modes." },
  { "id": "som", "name": "South of Midnight", "short": "South of Midnight", "impl": 83.2, "doc": 25.5, "app": 98, "tag": "First in the audit",
    "heat": [[90, 73, 100], [100, 77, 80], [100, 86, 75], [100, 94, 50], [100, null, null], [67, 83, 0]],
    "note": "Highest implementation and lowest documentation. The Guiding Strand traces the path to the next objective, with an audio beacon. Custom key bindings did not survive a restart." }
];
WG.heatRows = ['Motor', 'Cognitive', 'Vision', 'Hearing', 'Speech', 'General'];
WG.heatCols = ['Basic', 'Intermediate', 'Advanced'];

/* Can I Play That? reviews mapped to the GAG, Di Leo & Tarantino (2026), Figures 1 and 2.
   Rows in the paper's order; columns: basic, intermediate, advanced. */
WG.coverage = {
  "rows": ["Cognitive", "General", "Hearing", "Motor", "Speech", "Vision"],
  "mentioned": [[14, 9, 2], [7, 9, 1], [39, 15, 0], [19, 10, 6], [1, 2, 0], [15, 6, 7]],
  "working": [[63, 81, 63], [85, 84, 79], [73, 59, 50], [65, 56, 46], [75, 72, 100], [56, 77, 52]]
};
