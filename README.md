# Emma 的英语老师 (web)

A private English teacher for one Grade 7 student, as an iPad Home Screen web app. It follows her textbook: a short
daily lesson (warm-up review, later a story, a few words to write, a wrap-up), a paper dictation helper for school,
and the offline dictionary for lookups. AI calls go to Alibaba Cloud Bailian (Qwen).

- `index.html` + `js/`: the app (plain ES modules, no build step, no external CDN). Module contracts: `js/CONTRACTS.md`.
- `css/`: one stylesheet per screen; shared tokens are inline in `index.html`.
- `sw.js`: offline shell cache; bump `VERSION` here and in `js/config.js` on every release.
- `check/`: device check page.
- `curriculum/`: public curriculum data only (the national curriculum word lists, prerequisite table, misconception
  tags, the bilingual line bank). No textbook text, photos or textbook word lists.
- `data/`: offline base dictionary trimmed from [ECDICT](https://github.com/skywind3000/ECDICT) (MIT, see `data/ECDICT-LICENSE.txt`).
- The API key is entered on the device and never stored in this repo. All learning data lives only on the iPad.
- Built on Wei's dictionary web app; FSRS formulas ported from [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) (MIT).
