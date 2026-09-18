# Working rules for this repository

* **Project language is English**: documentation, code comments, commit messages, pull request titles and bodies.
  The app's user-facing texts are localised (DE/EN dictionaries in `app/js/i18n.js`).
* `docs/SPEC.md` is the authoritative specification (vision, scope, architecture, data model, interfaces, build, QA,
  decisions). Every change to scope, architecture, data model, interfaces, build or non-goals updates it **in the same
  commit**: date in the header, the affected section, and for directional decisions an entry in section 11. New modules,
  plugin methods, tabs and workflows must appear there (`npm test` checks this).
* `README.md` is the how-to (setup, build, signing, publishing, format details). It does not duplicate the specification.
* Before every push: `npm test`. When files under `app/` change, bump the cache version in `app/sw.js`.
* No runtime dependencies, no build step for `app/`. Data stays on the device (see the guiding principles in the
  specification).
