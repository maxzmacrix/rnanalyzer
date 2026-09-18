# Arbeitsregeln für dieses Repository

* `docs/SPEC.md` ist die gültige Spezifikation (Vision, Umfang, Architektur, Datenmodell, Schnittstellen, Build, QS,
  Entscheidungen). Jede Änderung an Funktionsumfang, Architektur, Datenmodell, Schnittstellen, Build oder Nicht-Zielen
  aktualisiert sie **im selben Commit**: Datum in der Kopfzeile, betroffener Abschnitt, bei Richtungsentscheidungen ein
  Eintrag in Abschnitt 11. Neue Module, Plugin-Methoden, Tabs und Workflows müssen dort vorkommen (`npm test` prüft das).
* `README.md` ist die Anleitung (Einrichten, Bauen, Signieren, Veröffentlichen, Formatdetails). Kein Duplikat der Spezifikation.
* Vor jedem Push: `npm test`. Bei Änderungen an Dateien unter `app/` die Cache-Version in `app/sw.js` erhöhen.
* Keine Abhängigkeiten zur Laufzeit, kein Build-Schritt für `app/`. Daten bleiben auf dem Gerät (siehe Leitprinzipien in der Spezifikation).
* Sprache der Dokumentation: Deutsch, mit englischer Kurzfassung am Anfang der Spezifikation.
