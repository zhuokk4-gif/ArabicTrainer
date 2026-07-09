import React, { useState, useEffect, useRef, useMemo } from "react";

// ============================================================
//  Arabisch-Schrift-Trainer
//  - Naskh-Schrift (Amiri), nah am Mushaf-Schriftbild
//  - Positionsformen per Zero-Width-Joiner erzwungen
//  - Kein Countdown: Timer laeuft versteckt ab Start, Ende per "Fertig"
//
//  Zwei Modul-TYPEN, die sich die gesamte Infrastruktur teilen
//  (Timer, Statistik, Ergebnis, TTS):
//    A) Auswahl-Module  -> Multiple Choice   (Buchstaben, Harakat)
//    B) Lese-Module     -> Karteikarte: zeigen -> aufloesen -> selbst bewerten
//                          (Woerter, Verse, ganze Suren)
// ============================================================

const ZWJ = "\u200D";

// Harakat (Kurzvokale) als kombinierende Zeichen
const FATHA = "\u064E"; // a
const KASRA = "\u0650"; // i
const DAMMA = "\u064F"; // u

// ============================================================
//  Echte Rezitations-Audios (everyayah.com, verifizierte Ordnernamen)
//  Dateimuster: /data/{Ordner}/{Sure 3-stellig}{Ayah 3-stellig}.mp3
//  z.B. Sure 67 Ayah 1 -> 067001.mp3. Kein API-Key noetig.
//  Das ist echte Qari-Rezitation, keine synthetische Stimme — die
//  bestmoegliche Audioqualitaet fuer die Vers-Pakete.
// ============================================================
const RECITERS = [
  { id: "alafasy", label: "Mishary Al-Afasy", folder: "Alafasy_128kbps", note: "Klar, populär, guter Standard" },
  { id: "husary", label: "Mahmoud Al-Husary", folder: "Husary_128kbps", note: "Sehr deutliche Aussprache, oft für Lernende empfohlen" },
  { id: "abdulbasit", label: "Abdul Basit (Murattal)", folder: "Abdul_Basit_Murattal_192kbps", note: "Ruhiges Tempo" },
  { id: "sudais", label: "Abdurrahman As-Sudais", folder: "Abdurrahmaan_As-Sudais_192kbps", note: "Imam der Haram-Moschee Mekka" },
  { id: "muaiqly", label: "Maher Al Muaiqly", folder: "MaherAlMuaiqly128kbps", note: "Imam der Haram-Moschee Mekka" },
];

function pad3(n) {
  return String(n).padStart(3, "0");
}
// Westliche Ziffern -> arabisch-indische Ziffern (٠١٢٣٤٥٦٧٨٩), wie im Mushaf.
function toArabicIndic(n) {
  return String(n).replace(/\d/g, (d) => "٠١٢٣٤٥٦٧٨٩"[+d]);
}
function ayahAudioUrl(folder, surah, ayah) {
  return `https://everyayah.com/data/${folder}/${pad3(surah)}${pad3(ayah)}.mp3`;
}
// Versieht ein Array von Vers-Objekten mit surah/ayah-Nummern, damit
// daraus automatisch die Audio-URL gebaut werden kann.
function tagAyat(items, surah, startAyah) {
  return items.map((it, i) => ({ ...it, surah, ayah: startAyah + i }));
}

// ---- TTS-Stimmenauswahl: Heuristik fuer "beste verfuegbare" Systemstimme ----
const VOICE_MALE_HINTS = /maged|male|tarik|hamza|mann|rasheed|ahmad|omar|yousef|hamed|khalid/i;
const VOICE_QUALITY_HINTS = /enhanced|premium|neural|natural|plus|wavenet/i;

function voiceScore(v) {
  let s = 0;
  if (VOICE_QUALITY_HINTS.test(v.name)) s += 5;
  if (VOICE_MALE_HINTS.test(v.name)) s += 2;
  return s;
}
function voiceBadges(v) {
  const b = [];
  if (VOICE_QUALITY_HINTS.test(v.name)) b.push("bessere Qualität");
  if (VOICE_MALE_HINTS.test(v.name)) b.push("männlich (vermutet)");
  return b;
}

// ============================================================
//  Statische Audiodateien (lokal, liegen in <projekt>/public/audio/…)
//  Vite serviert alles aus public/ direkt unter "/". Datei
//  public/audio/harakat/ba_fatha.mp3  ->  URL  /audio/harakat/ba_fatha.mp3
//
//  Reihenfolge der Wiedergabe im ganzen Trainer:
//    1) statische Datei (falls vorhanden)   -> beste Qualität
//    2) Browser-TTS                          -> nur Fallback
//
//  Die beiden Schalter erst auf true stellen, wenn die Dateien wirklich
//  erzeugt und abgelegt sind (siehe scripts/generate-audio.mjs). Solange
//  false laeuft direkt TTS. Auch bei true bleibt TTS der Fallback, falls
//  eine einzelne Datei nicht laedt (onerror).
// ============================================================
const AUDIO_BASE = "/audio";
const HARAKAT_AUDIO_ENABLED = false;
const WORD_AUDIO_ENABLED = false;

// Dateinamen-tauglicher ASCII-Slug aus einer Transliteration.
// Muss identisch zur slugify-Funktion im Generier-Skript sein, sonst
// passen die Dateinamen nicht zusammen.
function slugify(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Diakritika weg: ā->a, ḥ->h, ṣ->s …
    .replace(/[ʿʾ'’`]/g, "")         // Hamza-/Ain-Zeichen weg
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function harakatAudioSrc(letterKey, harakaId) {
  return `${AUDIO_BASE}/harakat/${letterKey}_${harakaId}.mp3`;
}
function wordAudioSrc(item) {
  if (item.audio) return item.audio; // explizit gesetzter Pfad hat Vorrang
  return `${AUDIO_BASE}/words/${slugify(item.tr)}.mp3`;
}

// Grunddaten: 28 Buchstaben + Lam-Alif. connectsAfter=false -> nur isoliert/final.
const RAW = [
  ["alif", "ا", false, "Alif", "langes a / Träger"],
  ["ba", "ب", true, "Bāʾ", "b"],
  ["ta", "ت", true, "Tāʾ", "t"],
  ["tha", "ث", true, "Thāʾ", "th (engl. think)"],
  ["jim", "ج", true, "Ǧīm", "dsch"],
  ["hah", "ح", true, "Ḥāʾ", "h (kehlig, hart)"],
  ["kha", "خ", true, "Ḫāʾ", "ch (wie Bach)"],
  ["dal", "د", false, "Dāl", "d"],
  ["dhal", "ذ", false, "Ḏāl", "th (engl. this)"],
  ["ra", "ر", false, "Rāʾ", "r (gerollt)"],
  ["zay", "ز", false, "Zāy", "z (stimmhaft)"],
  ["sin", "س", true, "Sīn", "s (scharf)"],
  ["shin", "ش", true, "Šīn", "sch"],
  ["sad", "ص", true, "Ṣād", "s (emphatisch)"],
  ["dad", "ض", true, "Ḍād", "d (emphatisch)"],
  ["tah", "ط", true, "Ṭāʾ", "t (emphatisch)"],
  ["zah", "ظ", true, "Ẓāʾ", "z/dh (emphatisch)"],
  ["ain", "ع", true, "ʿAin", "ʿ (Kehllaut)"],
  ["ghain", "غ", true, "Ġain", "gh (Reibe-r)"],
  ["fa", "ف", true, "Fāʾ", "f"],
  ["qaf", "ق", true, "Qāf", "q (tiefes k)"],
  ["kaf", "ك", true, "Kāf", "k"],
  ["lam", "ل", true, "Lām", "l"],
  ["mim", "م", true, "Mīm", "m"],
  ["nun", "ن", true, "Nūn", "n"],
  ["ha", "ه", true, "Hāʾ", "h (weich)"],
  ["waw", "و", false, "Wāw", "w / langes u"],
  ["ya", "ي", true, "Yāʾ", "j / langes i"],
  ["lamalif", "لا", false, "Lām-Alif", "lā"],
];

function buildForms(base, connectsAfter) {
  if (connectsAfter) {
    return {
      isolated: base,
      initial: base + ZWJ,
      medial: ZWJ + base + ZWJ,
      final: ZWJ + base,
    };
  }
  return { isolated: base, final: ZWJ + base };
}

const LETTERS = RAW.map(([key, base, ca, name, sound]) => ({
  key,
  base,
  name,
  sound,
  connectsAfter: ca,
  forms: buildForms(base, ca),
}));

const POS_LABEL = {
  isolated: "isoliert",
  initial: "am Anfang",
  medial: "in der Mitte",
  final: "am Ende",
};

const ALL_POS = ["isolated", "initial", "medial", "final"];

// Schnelle Nachschlagetabelle: Buchstaben-Key -> Buchstabenobjekt (aus LETTERS).
const LETTER_BY_KEY = Object.fromEntries(LETTERS.map((l) => [l.key, l]));

// ---- Daten fuer das Modul "Aehnliche Buchstaben" ----
// Jede Gruppe buendelt Buchstaben, die dasselbe Grundgeruest (Rasm) teilen
// und sich nur durch die Punkte (Iʿǧam) unterscheiden — also genau die
// Buchstaben, die man beim Lesen leicht verwechselt.
//
// Optionales Feld `positions`: schraenkt die Gruppe auf bestimmte
// Positionsformen ein. Fehlt es, gelten ALLE Positionen, die der jeweilige
// Buchstabe ueberhaupt besitzt (nicht-verbindende Buchstaben haben z.B. nur
// isoliert/final). Der Fragen-Generator schneidet die erlaubten Positionen
// mit den tatsaechlich vorhandenen Formen des Zielbuchstabens.
//
// Arabisch geprueft: gleiches Geruest, Unterschied nur ueber Punkte.
const SIMILAR_GROUPS = [
  // Verbundene "Zahnbuchstaben": am Anfang/in der Mitte haben alle fuenf das
  // identische Zahn-Geruest und unterscheiden sich nur durch die Punkte.
  // Isoliert/final laufen sie auseinander (Nūn tiefe Wanne, Yāʾ mit Schwanz)
  // -> darum bewusst auf initial/medial beschraenkt.
  { id: "zahn", label: "Zahnbuchstaben (verbunden)", letters: ["ba", "ta", "tha", "nun", "ya"], positions: ["initial", "medial"] },
  // ب ت ث in allen Positionen: gleiche flache Wanne, nur Punkte anders.
  { id: "batatha", label: "Bāʾ · Tāʾ · Thāʾ", letters: ["ba", "ta", "tha"] },
  { id: "jimhakha", label: "Ǧīm · Ḥāʾ · Ḫāʾ", letters: ["jim", "hah", "kha"] },
  { id: "daldhal", label: "Dāl · Ḏāl", letters: ["dal", "dhal"] },
  { id: "razay", label: "Rāʾ · Zāy", letters: ["ra", "zay"] },
  { id: "sinshin", label: "Sīn · Šīn", letters: ["sin", "shin"] },
  { id: "saddad", label: "Ṣād · Ḍād", letters: ["sad", "dad"] },
  { id: "tahzah", label: "Ṭāʾ · Ẓāʾ", letters: ["tah", "zah"] },
  { id: "ainghain", label: "ʿAin · Ġain", letters: ["ain", "ghain"] },
  { id: "faqaf", label: "Fāʾ · Qāf", letters: ["fa", "qaf"] },
];

// ---- Daten fuer das Harakat-Modul ----
// Saubere Kurz-Transliteration je Konsonant (fuer die Lese-Optionen).
// Alif/Lam-Alif ausgelassen, da sie ohne Hamza kaum eine reine Haraka tragen.
// key = ASCII-Kennung fuer Dateinamen (z.B. ba_fatha.mp3), passend zu RAW.
const HARAKAT_LETTERS = [
  { key: "ba", base: "ب", tr: "b" }, { key: "ta", base: "ت", tr: "t" }, { key: "tha", base: "ث", tr: "th" },
  { key: "jim", base: "ج", tr: "j" }, { key: "hah", base: "ح", tr: "ḥ" }, { key: "kha", base: "خ", tr: "kh" },
  { key: "dal", base: "د", tr: "d" }, { key: "ra", base: "ر", tr: "r" }, { key: "sin", base: "س", tr: "s" },
  { key: "shin", base: "ش", tr: "sh" }, { key: "sad", base: "ص", tr: "ṣ" }, { key: "tah", base: "ط", tr: "ṭ" },
  { key: "ain", base: "ع", tr: "ʿ" }, { key: "fa", base: "ف", tr: "f" }, { key: "qaf", base: "ق", tr: "q" },
  { key: "kaf", base: "ك", tr: "k" }, { key: "lam", base: "ل", tr: "l" }, { key: "mim", base: "م", tr: "m" },
  { key: "nun", base: "ن", tr: "n" }, { key: "ha", base: "ه", tr: "h" }, { key: "waw", base: "و", tr: "w" },
  { key: "ya", base: "ي", tr: "y" },
];

const HARAKAT = [
  { id: "fatha", mark: FATHA, v: "a", name: "Fatha" },
  { id: "kasra", mark: KASRA, v: "i", name: "Kasra" },
  { id: "damma", mark: DAMMA, v: "u", name: "Damma" },
];

// ============================================================
//  QURAN-INHALTE — VOR NUTZUNG PRUEFEN
//  ----------------------------------------------------------
//  Die folgenden Wort- und Verstexte sind aus dem Gedaechtnis
//  eingetragen. Vollvokalisierter Quran-Text enthaelt so fast
//  sicher Fehler in einzelnen Zeichen (Tashkil/Rasm).
//  -> Vor dem Lernen gegen eine zuverlaessige Quelle abgleichen
//     oder von dort ersetzen:
//       - https://tanzil.net  (Uthmani-Text als Download)
//       - https://api.quran.com  (verse_key -> text_uthmani)
//  Jeder Vers = { ar, tr, de }. Nur diese Arrays anfassen.
// ============================================================

// --- Woerter mit Sukun (vokalloser Konsonant, Zeichen: \u0652) ---
const WORDS_SUKUN = [
  { ar: "قُلْ", tr: "qul", de: "Sag!" },
  { ar: "لَمْ", tr: "lam", de: "nicht (Vergangenheit)" },
  { ar: "مِنْ", tr: "min", de: "von, aus" },
  { ar: "عَنْ", tr: "ʿan", de: "über, von" },
  { ar: "هَلْ", tr: "hal", de: "(Fragewort)" },
  { ar: "كَمْ", tr: "kam", de: "wie viel" },
  { ar: "قُمْ", tr: "qum", de: "Steh auf!" },
  { ar: "يَوْم", tr: "yawm", de: "Tag" },
  { ar: "نَحْنُ", tr: "naḥnu", de: "wir" },
];

// --- Woerter mit Shadda (verdoppelter Konsonant, Zeichen: \u0651) ---
const WORDS_SHADDA = [
  { ar: "رَبّ", tr: "rabb", de: "Herr" },
  { ar: "إِنَّ", tr: "inna", de: "wahrlich / dass" },
  { ar: "حَقّ", tr: "ḥaqq", de: "Wahrheit, Recht" },
  { ar: "كُلّ", tr: "kull", de: "jedes, alle" },
  { ar: "أُمّ", tr: "umm", de: "Mutter" },
  { ar: "جَنَّة", tr: "janna", de: "Garten, Paradies" },
  { ar: "عَدُوّ", tr: "ʿaduww", de: "Feind" },
  { ar: "رَبَّنَا", tr: "rabbanā", de: "unser Herr" },
];

// --- 5 Woerter aus Surat al-Mulk (67) ---
const WORDS_MULK = [
  { ar: "تَبَارَكَ", tr: "tabāraka", de: "gesegnet/erhaben ist" },
  { ar: "الْمُلْك", tr: "al-mulk", de: "die Herrschaft" },
  { ar: "الْمَوْت", tr: "al-mawt", de: "der Tod" },
  { ar: "الْحَيَاة", tr: "al-ḥayāt", de: "das Leben" },
  { ar: "قَدِير", tr: "qadīr", de: "allmächtig" },
];

// --- 10 Woerter aus Surat al-Qalam (68) ---
const WORDS_QALAM = [
  { ar: "الْقَلَم", tr: "al-qalam", de: "der Stift, die Feder" },
  { ar: "يَسْطُرُونَ", tr: "yasṭurūn", de: "sie schreiben nieder" },
  { ar: "نِعْمَة", tr: "niʿma", de: "Gunst, Gnade" },
  { ar: "مَجْنُون", tr: "majnūn", de: "besessen, verrückt" },
  { ar: "أَجْر", tr: "ajr", de: "Lohn" },
  { ar: "خُلُق", tr: "khuluq", de: "Charakter, Wesensart" },
  { ar: "عَظِيم", tr: "ʿaẓīm", de: "gewaltig, großartig" },
  { ar: "أَعْلَمُ", tr: "aʿlamu", de: "weiß am besten" },
  { ar: "سَبِيل", tr: "sabīl", de: "Weg" },
  { ar: "الْمُكَذِّبِينَ", tr: "al-mukadhdhibīn", de: "die Leugner" },
];

// --- Surat al-Mulk (67), Ayat 1-5 ---
const MULK_1_5 = tagAyat([
  { ar: "تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ", tr: "tabāraka lladhī bi-yadihi l-mulku wa-huwa ʿalā kulli shayʾin qadīr"  },
  { ar: "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا ۚ وَهُوَ الْعَزِيزُ الْغَفُورُ", tr: "alladhī khalaqa l-mawta wa-l-ḥayāta li-yabluwakum ayyukum aḥsanu ʿamalā, wa-huwa l-ʿazīzu l-ghafūr"  },
  { ar: "الَّذِي خَلَقَ سَبْعَ سَمَاوَاتٍ طِبَاقًا ۖ مَا تَرَىٰ فِي خَلْقِ الرَّحْمَٰنِ مِن تَفَاوُتٍ ۖ فَارْجِعِ الْبَصَرَ هَلْ تَرَىٰ مِن فُطُورٍ", tr: "alladhī khalaqa sabʿa samāwātin ṭibāqā …"  },
  { ar: "ثُمَّ ارْجِعِ الْبَصَرَ كَرَّتَيْنِ يَنقَلِبْ إِلَيْكَ الْبَصَرُ خَاسِئًا وَهُوَ حَسِيرٌ", tr: "thumma rjiʿi l-baṣara karratayni …"  },
  { ar: "وَلَقَدْ زَيَّنَّا السَّمَاءَ الدُّنْيَا بِمَصَابِيحَ وَجَعَلْنَاهَا رُجُومًا لِّلشَّيَاطِينِ ۖ وَأَعْتَدْنَا لَهُمْ عَذَابَ السَّعِيرِ", tr: "wa-laqad zayyannā s-samāʾa d-dunyā bi-maṣābīḥ …"  },
], 67, 1);

// --- Surat al-Mulk (67), Ayat 6-11 ---
const MULK_6_11 = tagAyat([
  { ar: "وَلِلَّذِينَ كَفَرُوا بِرَبِّهِمْ عَذَابُ جَهَنَّمَ ۖ وَبِئْسَ الْمَصِيرُ", tr: "wa-li-lladhīna kafarū bi-rabbihim ʿadhābu jahannam …"  },
  { ar: "إِذَا أُلْقُوا فِيهَا سَمِعُوا لَهَا شَهِيقًا وَهِيَ تَفُورُ", tr: "idhā ulqū fīhā samiʿū lahā shahīqan wa-hiya tafūr"  },
  { ar: "تَكَادُ تَمَيَّزُ مِنَ الْغَيْظِ ۖ كُلَّمَا أُلْقِيَ فِيهَا فَوْجٌ سَأَلَهُمْ خَزَنَتُهَا أَلَمْ يَأْتِكُمْ نَذِيرٌ", tr: "takādu tamayyazu mina l-ghayẓ …"  },
  { ar: "قَالُوا بَلَىٰ قَدْ جَاءَنَا نَذِيرٌ فَكَذَّبْنَا وَقُلْنَا مَا نَزَّلَ اللَّهُ مِن شَيْءٍ إِنْ أَنتُمْ إِلَّا فِي ضَلَالٍ كَبِيرٍ", tr: "qālū balā qad jāʾanā nadhīr …"  },
  { ar: "وَقَالُوا لَوْ كُنَّا نَسْمَعُ أَوْ نَعْقِلُ مَا كُنَّا فِي أَصْحَابِ السَّعِيرِ", tr: "wa-qālū law kunnā nasmaʿu aw naʿqilu …"  },
  { ar: "فَاعْتَرَفُوا بِذَنبِهِمْ فَسُحْقًا لِّأَصْحَابِ السَّعِيرِ", tr: "fa-ʿtarafū bi-dhanbihim fa-suḥqan li-aṣḥābi s-saʿīr"  },
], 67, 6);

// --- Surat al-Qalam (68), Ayat 1-16 ---
const QALAM_1_16 = tagAyat([
  { ar: "نٓ ۚ وَالْقَلَمِ وَمَا يَسْطُرُونَ", tr: "nūn, wa-l-qalami wa-mā yasṭurūn"  },
  { ar: "مَا أَنتَ بِنِعْمَةِ رَبِّكَ بِمَجْنُونٍ", tr: "mā anta bi-niʿmati rabbika bi-majnūn"  },
  { ar: "وَإِنَّ لَكَ لَأَجْرًا غَيْرَ مَمْنُونٍ", tr: "wa-inna laka la-ajran ghayra mamnūn"  },
  { ar: "وَإِنَّكَ لَعَلَىٰ خُلُقٍ عَظِيمٍ", tr: "wa-innaka la-ʿalā khuluqin ʿaẓīm"  },
  { ar: "فَسَتُبْصِرُ وَيُبْصِرُونَ", tr: "fa-satubṣiru wa-yubṣirūn"  },
  { ar: "بِأَيِّكُمُ الْمَفْتُونُ", tr: "bi-ayyikumu l-maftūn"  },
  { ar: "إِنَّ رَبَّكَ هُوَ أَعْلَمُ بِمَن ضَلَّ عَن سَبِيلِهِ وَهُوَ أَعْلَمُ بِالْمُهْتَدِينَ", tr: "inna rabbaka huwa aʿlamu bi-man ḍalla ʿan sabīlih …"  },
  { ar: "فَلَا تُطِعِ الْمُكَذِّبِينَ", tr: "fa-lā tuṭiʿi l-mukadhdhibīn"  },
  { ar: "وَدُّوا لَوْ تُدْهِنُ فَيُدْهِنُونَ", tr: "waddū law tudhinu fa-yudhinūn"  },
  { ar: "وَلَا تُطِعْ كُلَّ حَلَّافٍ مَّهِينٍ", tr: "wa-lā tuṭiʿ kulla ḥallāfin mahīn"  },
  { ar: "هَمَّازٍ مَّشَّاءٍ بِنَمِيمٍ", tr: "hammāzin mashshāʾin bi-namīm"  },
  { ar: "مَّنَّاعٍ لِّلْخَيْرِ مُعْتَدٍ أَثِيمٍ", tr: "mannāʿin li-l-khayri muʿtadin athīm"  },
  { ar: "عُتُلٍّ بَعْدَ ذَٰلِكَ زَنِيمٍ", tr: "ʿutullin baʿda dhālika zanīm"  },
  { ar: "أَن كَانَ ذَا مَالٍ وَبَنِينَ", tr: "an kāna dhā mālin wa-banīn"  },
  { ar: "إِذَا تُتْلَىٰ عَلَيْهِ آيَاتُنَا قَالَ أَسَاطِيرُ الْأَوَّلِينَ", tr: "idhā tutlā ʿalayhi āyātunā qāla asāṭīru l-awwalīn"  },
  { ar: "سَنَسِمُهُ عَلَى الْخُرْطُومِ", tr: "sanasimuhu ʿalā l-khurṭūm"  },
], 68, 1);

// --- Surat al-Haqqa (69), Ayat 1-10 ---
const HAQQA_1_10 = tagAyat([
  { ar: "الْحَاقَّةُ", tr: "al-ḥāqqa"  },
  { ar: "مَا الْحَاقَّةُ", tr: "mā l-ḥāqqa"  },
  { ar: "وَمَا أَدْرَاكَ مَا الْحَاقَّةُ", tr: "wa-mā adrāka mā l-ḥāqqa"  },
  { ar: "كَذَّبَتْ ثَمُودُ وَعَادٌ بِالْقَارِعَةِ", tr: "kadhdhabat thamūdu wa-ʿādun bi-l-qāriʿa"  },
  { ar: "فَأَمَّا ثَمُودُ فَأُهْلِكُوا بِالطَّاغِيَةِ", tr: "fa-ammā thamūdu fa-uhlikū bi-ṭ-ṭāghiya"  },
  { ar: "وَأَمَّا عَادٌ فَأُهْلِكُوا بِرِيحٍ صَرْصَرٍ عَاتِيَةٍ", tr: "wa-ammā ʿādun fa-uhlikū bi-rīḥin ṣarṣarin ʿātiya"  },
  { ar: "سَخَّرَهَا عَلَيْهِمْ سَبْعَ لَيَالٍ وَثَمَانِيَةَ أَيَّامٍ حُسُومًا فَتَرَى الْقَوْمَ فِيهَا صَرْعَىٰ كَأَنَّهُمْ أَعْجَازُ نَخْلٍ خَاوِيَةٍ", tr: "sakhkharahā ʿalayhim sabʿa layālin wa-thamāniyata ayyāmin ḥusūmā …"  },
  { ar: "فَهَلْ تَرَىٰ لَهُم مِّن بَاقِيَةٍ", tr: "fa-hal tarā lahum min bāqiya"  },
  { ar: "وَجَاءَ فِرْعَوْنُ وَمَن قَبْلَهُ وَالْمُؤْتَفِكَاتُ بِالْخَاطِئَةِ", tr: "wa-jāʾa firʿawnu wa-man qablahu wa-l-muʾtafikātu bi-l-khāṭiʾa"  },
  { ar: "فَعَصَوْا رَسُولَ رَبِّهِمْ فَأَخَذَهُمْ أَخْذَةً رَّابِيَةً", tr: "fa-ʿaṣaw rasūla rabbihim fa-akhadhahum akhdhatan rābiya"  },
], 69, 1);

// --- Surat al-Maʿārij (70): VOLLSTAENDIG (Ayat 1-44) ---
// Ayah 1-10 wie zuvor. Ayah 11-44 ergaenzt und gegen quran.com / alim.org
// (Uthmani-Text) abgeglichen; Rasm auf klare Lernschreibung normalisiert
// (durchgehend punktiertes ي, kein Wasla-Alif ٱ, keine Zier-Recitationszeichen) —
// wie auch bei Ayah 1-10 gehandhabt. Trotzdem: vor dem Lernen mit einem
// Mushaf abgleichen (siehe QURAN_NOTE).
const MAARIJ_1_44 = tagAyat([
  { ar: "سَأَلَ سَائِلٌ بِعَذَابٍ وَاقِعٍ", tr: "saʾala sāʾilun bi-ʿadhābin wāqiʿ"  },
  { ar: "لِّلْكَافِرِينَ لَيْسَ لَهُ دَافِعٌ", tr: "li-l-kāfirīna laysa lahu dāfiʿ"  },
  { ar: "مِّنَ اللَّهِ ذِي الْمَعَارِجِ", tr: "mina llāhi dhī l-maʿārij"  },
  { ar: "تَعْرُجُ الْمَلَائِكَةُ وَالرُّوحُ إِلَيْهِ فِي يَوْمٍ كَانَ مِقْدَارُهُ خَمْسِينَ أَلْفَ سَنَةٍ", tr: "taʿruju l-malāʾikatu wa-r-rūḥu ilayhi …"  },
  { ar: "فَاصْبِرْ صَبْرًا جَمِيلًا", tr: "fa-ṣbir ṣabran jamīlā"  },
  { ar: "إِنَّهُمْ يَرَوْنَهُ بَعِيدًا", tr: "innahum yarawnahu baʿīdā"  },
  { ar: "وَنَرَاهُ قَرِيبًا", tr: "wa-narāhu qarībā"  },
  { ar: "يَوْمَ تَكُونُ السَّمَاءُ كَالْمُهْلِ", tr: "yawma takūnu s-samāʾu ka-l-muhl"  },
  { ar: "وَتَكُونُ الْجِبَالُ كَالْعِهْنِ", tr: "wa-takūnu l-jibālu ka-l-ʿihn"  },
  { ar: "وَلَا يَسْأَلُ حَمِيمٌ حَمِيمًا", tr: "wa-lā yasʾalu ḥamīmun ḥamīmā"  },
  { ar: "يُبَصَّرُونَهُمْ ۚ يَوَدُّ الْمُجْرِمُ لَوْ يَفْتَدِي مِنْ عَذَابِ يَوْمِئِذٍ بِبَنِيهِ", tr: "yubaṣṣarūnahum, yawaddu l-mujrimu law yaftadī min ʿadhābi yawmiʾidhin bi-banīh"  },
  { ar: "وَصَاحِبَتِهِ وَأَخِيهِ", tr: "wa-ṣāḥibatihi wa-akhīh"  },
  { ar: "وَفَصِيلَتِهِ الَّتِي تُؤْوِيهِ", tr: "wa-faṣīlatihi llatī tuʾwīh"  },
  { ar: "وَمَنْ فِي الْأَرْضِ جَمِيعًا ثُمَّ يُنجِيهِ", tr: "wa-man fi l-arḍi jamīʿan thumma yunjīh"  },
  { ar: "كَلَّا ۖ إِنَّهَا لَظَىٰ", tr: "kallā, innahā laẓā"  },
  { ar: "نَزَّاعَةً لِّلشَّوَىٰ", tr: "nazzāʿatan li-sh-shawā"  },
  { ar: "تَدْعُوا مَنْ أَدْبَرَ وَتَوَلَّىٰ", tr: "tadʿū man adbara wa-tawallā"  },
  { ar: "وَجَمَعَ فَأَوْعَىٰ", tr: "wa-jamaʿa fa-awʿā"  },
  { ar: "إِنَّ الْإِنسَانَ خُلِقَ هَلُوعًا", tr: "inna l-insāna khuliqa halūʿā"  },
  { ar: "إِذَا مَسَّهُ الشَّرُّ جَزُوعًا", tr: "idhā massahu sh-sharru jazūʿā"  },
  { ar: "وَإِذَا مَسَّهُ الْخَيْرُ مَنُوعًا", tr: "wa-idhā massahu l-khayru manūʿā"  },
  { ar: "إِلَّا الْمُصَلِّينَ", tr: "illā l-muṣallīn"  },
  { ar: "الَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ دَائِمُونَ", tr: "alladhīna hum ʿalā ṣalātihim dāʾimūn"  },
  { ar: "وَالَّذِينَ فِي أَمْوَالِهِمْ حَقٌّ مَّعْلُومٌ", tr: "wa-lladhīna fī amwālihim ḥaqqun maʿlūm"  },
  { ar: "لِّلسَّائِلِ وَالْمَحْرُومِ", tr: "li-s-sāʾili wa-l-maḥrūm"  },
  { ar: "وَالَّذِينَ يُصَدِّقُونَ بِيَوْمِ الدِّينِ", tr: "wa-lladhīna yuṣaddiqūna bi-yawmi d-dīn"  },
  { ar: "وَالَّذِينَ هُم مِّنْ عَذَابِ رَبِّهِم مُّشْفِقُونَ", tr: "wa-lladhīna hum min ʿadhābi rabbihim mushfiqūn"  },
  { ar: "إِنَّ عَذَابَ رَبِّهِمْ غَيْرُ مَأْمُونٍ", tr: "inna ʿadhāba rabbihim ghayru maʾmūn"  },
  { ar: "وَالَّذِينَ هُمْ لِفُرُوجِهِمْ حَافِظُونَ", tr: "wa-lladhīna hum li-furūjihim ḥāfiẓūn"  },
  { ar: "إِلَّا عَلَىٰ أَزْوَاجِهِمْ أَوْ مَا مَلَكَتْ أَيْمَانُهُمْ فَإِنَّهُمْ غَيْرُ مَلُومِينَ", tr: "illā ʿalā azwājihim aw mā malakat aymānuhum fa-innahum ghayru malūmīn"  },
  { ar: "فَمَنِ ابْتَغَىٰ وَرَاءَ ذَٰلِكَ فَأُولَٰئِكَ هُمُ الْعَادُونَ", tr: "fa-mani btaghā warāʾa dhālika fa-ulāʾika humu l-ʿādūn"  },
  { ar: "وَالَّذِينَ هُمْ لِأَمَانَاتِهِمْ وَعَهْدِهِمْ رَاعُونَ", tr: "wa-lladhīna hum li-amānātihim wa-ʿahdihim rāʿūn"  },
  { ar: "وَالَّذِينَ هُم بِشَهَادَاتِهِمْ قَائِمُونَ", tr: "wa-lladhīna hum bi-shahādātihim qāʾimūn"  },
  { ar: "وَالَّذِينَ هُمْ عَلَىٰ صَلَاتِهِمْ يُحَافِظُونَ", tr: "wa-lladhīna hum ʿalā ṣalātihim yuḥāfiẓūn"  },
  { ar: "أُولَٰئِكَ فِي جَنَّاتٍ مُّكْرَمُونَ", tr: "ulāʾika fī jannātin mukramūn"  },
  { ar: "فَمَالِ الَّذِينَ كَفَرُوا قِبَلَكَ مُهْطِعِينَ", tr: "fa-māli lladhīna kafarū qibalaka muhṭiʿīn"  },
  { ar: "عَنِ الْيَمِينِ وَعَنِ الشِّمَالِ عِزِينَ", tr: "ʿani l-yamīni wa-ʿani sh-shimāli ʿizīn"  },
  { ar: "أَيَطْمَعُ كُلُّ امْرِئٍ مِّنْهُمْ أَن يُدْخَلَ جَنَّةَ نَعِيمٍ", tr: "a-yaṭmaʿu kullu mriʾin minhum an yudkhala jannata naʿīm"  },
  { ar: "كَلَّا ۖ إِنَّا خَلَقْنَاهُم مِّمَّا يَعْلَمُونَ", tr: "kallā, innā khalaqnāhum mimmā yaʿlamūn"  },
  { ar: "فَلَا أُقْسِمُ بِرَبِّ الْمَشَارِقِ وَالْمَغَارِبِ إِنَّا لَقَادِرُونَ", tr: "fa-lā uqsimu bi-rabbi l-mashāriqi wa-l-maghāribi innā la-qādirūn"  },
  { ar: "عَلَىٰ أَن نُّبَدِّلَ خَيْرًا مِّنْهُمْ وَمَا نَحْنُ بِمَسْبُوقِينَ", tr: "ʿalā an nubaddila khayran minhum wa-mā naḥnu bi-masbūqīn"  },
  { ar: "فَذَرْهُمْ يَخُوضُوا وَيَلْعَبُوا حَتَّىٰ يُلَاقُوا يَوْمَهُمُ الَّذِي يُوعَدُونَ", tr: "fa-dharhum yakhūḍū wa-yalʿabū ḥattā yulāqū yawmahumu lladhī yūʿadūn"  },
  { ar: "يَوْمَ يَخْرُجُونَ مِنَ الْأَجْدَاثِ سِرَاعًا كَأَنَّهُمْ إِلَىٰ نُصُبٍ يُوفِضُونَ", tr: "yawma yakhrujūna mina l-ajdāthi sirāʿan ka-annahum ilā nuṣubin yūfiḍūn"  },
  { ar: "خَاشِعَةً أَبْصَارُهُمْ تَرْهَقُهُمْ ذِلَّةٌ ۚ ذَٰلِكَ الْيَوْمُ الَّذِي كَانُوا يُوعَدُونَ", tr: "khāshiʿatan abṣāruhum tarhaquhum dhillah, dhālika l-yawmu lladhī kānū yūʿadūn"  },
], 70, 1);

// --- Restliche Ayat fuer das 3er-Paket (komplette Suren) ---
// Ayah 1-11/1-16/1-10 kommen unveraendert aus den bestehenden Haeppchen
// oben (MULK_1_5, MULK_6_11, QALAM_1_16, HAQQA_1_10) — hier nur der Rest,
// gegen alim.org (Uthmani-Text) abgeglichen und im selben Stil normalisiert.

// --- Surat al-Mulk (67), Ayat 12-30 ---
const MULK_12_30 = tagAyat([
  { ar: "إِنَّ الَّذِينَ يَخْشَوْنَ رَبَّهُم بِالْغَيْبِ لَهُم مَّغْفِرَةٌ وَأَجْرٌ كَبِيرٌ", tr: "inna lladhīna yakhshawna rabbahum bi-l-ghaybi lahum maghfiratun wa-ajrun kabīr" },
  { ar: "وَأَسِرُّوا قَوْلَكُمْ أَوِ اجْهَرُوا بِهِ ۖ إِنَّهُ عَلِيمٌ بِذَاتِ الصُّدُورِ", tr: "wa-asirrū qawlakum awi jharū bihi, innahu ʿalīmun bi-dhāti ṣ-ṣudūr" },
  { ar: "أَلَا يَعْلَمُ مَنْ خَلَقَ وَهُوَ اللَّطِيفُ الْخَبِيرُ", tr: "a-lā yaʿlamu man khalaq, wa-huwa l-laṭīfu l-khabīr" },
  { ar: "هُوَ الَّذِي جَعَلَ لَكُمُ الْأَرْضَ ذَلُولًا فَامْشُوا فِي مَنَاكِبِهَا وَكُلُوا مِن رِّزْقِهِ ۖ وَإِلَيْهِ النُّشُورُ", tr: "huwa lladhī jaʿala lakumu l-arḍa dhalūlan fa-mshū fī manākibihā wa-kulū min rizqih, wa-ilayhi n-nushūr" },
  { ar: "أَأَمِنتُم مَّن فِي السَّمَاءِ أَن يَخْسِفَ بِكُمُ الْأَرْضَ فَإِذَا هِيَ تَمُورُ", tr: "a-amintum man fi s-samāʾi an yakhsifa bikumu l-arḍa fa-idhā hiya tamūr" },
  { ar: "أَمْ أَمِنتُم مَّن فِي السَّمَاءِ أَن يُرْسِلَ عَلَيْكُمْ حَاصِبًا ۖ فَسَتَعْلَمُونَ كَيْفَ نَذِيرِ", tr: "am amintum man fi s-samāʾi an yursila ʿalaykum ḥāṣibā, fa-sa-taʿlamūna kayfa nadhīr" },
  { ar: "وَلَقَدْ كَذَّبَ الَّذِينَ مِن قَبْلِهِمْ فَكَيْفَ كَانَ نَكِيرِ", tr: "wa-laqad kadhdhaba lladhīna min qablihim fa-kayfa kāna nakīr" },
  { ar: "أَوَلَمْ يَرَوْا إِلَى الطَّيْرِ فَوْقَهُمْ صَافَّاتٍ وَيَقْبِضْنَ ۚ مَا يُمْسِكُهُنَّ إِلَّا الرَّحْمَٰنُ ۚ إِنَّهُ بِكُلِّ شَيْءٍ بَصِيرٌ", tr: "a-wa-lam yaraw ila ṭ-ṭayri fawqahum ṣāffātin wa-yaqbiḍn, mā yumsikuhunna illā r-raḥmān, innahu bi-kulli shayʾin baṣīr" },
  { ar: "أَمَّنْ هَٰذَا الَّذِي هُوَ جُندٌ لَّكُمْ يَنصُرُكُم مِّن دُونِ الرَّحْمَٰنِ ۚ إِنِ الْكَافِرُونَ إِلَّا فِي غُرُورٍ", tr: "amman hādhā lladhī huwa jundun lakum yanṣurukum min dūni r-raḥmān, ini l-kāfirūna illā fī ghurūr" },
  { ar: "أَمَّنْ هَٰذَا الَّذِي يَرْزُقُكُمْ إِنْ أَمْسَكَ رِزْقَهُ ۚ بَل لَّجُّوا فِي عُتُوٍّ وَنُفُورٍ", tr: "amman hādhā lladhī yarzuqukum in amsaka rizqah, bal lajjū fī ʿutuwwin wa-nufūr" },
  { ar: "أَفَمَن يَمْشِي مُكِبًّا عَلَىٰ وَجْهِهِ أَهْدَىٰ أَمَّن يَمْشِي سَوِيًّا عَلَىٰ صِرَاطٍ مُّسْتَقِيمٍ", tr: "a-fa-man yamshī mukibban ʿalā wajhihī ahdā amman yamshī sawiyyan ʿalā ṣirāṭin mustaqīm" },
  { ar: "قُلْ هُوَ الَّذِي أَنشَأَكُمْ وَجَعَلَ لَكُمُ السَّمْعَ وَالْأَبْصَارَ وَالْأَفْئِدَةَ ۖ قَلِيلًا مَّا تَشْكُرُونَ", tr: "qul huwa lladhī anshaʾakum wa-jaʿala lakumu s-samʿa wa-l-abṣāra wa-l-afʾidah, qalīlan mā tashkurūn" },
  { ar: "قُلْ هُوَ الَّذِي ذَرَأَكُمْ فِي الْأَرْضِ وَإِلَيْهِ تُحْشَرُونَ", tr: "qul huwa lladhī dharaʾakum fi l-arḍi wa-ilayhi tuḥsharūn" },
  { ar: "وَيَقُولُونَ مَتَىٰ هَٰذَا الْوَعْدُ إِن كُنتُمْ صَادِقِينَ", tr: "wa-yaqūlūna matā hādha l-waʿdu in kuntum ṣādiqīn" },
  { ar: "قُلْ إِنَّمَا الْعِلْمُ عِندَ اللَّهِ وَإِنَّمَا أَنَا نَذِيرٌ مُّبِينٌ", tr: "qul innama l-ʿilmu ʿinda llāh, wa-innamā ana nadhīrun mubīn" },
  { ar: "فَلَمَّا رَأَوْهُ زُلْفَةً سِيئَتْ وُجُوهُ الَّذِينَ كَفَرُوا وَقِيلَ هَٰذَا الَّذِي كُنتُم بِهِ تَدَّعُونَ", tr: "fa-lammā raʾawhu zulfatan sīʾat wujūhu lladhīna kafarū wa-qīla hādha lladhī kuntum bihī taddaʿūn" },
  { ar: "قُلْ أَرَأَيْتُمْ إِنْ أَهْلَكَنِيَ اللَّهُ وَمَن مَّعِيَ أَوْ رَحِمَنَا فَمَن يُجِيرُ الْكَافِرِينَ مِنْ عَذَابٍ أَلِيمٍ", tr: "qul araʾaytum in ahlakaniya llāhu wa-man maʿiya aw raḥimanā fa-man yujīru l-kāfirīna min ʿadhābin alīm" },
  { ar: "قُلْ هُوَ الرَّحْمَٰنُ آمَنَّا بِهِ وَعَلَيْهِ تَوَكَّلْنَا ۖ فَسَتَعْلَمُونَ مَنْ هُوَ فِي ضَلَالٍ مُّبِينٍ", tr: "qul huwa r-raḥmānu āmannā bihi wa-ʿalayhi tawakkalnā, fa-sa-taʿlamūna man huwa fī ḍalālin mubīn" },
  { ar: "قُلْ أَرَأَيْتُمْ إِنْ أَصْبَحَ مَاؤُكُمْ غَوْرًا فَمَن يَأْتِيكُم بِمَاءٍ مَّعِينٍ", tr: "qul araʾaytum in aṣbaḥa māʾukum ghawran fa-man yaʾtīkum bi-māʾin maʿīn" },
], 67, 12);
const MULK_FULL = [...MULK_1_5, ...MULK_6_11, ...MULK_12_30];

// --- Surat al-Qalam (68), Ayat 17-52 ---
const QALAM_17_52 = tagAyat([
  { ar: "إِنَّا بَلَوْنَاهُمْ كَمَا بَلَوْنَا أَصْحَابَ الْجَنَّةِ إِذْ أَقْسَمُوا لَيَصْرِمُنَّهَا مُصْبِحِينَ", tr: "innā balawnāhum kamā balawnā aṣḥāba l-jannati idh aqsamū la-yaṣrimunnahā muṣbiḥīn" },
  { ar: "وَلَا يَسْتَثْنُونَ", tr: "wa-lā yastathnūn" },
  { ar: "فَطَافَ عَلَيْهَا طَائِفٌ مِّن رَّبِّكَ وَهُمْ نَائِمُونَ", tr: "fa-ṭāfa ʿalayhā ṭāʾifun min rabbika wa-hum nāʾimūn" },
  { ar: "فَأَصْبَحَتْ كَالصَّرِيمِ", tr: "fa-aṣbaḥat ka-ṣ-ṣarīm" },
  { ar: "فَتَنَادَوْا مُصْبِحِينَ", tr: "fa-tanādaw muṣbiḥīn" },
  { ar: "أَنِ اغْدُوا عَلَىٰ حَرْثِكُمْ إِن كُنتُمْ صَارِمِينَ", tr: "ani ghdū ʿalā ḥarthikum in kuntum ṣārimīn" },
  { ar: "فَانطَلَقُوا وَهُمْ يَتَخَافَتُونَ", tr: "fa-nṭalaqū wa-hum yatakhāfatūn" },
  { ar: "أَن لَّا يَدْخُلَنَّهَا الْيَوْمَ عَلَيْكُم مِّسْكِينٌ", tr: "an lā yadkhulannahā l-yawma ʿalaykum miskīn" },
  { ar: "وَغَدَوْا عَلَىٰ حَرْدٍ قَادِرِينَ", tr: "wa-ghadaw ʿalā ḥardin qādirīn" },
  { ar: "فَلَمَّا رَأَوْهَا قَالُوا إِنَّا لَضَالُّونَ", tr: "fa-lammā raʾawhā qālū innā la-ḍāllūn" },
  { ar: "بَلْ نَحْنُ مَحْرُومُونَ", tr: "bal naḥnu maḥrūmūn" },
  { ar: "قَالَ أَوْسَطُهُمْ أَلَمْ أَقُل لَّكُمْ لَوْلَا تُسَبِّحُونَ", tr: "qāla awsaṭuhum a-lam aqul lakum law-lā tusabbiḥūn" },
  { ar: "قَالُوا سُبْحَانَ رَبِّنَا إِنَّا كُنَّا ظَالِمِينَ", tr: "qālū subḥāna rabbinā innā kunnā ẓālimīn" },
  { ar: "فَأَقْبَلَ بَعْضُهُمْ عَلَىٰ بَعْضٍ يَتَلَاوَمُونَ", tr: "fa-aqbala baʿḍuhum ʿalā baʿḍin yatalāwamūn" },
  { ar: "قَالُوا يَا وَيْلَنَا إِنَّا كُنَّا طَاغِينَ", tr: "qālū yā waylanā innā kunnā ṭāghīn" },
  { ar: "عَسَىٰ رَبُّنَا أَن يُبْدِلَنَا خَيْرًا مِّنْهَا إِنَّا إِلَىٰ رَبِّنَا رَاغِبُونَ", tr: "ʿasā rabbunā an yubdilanā khayran minhā innā ilā rabbinā rāghibūn" },
  { ar: "كَذَٰلِكَ الْعَذَابُ ۖ وَلَعَذَابُ الْآخِرَةِ أَكْبَرُ ۚ لَوْ كَانُوا يَعْلَمُونَ", tr: "ka-dhālika l-ʿadhāb, wa-la-ʿadhābu l-ākhirati akbar, law kānū yaʿlamūn" },
  { ar: "إِنَّ لِلْمُتَّقِينَ عِندَ رَبِّهِمْ جَنَّاتِ النَّعِيمِ", tr: "inna li-l-muttaqīna ʿinda rabbihim jannāti n-naʿīm" },
  { ar: "أَفَنَجْعَلُ الْمُسْلِمِينَ كَالْمُجْرِمِينَ", tr: "a-fa-najʿalu l-muslimīna ka-l-mujrimīn" },
  { ar: "مَا لَكُمْ كَيْفَ تَحْكُمُونَ", tr: "mā lakum kayfa taḥkumūn" },
  { ar: "أَمْ لَكُمْ كِتَابٌ فِيهِ تَدْرُسُونَ", tr: "am lakum kitābun fīhi tadrusūn" },
  { ar: "إِنَّ لَكُمْ فِيهِ لَمَا تَخَيَّرُونَ", tr: "inna lakum fīhi la-mā takhayyarūn" },
  { ar: "أَمْ لَكُمْ أَيْمَانٌ عَلَيْنَا بَالِغَةٌ إِلَىٰ يَوْمِ الْقِيَامَةِ ۙ إِنَّ لَكُمْ لَمَا تَحْكُمُونَ", tr: "am lakum aymānun ʿalaynā bālighatun ilā yawmi l-qiyāmah, inna lakum la-mā taḥkumūn" },
  { ar: "سَلْهُمْ أَيُّهُم بِذَٰلِكَ زَعِيمٌ", tr: "salhum ayyuhum bi-dhālika zaʿīm" },
  { ar: "أَمْ لَهُمْ شُرَكَاءُ فَلْيَأْتُوا بِشُرَكَائِهِمْ إِن كَانُوا صَادِقِينَ", tr: "am lahum shurakāʾu fa-l-yaʾtū bi-shurakāʾihim in kānū ṣādiqīn" },
  { ar: "يَوْمَ يُكْشَفُ عَن سَاقٍ وَيُدْعَوْنَ إِلَى السُّجُودِ فَلَا يَسْتَطِيعُونَ", tr: "yawma yukshafu ʿan sāqin wa-yudʿawna ila s-sujūdi fa-lā yastaṭīʿūn" },
  { ar: "خَاشِعَةً أَبْصَارُهُمْ تَرْهَقُهُمْ ذِلَّةٌ ۖ وَقَدْ كَانُوا يُدْعَوْنَ إِلَى السُّجُودِ وَهُمْ سَالِمُونَ", tr: "khāshiʿatan abṣāruhum tarhaquhum dhillah, wa-qad kānū yudʿawna ila s-sujūdi wa-hum sālimūn" },
  { ar: "فَذَرْنِي وَمَن يُكَذِّبُ بِهَٰذَا الْحَدِيثِ ۖ سَنَسْتَدْرِجُهُم مِّنْ حَيْثُ لَا يَعْلَمُونَ", tr: "fa-dharnī wa-man yukadhdhibu bi-hādha l-ḥadīth, sa-nastadrijuhum min ḥaythu lā yaʿlamūn" },
  { ar: "وَأُمْلِي لَهُمْ ۚ إِنَّ كَيْدِي مَتِينٌ", tr: "wa-umlī lahum, inna kaydī matīn" },
  { ar: "أَمْ تَسْأَلُهُمْ أَجْرًا فَهُم مِّن مَّغْرَمٍ مُّثْقَلُونَ", tr: "am tasʾaluhum ajran fa-hum min maghramin muthqalūn" },
  { ar: "أَمْ عِندَهُمُ الْغَيْبُ فَهُمْ يَكْتُبُونَ", tr: "am ʿindahumu l-ghaybu fa-hum yaktubūn" },
  { ar: "فَاصْبِرْ لِحُكْمِ رَبِّكَ وَلَا تَكُن كَصَاحِبِ الْحُوتِ إِذْ نَادَىٰ وَهُوَ مَكْظُومٌ", tr: "fa-ṣbir li-ḥukmi rabbika wa-lā takun ka-ṣāḥibi l-ḥūti idh nādā wa-huwa makẓūm" },
  { ar: "لَّوْلَا أَن تَدَارَكَهُ نِعْمَةٌ مِّن رَّبِّهِ لَنُبِذَ بِالْعَرَاءِ وَهُوَ مَذْمُومٌ", tr: "law-lā an tadārakahu niʿmatun min rabbihī la-nubidha bi-l-ʿarāʾi wa-huwa madhmūm" },
  { ar: "فَاجْتَبَاهُ رَبُّهُ فَجَعَلَهُ مِنَ الصَّالِحِينَ", tr: "fa-jtabāhu rabbuhu fa-jaʿalahu mina ṣ-ṣāliḥīn" },
  { ar: "وَإِن يَكَادُ الَّذِينَ كَفَرُوا لَيُزْلِقُونَكَ بِأَبْصَارِهِمْ لَمَّا سَمِعُوا الذِّكْرَ وَيَقُولُونَ إِنَّهُ لَمَجْنُونٌ", tr: "wa-in yakādu lladhīna kafarū la-yuzliqūnaka bi-abṣārihim lammā samiʿu dh-dhikra wa-yaqūlūna innahu la-majnūn" },
  { ar: "وَمَا هُوَ إِلَّا ذِكْرٌ لِّلْعَالَمِينَ", tr: "wa-mā huwa illā dhikrun li-l-ʿālamīn" },
], 68, 17);
const QALAM_FULL = [...QALAM_1_16, ...QALAM_17_52];

// --- Surat al-Haqqa (69), Ayat 11-52 ---
const HAQQA_11_52 = tagAyat([
  { ar: "إِنَّا لَمَّا طَغَى الْمَاءُ حَمَلْنَاكُمْ فِي الْجَارِيَةِ", tr: "innā lammā ṭaghā l-māʾu ḥamalnākum fi l-jāriyah" },
  { ar: "لِنَجْعَلَهَا لَكُمْ تَذْكِرَةً وَتَعِيَهَا أُذُنٌ وَاعِيَةٌ", tr: "li-najʿalahā lakum tadhkiratan wa-taʿiyahā udhunun wāʿiyah" },
  { ar: "فَإِذَا نُفِخَ فِي الصُّورِ نَفْخَةٌ وَاحِدَةٌ", tr: "fa-idhā nufikha fi ṣ-ṣūri nafkhatun wāḥidah" },
  { ar: "وَحُمِلَتِ الْأَرْضُ وَالْجِبَالُ فَدُكَّتَا دَكَّةً وَاحِدَةً", tr: "wa-ḥumilati l-arḍu wa-l-jibālu fa-dukkatā dakkatan wāḥidah" },
  { ar: "فَيَوْمَئِذٍ وَقَعَتِ الْوَاقِعَةُ", tr: "fa-yawmaʾidhin waqaʿati l-wāqiʿah" },
  { ar: "وَانشَقَّتِ السَّمَاءُ فَهِيَ يَوْمَئِذٍ وَاهِيَةٌ", tr: "wa-nshaqqati s-samāʾu fa-hiya yawmaʾidhin wāhiyah" },
  { ar: "وَالْمَلَكُ عَلَىٰ أَرْجَائِهَا ۚ وَيَحْمِلُ عَرْشَ رَبِّكَ فَوْقَهُمْ يَوْمَئِذٍ ثَمَانِيَةٌ", tr: "wa-l-malaku ʿalā arjāʾihā, wa-yaḥmilu ʿarsha rabbika fawqahum yawmaʾidhin thamāniyah" },
  { ar: "يَوْمَئِذٍ تُعْرَضُونَ لَا تَخْفَىٰ مِنكُمْ خَافِيَةٌ", tr: "yawmaʾidhin tuʿraḍūna lā takhfā minkum khāfiyah" },
  { ar: "فَأَمَّا مَنْ أُوتِيَ كِتَابَهُ بِيَمِينِهِ فَيَقُولُ هَاؤُمُ اقْرَءُوا كِتَابِيَهْ", tr: "fa-ammā man ūtiya kitābahu bi-yamīnihī fa-yaqūlu hāʾumu qraʾū kitābiyah" },
  { ar: "إِنِّي ظَنَنتُ أَنِّي مُلَاقٍ حِسَابِيَهْ", tr: "innī ẓanantu annī mulāqin ḥisābiyah" },
  { ar: "فَهُوَ فِي عِيشَةٍ رَّاضِيَةٍ", tr: "fa-huwa fī ʿīshatin rāḍiyah" },
  { ar: "فِي جَنَّةٍ عَالِيَةٍ", tr: "fī jannatin ʿāliyah" },
  { ar: "قُطُوفُهَا دَانِيَةٌ", tr: "quṭūfuhā dāniyah" },
  { ar: "كُلُوا وَاشْرَبُوا هَنِيئًا بِمَا أَسْلَفْتُمْ فِي الْأَيَّامِ الْخَالِيَةِ", tr: "kulū wa-shrabū hanīʾan bimā aslaftum fi l-ayyāmi l-khāliyah" },
  { ar: "وَأَمَّا مَنْ أُوتِيَ كِتَابَهُ بِشِمَالِهِ فَيَقُولُ يَا لَيْتَنِي لَمْ أُوتَ كِتَابِيَهْ", tr: "wa-ammā man ūtiya kitābahu bi-shimālihī fa-yaqūlu yā laytanī lam ūta kitābiyah" },
  { ar: "وَلَمْ أَدْرِ مَا حِسَابِيَهْ", tr: "wa-lam adri mā ḥisābiyah" },
  { ar: "يَا لَيْتَهَا كَانَتِ الْقَاضِيَةَ", tr: "yā laytahā kānati l-qāḍiyah" },
  { ar: "مَا أَغْنَىٰ عَنِّي مَالِيَهْ", tr: "mā aghnā ʿannī māliyah" },
  { ar: "هَلَكَ عَنِّي سُلْطَانِيَهْ", tr: "halaka ʿannī sulṭāniyah" },
  { ar: "خُذُوهُ فَغُلُّوهُ", tr: "khudhūhu fa-ghullūh" },
  { ar: "ثُمَّ الْجَحِيمَ صَلُّوهُ", tr: "thumma l-jaḥīma ṣallūh" },
  { ar: "ثُمَّ فِي سِلْسِلَةٍ ذَرْعُهَا سَبْعُونَ ذِرَاعًا فَاسْلُكُوهُ", tr: "thumma fī silsilatin dharʿuhā sabʿūna dhirāʿan fa-slukūh" },
  { ar: "إِنَّهُ كَانَ لَا يُؤْمِنُ بِاللَّهِ الْعَظِيمِ", tr: "innahu kāna lā yuʾminu billāhi l-ʿaẓīm" },
  { ar: "وَلَا يَحُضُّ عَلَىٰ طَعَامِ الْمِسْكِينِ", tr: "wa-lā yaḥuḍḍu ʿalā ṭaʿāmi l-miskīn" },
  { ar: "فَلَيْسَ لَهُ الْيَوْمَ هَاهُنَا حَمِيمٌ", tr: "fa-laysa lahu l-yawma hāhunā ḥamīm" },
  { ar: "وَلَا طَعَامٌ إِلَّا مِنْ غِسْلِينٍ", tr: "wa-lā ṭaʿāmun illā min ghislīn" },
  { ar: "لَّا يَأْكُلُهُ إِلَّا الْخَاطِئُونَ", tr: "lā yaʾkuluhū illā l-khāṭiʾūn" },
  { ar: "فَلَا أُقْسِمُ بِمَا تُبْصِرُونَ", tr: "fa-lā uqsimu bimā tubṣirūn" },
  { ar: "وَمَا لَا تُبْصِرُونَ", tr: "wa-mā lā tubṣirūn" },
  { ar: "إِنَّهُ لَقَوْلُ رَسُولٍ كَرِيمٍ", tr: "innahu la-qawlu rasūlin karīm" },
  { ar: "وَمَا هُوَ بِقَوْلِ شَاعِرٍ ۚ قَلِيلًا مَّا تُؤْمِنُونَ", tr: "wa-mā huwa bi-qawli shāʿir, qalīlan mā tuʾminūn" },
  { ar: "وَلَا بِقَوْلِ كَاهِنٍ ۚ قَلِيلًا مَّا تَذَكَّرُونَ", tr: "wa-lā bi-qawli kāhin, qalīlan mā tadhakkarūn" },
  { ar: "تَنزِيلٌ مِّن رَّبِّ الْعَالَمِينَ", tr: "tanzīlun min rabbi l-ʿālamīn" },
  { ar: "وَلَوْ تَقَوَّلَ عَلَيْنَا بَعْضَ الْأَقَاوِيلِ", tr: "wa-law taqawwala ʿalaynā baʿḍa l-aqāwīl" },
  { ar: "لَأَخَذْنَا مِنْهُ بِالْيَمِينِ", tr: "la-akhadhnā minhu bi-l-yamīn" },
  { ar: "ثُمَّ لَقَطَعْنَا مِنْهُ الْوَتِينَ", tr: "thumma la-qaṭaʿnā minhu l-watīn" },
  { ar: "فَمَا مِنكُم مِّنْ أَحَدٍ عَنْهُ حَاجِزِينَ", tr: "fa-mā minkum min aḥadin ʿanhu ḥājizīn" },
  { ar: "وَإِنَّهُ لَتَذْكِرَةٌ لِّلْمُتَّقِينَ", tr: "wa-innahu la-tadhkiratun li-l-muttaqīn" },
  { ar: "وَإِنَّا لَنَعْلَمُ أَنَّ مِنكُم مُّكَذِّبِينَ", tr: "wa-innā la-naʿlamu anna minkum mukadhdhibīn" },
  { ar: "وَإِنَّهُ لَحَسْرَةٌ عَلَى الْكَافِرِينَ", tr: "wa-innahu la-ḥasratun ʿala l-kāfirīn" },
  { ar: "وَإِنَّهُ لَحَقُّ الْيَقِينِ", tr: "wa-innahu la-ḥaqqu l-yaqīn" },
  { ar: "فَسَبِّحْ بِاسْمِ رَبِّكَ الْعَظِيمِ", tr: "fa-sabbiḥ bi-smi rabbika l-ʿaẓīm" },
], 69, 11);
const HAQQA_FULL = [...HAQQA_1_10, ...HAQQA_11_52];

// 3 Suren am Stueck, jetzt komplett (al-Mulk 30, al-Qalam 52, al-Haqqa 52 Ayat).
const DREI_SUREN = [...MULK_FULL, ...QALAM_FULL, ...HAQQA_FULL];

const QURAN_NOTE = "Text vor dem Lernen mit einem zuverlässigen Mushaf abgleichen.";

// Isti'adha + Basmala: wird in ReadingScreen nur auf der jeweils ersten
// Karte eines Lese-Durchgangs eingeblendet (schlicht, ohne weitere Zier-
// zeichen — die Umschrift ist eine gaengige, keine 1:1-Transliteration).
const OPENING_FORMULA = {
  isti: { ar: "أَعُوذُ بِاللَّهِ مِنَ الشَّيْطَانِ الرَّجِيمِ", tr: "aʿūdhu billāhi mina sh-shayṭāni r-rajīm" },
  basmala: { ar: "بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ", tr: "bismillāhi r-raḥmāni r-raḥīm" },
};

// ---- Hilfsfunktionen ----
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function fmtTime(ms) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m > 0) return `${m} min ${s.toString().padStart(2, "0")} s`;
  return `${s} s`;
}

// ============================================================
//  Fragen-Generatoren (Auswahl-Module)
//  Einheitliche Frageform, die PlayScreen rendern kann:
//    { audio, speakText, badge, prompt, promptArabic, questionText,
//      options: [{ label, correct, arabic }] }
// ============================================================

function makeLetterQuestion(mode) {
  const target = randOf(LETTERS);
  const posKeys = Object.keys(target.forms);
  const pos = randOf(posKeys);
  const badge = `Position: ${POS_LABEL[pos]}`;

  if (mode === "form2letter") {
    const distractors = shuffle(LETTERS.filter((l) => l.key !== target.key)).slice(0, 3);
    const options = shuffle([target, ...distractors]).map((l) => ({
      label: l.forms.isolated,
      correct: l.key === target.key,
      arabic: true,
    }));
    return {
      audio: false,
      speakText: target.base,
      badge,
      prompt: target.forms[pos],
      promptArabic: true,
      questionText: "Welcher Grundbuchstabe ist das?",
      options,
    };
  }
  // sound2form
  const others = shuffle(LETTERS.filter((l) => l.key !== target.key)).slice(0, 3);
  const options = shuffle([
    { label: target.forms[pos], correct: true, arabic: true },
    ...others.map((l) => ({
      label: l.forms[pos] || l.forms.isolated,
      correct: false,
      arabic: true,
    })),
  ]);
  return {
    audio: true,
    speakText: target.base,
    badge,
    prompt: null,
    promptArabic: false,
    questionText: "Welche Form gehört zu diesem Laut? (🔊 zum Wiederholen)",
    options,
  };
}

function makeHarakatQuestion(mode) {
  const L = randOf(HARAKAT_LETTERS);
  const h = randOf(HARAKAT);
  const glyph = L.base + h.mark;
  const audioSrc = HARAKAT_AUDIO_ENABLED ? harakatAudioSrc(L.key, h.id) : null;

  if (mode === "read2syllable") {
    // Zeichen zeigen -> richtige Silbe (a/i/u) waehlen. Distraktoren: gleicher
    // Buchstabe, andere Vokale -> trainiert genau die Vokal-Unterscheidung.
    const options = shuffle(
      HARAKAT.map((hh) => ({
        label: L.tr + hh.v,
        correct: hh.id === h.id,
        arabic: false,
      }))
    );
    return {
      audio: false,
      speakText: glyph,
      audioSrc,
      badge: null,
      prompt: glyph,
      promptArabic: true,
      questionText: "Wie wird das gelesen?",
      options,
    };
  }
  // sound2read: Silbe hoeren -> richtiges Zeichen waehlen
  const options = shuffle(
    HARAKAT.map((hh) => ({
      label: L.base + hh.mark,
      correct: hh.id === h.id,
      arabic: true,
    }))
  );
  return {
    audio: true,
    speakText: glyph,
    audioSrc,
    badge: null,
    prompt: null,
    promptArabic: false,
    questionText: "Welches Zeichen passt zum Laut? (🔊 zum Wiederholen)",
    options,
  };
}

// Aehnliche Buchstaben: ein Buchstabe wird in einer Positionsform gezeigt,
// zur Auswahl stehen NUR die verwechselbaren Geschwister derselben Gruppe.
// Der Lerneffekt liegt also im Unterscheiden ueber die Punkte.
function makeSimilarQuestion() {
  const group = randOf(SIMILAR_GROUPS);
  const members = group.letters.map((k) => LETTER_BY_KEY[k]);
  const target = randOf(members);

  // Erlaubte Positionen der Gruppe (falls gesetzt) mit den Formen schneiden,
  // die dieser Buchstabe wirklich hat (nicht-verbindende: nur isoliert/final).
  const allowed = group.positions || ALL_POS;
  const available = allowed.filter((p) => target.forms[p]);
  // Verbundene Formen sind lehrreicher; die isolierte Form nur nehmen, wenn es
  // keine andere Position gibt (z.B. koennte eine Gruppe rein isoliert sein).
  const connected = available.filter((p) => p !== "isolated");
  const pos = randOf(connected.length ? connected : available);

  const options = shuffle(
    members.map((l) => ({
      label: l.forms.isolated,
      correct: l.key === target.key,
      arabic: true,
    }))
  );
  return {
    audio: false,
    speakText: target.base,
    badge: `Position: ${POS_LABEL[pos]}`,
    prompt: target.forms[pos],
    promptArabic: true,
    questionText: "Welcher Buchstabe ist das? Achte auf die Punkte.",
    options,
  };
}

// ============================================================
//  Modul-Registry
// ============================================================
const CHOICE_MODULES = {
  letters: {
    id: "letters",
    kind: "choice",
    title: "Buchstaben",
    subtitle: "Buchstaben in allen Positionen erkennen",
    make: makeLetterQuestion,
    modes: [
      { id: "form2letter", audio: false, label: "Form → Buchstabe", sub: "Eine Positionsform wird gezeigt, du wählst den Grundbuchstaben." },
      { id: "sound2form", audio: true, label: "Laut → Form", sub: "Der Buchstabe wird vorgelesen, du wählst die richtige Form." },
    ],
  },
  similar: {
    id: "similar",
    kind: "choice",
    title: "Ähnliche Buchstaben",
    subtitle: "Verwechselbare Buchstaben an den Punkten unterscheiden",
    make: makeSimilarQuestion,
    modes: [
      { id: "which", audio: false, label: "Form → Buchstabe", sub: "Ein ähnlich aussehender Buchstabe wird gezeigt, du erkennst ihn an Anzahl und Lage der Punkte." },
    ],
  },
  harakat: {
    id: "harakat",
    kind: "choice",
    title: "Kurzvokale",
    subtitle: "Fatha, Kasra, Damma an Buchstaben lesen",
    make: makeHarakatQuestion,
    modes: [
      { id: "read2syllable", audio: false, label: "Zeichen → Laut", sub: "Buchstabe mit Vokalzeichen wird gezeigt, du wählst die richtige Silbe." },
      { id: "sound2read", audio: true, label: "Laut → Zeichen", sub: "Eine Silbe wird vorgelesen, du wählst das passende Vokalzeichen." },
    ],
  },
};

const READING_MODULES = {
  ayat: {
    id: "ayat",
    kind: "reading",
    title: "Verse & Suren lesen",
    subtitle: "Ayat und Suren lesen und selbst prüfen",
    packs: [
      { id: "mulk15", label: "al-Mulk — Ayah 1–5", items: MULK_1_5, note: QURAN_NOTE },
      { id: "mulk611", label: "al-Mulk — Ayah 6–11", items: MULK_6_11, note: QURAN_NOTE },
      { id: "qalam116", label: "al-Qalam — Ayah 1–16", items: QALAM_1_16, note: QURAN_NOTE },
      { id: "haqqa110", label: "al-Haqqa — Ayah 1–10", items: HAQQA_1_10, note: QURAN_NOTE },
      { id: "maarij", label: "al-Maʿārij — komplett (1–44)", items: MAARIJ_1_44, note: QURAN_NOTE },
      { id: "drei", label: "3 Suren am Stück — komplett (Mulk, Qalam, Haqqa)", items: DREI_SUREN, note: QURAN_NOTE },
    ],
  },
};

const MODULE_ORDER = ["letters", "similar", "harakat", "words", "ayat", "lesehilfen"];

// ============================================================
//  Wörter lesen (Aussprache-Check-Ablauf)
//  Ablauf je Wort: arabisches Wort (mit Harakat) zeigen -> selbst laut
//  lesen -> "Lösung zeigen" -> Umschrift + kurzer Hinweis -> "Nächstes
//  Wort". Kein Bewerten, keine Statistik, per Klick weiter.
//
//  Der Hinweis (`hint`) ist je Kategorie unterschiedlich sinnvoll:
//   - Regel-Kategorien (Sukun, spaeter Tanwin/Shadda/Madd): Ausspracheregel.
//   - Vokabel-Kategorien (al-Mulk/al-Qalam): die Bedeutung, da es dort
//     keine einheitliche Ausspracheregel gibt.
//  Fehlt `hint` bei einem Wort, greift die `rule` der Kategorie.
//  Neue Regel-Kategorie ergaenzen: Array wie PRONUN_SUKUN anlegen und als
//  Pack-Objekt (mit `rule`) ins packs-Array haengen.
// ============================================================
const PRONUN_SUKUN = [
  { ar: "قَدْ", tr: "qad", hint: "qa + d ohne Vokal — hart abschneiden, nicht „qada“." },
  { ar: "لَمْ", tr: "lam", hint: "la + m ohne Vokal — Lippen auf „m“ schließen." },
  { ar: "قُلْ", tr: "qul", hint: "qu + l ohne Vokal — hart auf „l“ enden." },
  { ar: "مِنْ", tr: "min", hint: "mi + n ohne Vokal — nasal auf „n“ enden." },
  { ar: "عَنْ", tr: "ʿan", hint: "ʿa (Kehllaut) + n ohne Vokal — kurz, nicht „ʿana“." },
  { ar: "هَلْ", tr: "hal", hint: "ha + l ohne Vokal — auf „l“ abschneiden." },
  { ar: "بَلْ", tr: "bal", hint: "ba + l ohne Vokal — auf „l“ abschneiden." },
  { ar: "كَمْ", tr: "kam", hint: "ka + m ohne Vokal — Lippen auf „m“ schließen." },
  { ar: "لَنْ", tr: "lan", hint: "la + n ohne Vokal — nasal auf „n“ enden." },
  { ar: "مَنْ", tr: "man", hint: "ma + n ohne Vokal — nasal auf „n“ enden." },
  { ar: "كَيْفَ", tr: "kayfa", hint: "Sukun auf ي (يْ) — kay, dann fa: kayfa." },
  { ar: "أَيْنَ", tr: "ayna", hint: "Sukun auf ي — ay, dann na: ayna." },
  { ar: "فَوْق", tr: "fawq", hint: "Sukun auf و (وْ) — faw, dann q: fawq." },
  { ar: "تَحْت", tr: "taḥt", hint: "Sukun auf ح — taḥ, dann t: taḥt." },
  { ar: "نَعَمْ", tr: "naʿam", hint: "Sukun auf م — naʿa, dann m abschneiden: naʿam." },
  { ar: "شَمْس", tr: "shams", hint: "Sukun auf م (مْ) — sham, dann s: shams." },
  { ar: "عَبْد", tr: "ʿabd", hint: "Sukun auf ب — ʿab, dann d: ʿabd." },
  { ar: "خَيْر", tr: "khayr", hint: "Sukun auf ي — khay, dann r: khayr." },
  { ar: "بَعْد", tr: "baʿd", hint: "Sukun auf ع — baʿ, dann d: baʿd." },
  { ar: "قَبْل", tr: "qabl", hint: "Sukun auf ب — qab, dann l: qabl." },
  { ar: "سَمْع", tr: "samʿ", hint: "Sukun auf م — sam, dann ʿ: samʿ." },
  { ar: "عِلْم", tr: "ʿilm", hint: "Sukun auf ل — ʿil, dann m: ʿilm." },
  { ar: "حُكْم", tr: "ḥukm", hint: "Sukun auf ك — ḥuk, dann m: ḥukm." },
  { ar: "نَصْر", tr: "naṣr", hint: "Sukun auf ص — naṣ, dann r: naṣr." },
  { ar: "صَبْر", tr: "ṣabr", hint: "Sukun auf ب — ṣab, dann r: ṣabr." },
  { ar: "فَجْر", tr: "fajr", hint: "Sukun auf ج — faj, dann r: fajr." },
  { ar: "ظُلْم", tr: "ẓulm", hint: "Sukun auf ل — ẓul, dann m: ẓulm." },
  { ar: "أَمْر", tr: "amr", hint: "Sukun auf م — am, dann r: amr." },
  { ar: "وَقْت", tr: "waqt", hint: "Sukun auf ق — waq, dann t: waqt." },
  { ar: "بِنْت", tr: "bint", hint: "Sukun auf ن — bin, dann t: bint." },
];

// Tanwin (Nunation): doppeltes Vokalzeichen am Wortende, klingt wie ein
// zusätzliches „n“. ٌ = -un, ٍ = -in, ً = -an. Bei ً steht meist ein stummes
// Alif (ـًا), das NICHT als langes „a“ mitgesprochen wird.
const PRONUN_TANWIN = [
  { ar: "رَجُلٌ", tr: "rajulun", hint: "Endung ٌ (Tanwin Damma) = „-un“: rajul + un." },
  { ar: "وَلَدٌ", tr: "waladun", hint: "ٌ = „-un“: walad + un." },
  { ar: "بَيْتٌ", tr: "baytun", hint: "ٌ = „-un“: bayt + un." },
  { ar: "رِزْقٌ", tr: "rizqun", hint: "ٌ = „-un“: rizq + un." },
  { ar: "كَلْبٌ", tr: "kalbun", hint: "ٌ = „-un“: kalb + un." },
  { ar: "عَبْدٌ", tr: "ʿabdun", hint: "ٌ = „-un“: ʿabd + un." },
  { ar: "بَحْرٌ", tr: "baḥrun", hint: "ٌ = „-un“: baḥr + un." },
  { ar: "نَجْمٌ", tr: "najmun", hint: "ٌ = „-un“: najm + un." },
  { ar: "شَمْسٌ", tr: "shamsun", hint: "ٌ = „-un“: shams + un." },
  { ar: "قَلْبٌ", tr: "qalbun", hint: "ٌ = „-un“: qalb + un." },
  { ar: "يَوْمٍ", tr: "yawmin", hint: "Endung ٍ (Tanwin Kasra) = „-in“: yawm + in." },
  { ar: "قَوْمٍ", tr: "qawmin", hint: "ٍ = „-in“: qawm + in." },
  { ar: "بَيْتٍ", tr: "baytin", hint: "ٍ = „-in“: bayt + in." },
  { ar: "رَجُلٍ", tr: "rajulin", hint: "ٍ = „-in“: rajul + in." },
  { ar: "شَيْءٍ", tr: "shayʾin", hint: "ٍ = „-in“: shayʾ + in." },
  { ar: "نَفْسٍ", tr: "nafsin", hint: "ٍ = „-in“: nafs + in." },
  { ar: "أَرْضٍ", tr: "arḍin", hint: "ٍ = „-in“: arḍ + in." },
  { ar: "عَبْدٍ", tr: "ʿabdin", hint: "ٍ = „-in“: ʿabd + in." },
  { ar: "أَمْرٍ", tr: "amrin", hint: "ٍ = „-in“: amr + in." },
  { ar: "وَقْتٍ", tr: "waqtin", hint: "ٍ = „-in“: waqt + in." },
  { ar: "شُكْرًا", tr: "shukran", hint: "Endung ـًا (Tanwin Fatha) = „-an“: shukr + an. Das Alif ist stumm." },
  { ar: "عِلْمًا", tr: "ʿilman", hint: "ـًا = „-an“: ʿilm + an. Alif stumm." },
  { ar: "خَيْرًا", tr: "khayran", hint: "ـًا = „-an“: khayr + an. Alif stumm." },
  { ar: "حَمْدًا", tr: "ḥamdan", hint: "ـًا = „-an“: ḥamd + an. Alif stumm." },
  { ar: "فَضْلًا", tr: "faḍlan", hint: "ـًا = „-an“: faḍl + an. Alif stumm." },
  { ar: "وَعْدًا", tr: "waʿdan", hint: "ـًا = „-an“: waʿd + an. Alif stumm." },
  { ar: "عَهْدًا", tr: "ʿahdan", hint: "ـًا = „-an“: ʿahd + an. Alif stumm." },
  { ar: "حَرْبًا", tr: "ḥarban", hint: "ـًا = „-an“: ḥarb + an. Alif stumm." },
  { ar: "ذَنْبًا", tr: "dhanban", hint: "ـًا = „-an“: dhanb + an. Alif stumm." },
  { ar: "كَنْزًا", tr: "kanzan", hint: "ـًا = „-an“: kanz + an. Alif stumm." },
];

// Vokabel-Listen ({ar,tr,de}) in Aussprache-Items ({ar,tr,hint}) umwandeln:
// die Bedeutung wird zum Hinweis. So bleibt der Inhalt erhalten.
function meaningItems(arr) {
  return arr.map((w) => ({ ar: w.ar, tr: w.tr, hint: w.de }));
}

// Shadda (ّ) verdoppelt den Konsonanten (Gemination): kurz auf dem Laut
// verweilen, ihn verstärkt/doppelt sprechen.
const PRONUN_SHADDA = [
  { ar: "رَبّ", tr: "rabb", hint: "Shadda auf ب → b verdoppelt: „rab-b“." },
  { ar: "إِنَّ", tr: "inna", hint: "Shadda auf ن → n verdoppelt: „in-na“." },
  { ar: "حَقّ", tr: "ḥaqq", hint: "Shadda auf ق → q verdoppelt: „ḥaq-q“." },
  { ar: "كُلّ", tr: "kull", hint: "Shadda auf ل → l verdoppelt: „kul-l“." },
  { ar: "أُمّ", tr: "umm", hint: "Shadda auf م → m verdoppelt: „um-m“." },
  { ar: "جَنَّة", tr: "janna", hint: "Shadda auf ن → n verdoppelt: „jan-na“." },
  { ar: "عَدُوّ", tr: "ʿaduww", hint: "Shadda auf و → w verdoppelt: „ʿaduw-w“." },
  { ar: "مُحَمَّد", tr: "muḥammad", hint: "Shadda auf م → m verdoppelt: „muḥam-mad“." },
  { ar: "عَلَّمَ", tr: "ʿallama", hint: "Shadda auf ل → l verdoppelt: „ʿal-lama“." },
  { ar: "حُبّ", tr: "ḥubb", hint: "Shadda auf ب → b verdoppelt: „ḥub-b“." },
  { ar: "سِرّ", tr: "sirr", hint: "Shadda auf ر → r verdoppelt: „sir-r“." },
  { ar: "مَرَّة", tr: "marra", hint: "Shadda auf ر → r verdoppelt: „mar-ra“." },
  { ar: "ظَنَّ", tr: "ẓanna", hint: "Shadda auf ن → n verdoppelt: „ẓan-na“." },
  { ar: "شِدَّة", tr: "shidda", hint: "Shadda auf د → d verdoppelt: „shid-da“." },
  { ar: "حَجّ", tr: "ḥajj", hint: "Shadda auf ج → j verdoppelt: „ḥaj-j“." },
  { ar: "جِدّ", tr: "jidd", hint: "Shadda auf د → d verdoppelt: „jid-d“." },
  { ar: "شَكّ", tr: "shakk", hint: "Shadda auf ك → k verdoppelt: „shak-k“." },
  { ar: "ظِلّ", tr: "ẓill", hint: "Shadda auf ل → l verdoppelt: „ẓil-l“." },
  { ar: "سِنّ", tr: "sinn", hint: "Shadda auf ن → n verdoppelt: „sin-n“." },
  { ar: "جَدّ", tr: "jadd", hint: "Shadda auf د → d verdoppelt: „jad-d“." },
  { ar: "خَطّ", tr: "khaṭṭ", hint: "Shadda auf ط → ṭ verdoppelt: „khaṭ-ṭ“." },
  { ar: "صَفّ", tr: "ṣaff", hint: "Shadda auf ف → f verdoppelt: „ṣaf-f“." },
  { ar: "طِبّ", tr: "ṭibb", hint: "Shadda auf ب → b verdoppelt: „ṭib-b“." },
  { ar: "فَنّ", tr: "fann", hint: "Shadda auf ن → n verdoppelt: „fan-n“." },
  { ar: "قِطّ", tr: "qiṭṭ", hint: "Shadda auf ط → ṭ verdoppelt: „qiṭ-ṭ“." },
  { ar: "لَذَّة", tr: "ladhdha", hint: "Shadda auf ذ → dh verdoppelt: „ladh-dha“." },
  { ar: "عِزّ", tr: "ʿizz", hint: "Shadda auf ز → z verdoppelt: „ʿiz-z“." },
  { ar: "ذَرَّة", tr: "dharra", hint: "Shadda auf ر → r verdoppelt: „dhar-ra“." },
  { ar: "كَفّ", tr: "kaff", hint: "Shadda auf ف → f verdoppelt: „kaf-f“." },
  { ar: "رَدّ", tr: "radd", hint: "Shadda auf د → d verdoppelt: „rad-d“." },
];

// Madd = Dehnung des Vokals (natürliches Madd, ~2 Zählzeiten). Drei
// Dehnbuchstaben: Alif nach Fatha = langes ā, Waw nach Damma = langes ū,
// Ya nach Kasra = langes ī.
const PRONUN_MADD = [
  { ar: "قَالَ", tr: "qāla", hint: "Alif nach Fatha (قَا) → langes „a“: qāla, nicht kurz „qala“." },
  { ar: "نَار", tr: "nār", hint: "Alif nach Fatha → langes „a“: nār." },
  { ar: "بَاب", tr: "bāb", hint: "Alif nach Fatha → langes „a“: bāb." },
  { ar: "مَال", tr: "māl", hint: "Alif nach Fatha → langes „a“: māl." },
  { ar: "نَاس", tr: "nās", hint: "Alif nach Fatha → langes „a“: nās." },
  { ar: "عَالَم", tr: "ʿālam", hint: "Alif nach Fatha → langes „a“: ʿālam." },
  { ar: "كِتَاب", tr: "kitāb", hint: "Alif nach Fatha (تَا) → langes „a“: kitāb." },
  { ar: "سَلَام", tr: "salām", hint: "Alif nach Fatha → langes „a“: salām." },
  { ar: "إِنْسَان", tr: "insān", hint: "Alif nach Fatha → langes „a“: insān." },
  { ar: "بَارِد", tr: "bārid", hint: "Alif nach Fatha (بَا) → langes „a“: bārid." },
  { ar: "يَقُولُ", tr: "yaqūlu", hint: "Waw nach Damma (قُو) → langes „u“: yaqūlu." },
  { ar: "نُور", tr: "nūr", hint: "Waw nach Damma → langes „u“: nūr, nicht kurz „nur“." },
  { ar: "رُوح", tr: "rūḥ", hint: "Waw nach Damma → langes „u“: rūḥ." },
  { ar: "يَكُونُ", tr: "yakūnu", hint: "Waw nach Damma → langes „u“: yakūnu." },
  { ar: "صُور", tr: "ṣūr", hint: "Waw nach Damma → langes „u“: ṣūr." },
  { ar: "دُون", tr: "dūn", hint: "Waw nach Damma → langes „u“: dūn." },
  { ar: "سُورَة", tr: "sūra", hint: "Waw nach Damma (سُو) → langes „u“: sūra." },
  { ar: "رَسُول", tr: "rasūl", hint: "Waw nach Damma → langes „u“: rasūl." },
  { ar: "عُود", tr: "ʿūd", hint: "Waw nach Damma → langes „u“: ʿūd." },
  { ar: "طُول", tr: "ṭūl", hint: "Waw nach Damma → langes „u“: ṭūl." },
  { ar: "قِيلَ", tr: "qīla", hint: "Ya nach Kasra (قِي) → langes „i“: qīla." },
  { ar: "كَبِير", tr: "kabīr", hint: "Ya nach Kasra → langes „i“: kabīr." },
  { ar: "رَحِيم", tr: "raḥīm", hint: "Ya nach Kasra → langes „i“: raḥīm." },
  { ar: "دِين", tr: "dīn", hint: "Ya nach Kasra → langes „i“: dīn." },
  { ar: "عِيد", tr: "ʿīd", hint: "Ya nach Kasra → langes „i“: ʿīd." },
  { ar: "سَعِيد", tr: "saʿīd", hint: "Ya nach Kasra → langes „i“: saʿīd." },
  { ar: "بَعِيد", tr: "baʿīd", hint: "Ya nach Kasra (عِي) → langes „i“: baʿīd." },
  { ar: "طَرِيق", tr: "ṭarīq", hint: "Ya nach Kasra → langes „i“: ṭarīq." },
  { ar: "كَرِيم", tr: "karīm", hint: "Ya nach Kasra → langes „i“: karīm." },
  { ar: "جَمِيل", tr: "jamīl", hint: "Ya nach Kasra → langes „i“: jamīl." },
];

const PRONUN_MODULES = {
  words: {
    id: "words",
    kind: "pronunciation",
    title: "Wörter lesen",
    subtitle: "Wort lesen, dann Umschrift + Hinweis prüfen",
    packs: [
      {
        id: "sukun",
        label: "Sukun",
        rule: "Sukun (ْ) heißt: der Buchstabe trägt keinen Vokal. Kurz und hart aussprechen, ohne Vokal danach.",
        items: PRONUN_SUKUN,
      },
      {
        id: "tanwin",
        label: "Tanwin",
        rule: "Tanwin ist ein doppeltes Vokalzeichen am Wortende und klingt wie ein zusätzliches „n“: ٌ = -un, ٍ = -in, ً = -an. Bei ً steht meist ein stummes Alif (ـًا).",
        items: PRONUN_TANWIN,
      },
      // Shadda zeigt jetzt die Ausspracheregel (Gemination), analog Sukun/Tanwin.
      {
        id: "shadda",
        label: "Shadda",
        rule: "Shadda (ّ) verdoppelt den Buchstaben: kurz auf dem Laut verweilen und ihn verstärkt aussprechen.",
        items: PRONUN_SHADDA,
      },
      {
        id: "madd",
        label: "Madd Aslī",
        rule: "Madd Aslī (natürliches Madd) = Vokal dehnen, etwa doppelt so lang. Alif nach Fatha = langes „ā“, Waw nach Damma = langes „ū“, Ya nach Kasra = langes „ī“. (Die längeren Madd-Arten des Tajwīd sind hier nicht enthalten.)",
        items: PRONUN_MADD,
      },
      // al-Mulk / al-Qalam zeigen die Bedeutung als Hinweis (Vokabeln, keine Regel).
      {
        id: "mulkW",
        label: "al-Mulk — 5 Wörter",
        rule: "Wörter aus Sūrat al-Mulk.",
        items: meaningItems(WORDS_MULK),
      },
      {
        id: "qalamW",
        label: "al-Qalam — 10 Wörter",
        rule: "Wörter aus Sūrat al-Qalam.",
        items: meaningItems(WORDS_QALAM),
      },
    ],
  },
};

function getModule(id) {
  return CHOICE_MODULES[id] || READING_MODULES[id] || PRONUN_MODULES[id] || GUIDE_MODULES[id];
}

// ============================================================
//  Lesehilfen — Simulator mit Lernkarten + Quiz je Thema
//  Thema 1: Lam Shamsiya / Qamariya (Sonnen-/Mondbuchstaben)
//  Thema 2: Waqf-Zeichen (Pausenzeichen im Mushaf)
//  Fakten geprüft: Sonnen-/Mondbuchstaben (14+14) und Waqf-Zeichen
//  nach dem Madinah-Mushaf (König-Fahd-Komplex). Wörter tragen die
//  echten Marker: Mondbuchstaben Sukun auf dem Lam (الْ), Sonnenbuchstaben
//  Shadda auf dem Folgebuchstaben (الشّ), Lam stumm.
// ============================================================

// type: "qamariya" = Lam wird gesprochen; "shamsiya" = Lam stumm, nächster
// Buchstabe verdoppelt. read = Aussprache, de = Bedeutung.
const GUIDE_LAM = [
  // Sonnenbuchstaben (14): Lam stumm, Shadda auf dem Folgebuchstaben
  { ar: "التِّين", type: "shamsiya", read: "at-tīn", de: "die Feige" },
  { ar: "الثَّمَر", type: "shamsiya", read: "ath-thamar", de: "die Frucht" },
  { ar: "الدِّين", type: "shamsiya", read: "ad-dīn", de: "die Religion" },
  { ar: "الذَّهَب", type: "shamsiya", read: "adh-dhahab", de: "das Gold" },
  { ar: "الرَّجُل", type: "shamsiya", read: "ar-rajul", de: "der Mann" },
  { ar: "الزَّيْت", type: "shamsiya", read: "az-zayt", de: "das Öl" },
  { ar: "السَّمَاء", type: "shamsiya", read: "as-samāʾ", de: "der Himmel" },
  { ar: "الشَّمْس", type: "shamsiya", read: "ash-shams", de: "die Sonne" },
  { ar: "الصَّبْر", type: "shamsiya", read: "aṣ-ṣabr", de: "die Geduld" },
  { ar: "الضَّيْف", type: "shamsiya", read: "aḍ-ḍayf", de: "der Gast" },
  { ar: "الطَّرِيق", type: "shamsiya", read: "aṭ-ṭarīq", de: "der Weg" },
  { ar: "الظُّهْر", type: "shamsiya", read: "aẓ-ẓuhr", de: "der Mittag" },
  { ar: "اللَّيْل", type: "shamsiya", read: "al-layl", de: "die Nacht" },
  { ar: "النَّاس", type: "shamsiya", read: "an-nās", de: "die Menschen" },
  // Mondbuchstaben (14): Lam wird gesprochen, Sukun auf dem Lam
  { ar: "الْأَرْض", type: "qamariya", read: "al-arḍ", de: "die Erde" },
  { ar: "الْبَاب", type: "qamariya", read: "al-bāb", de: "die Tür" },
  { ar: "الْجَبَل", type: "qamariya", read: "al-jabal", de: "der Berg" },
  { ar: "الْحَمْد", type: "qamariya", read: "al-ḥamd", de: "das Lob" },
  { ar: "الْخَيْر", type: "qamariya", read: "al-khayr", de: "das Gute" },
  { ar: "الْعِلْم", type: "qamariya", read: "al-ʿilm", de: "das Wissen" },
  { ar: "الْغَيْب", type: "qamariya", read: "al-ghayb", de: "das Verborgene" },
  { ar: "الْفَجْر", type: "qamariya", read: "al-fajr", de: "die Morgendämmerung" },
  { ar: "الْقَمَر", type: "qamariya", read: "al-qamar", de: "der Mond" },
  { ar: "الْكِتَاب", type: "qamariya", read: "al-kitāb", de: "das Buch" },
  { ar: "الْمَاء", type: "qamariya", read: "al-māʾ", de: "das Wasser" },
  { ar: "الْوَلَد", type: "qamariya", read: "al-walad", de: "das Kind" },
  { ar: "الْهَوَاء", type: "qamariya", read: "al-hawāʾ", de: "die Luft" },
  { ar: "الْيَوْم", type: "qamariya", read: "al-yawm", de: "der Tag" },
];

// Erklärtexte je Typ (für Lernkarte und Quiz-Auflösung).
const LAM_EXPLAIN = {
  shamsiya: "Sonnenbuchstabe → Lam Shamsiya: das ل wird NICHT gesprochen, der folgende Buchstabe trägt eine Shadda und wird verdoppelt.",
  qamariya: "Mondbuchstabe → Lam Qamariya: das ل wird gesprochen (Sukun auf dem Lam: الْ).",
};

// Waqf-Zeichen (Madinah-Mushaf). sign = Zeichen, name = Bezeichnung,
// short = Kurzhandlung (Quiz-Option), long = Erklärung.
const GUIDE_WAQF = [
  { sign: "م", name: "Waqf Lāzim", short: "Pflicht-Halt", long: "Du MUSST hier anhalten. Weiterlesen würde die Bedeutung verändern." },
  { sign: "لا", name: "Lā (Waqf Mamnūʿ)", short: "Nicht halten", long: "Hier NICHT anhalten, durchlesen. Nur am Versende (Kreis) ist Halten erlaubt." },
  { sign: "ج", name: "Waqf Ǧāʾiz", short: "Halten erlaubt", long: "Frei: halten oder weiterlesen, beides gleichwertig." },
  { sign: "قلى", name: "al-Waqf awlā", short: "Besser halten", long: "Halten ist besser, weiterlesen ist aber erlaubt." },
  { sign: "صلى", name: "al-Waṣl awlā", short: "Besser weiter", long: "Weiterlesen ist besser, halten ist aber erlaubt." },
  { sign: "ط", name: "Waqf Muṭlaq", short: "Empfohlener Halt", long: "Guter, empfohlener Halt — hier darfst du gut anhalten." },
  { sign: "ز", name: "Waqf Muǧawwaz", short: "Halten erlaubt, weiter besser", long: "Halten ist erlaubt, aber weiterlesen ist besser." },
  { sign: "ص", name: "Waqf Murakhkhaṣ", short: "Halten bei Bedarf", long: "Halten nur bei Bedarf (z. B. Atemnot) erlaubt, sonst weiterlesen." },
  { sign: "∴ ∴", name: "Muʿānaqa (Taʿānuq)", short: "Nur an EINER Stelle halten", long: "Zwei Dreier-Punktgruppen: Du hältst an EINEM der beiden Punkte — nicht an beiden." },
  { sign: "س", name: "Saktah", short: "Kurze Pause ohne Atmen", long: "Kurze Atempause OHNE auszuatmen — kürzer als ein normaler Halt." },
  { sign: "ك", name: "Kadhālika", short: "Wie das vorige Zeichen", long: "„Ebenso“: gleiche Bedeutung wie das zuletzt gezeigte Waqf-Zeichen davor." },
];

const GUIDE_MODULES = {
  lesehilfen: {
    id: "lesehilfen",
    kind: "guide",
    title: "Lesehilfen",
    subtitle: "Erst lernen, dann Quiz — mit Erklärungen",
    packs: [
      {
        id: "lam",
        label: "Lam Shamsiya / Qamariya",
        topic: "lam",
        intro: "Der Artikel ال (al-). Bei Sonnenbuchstaben verschwindet das Lam und der nächste Buchstabe wird verdoppelt (الشَّمْس = „asch-schams“). Bei Mondbuchstaben spricht man das Lam (الْقَمَر = „al-qamar“).",
        data: GUIDE_LAM,
      },
      {
        id: "waqf",
        label: "Waqf-Zeichen",
        topic: "waqf",
        intro: "Die kleinen Zeichen im Mushaf sagen, wo du anhalten musst, darfst oder nicht. System des Madinah-Mushaf.",
        data: GUIDE_WAQF,
      },
    ],
  },
};

// ============================================================
//  Fortschritts-Statistik (localStorage, nur auf diesem Geraet)
//  Ein Datensatz je Modus/Paket:
//    { runs, answered, correct, bestStreak, lastTs }
//  Gesamt-Trefferquote = correct / answered ueber alle Durchgaenge.
// ============================================================
const STATS_LS_KEY = "arabtrainer:stats:v1";

function loadAllStats() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(STATS_LS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveAllStats(obj) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATS_LS_KEY, JSON.stringify(obj));
  } catch {
    // localStorage kann blockiert sein (Privatmodus) -> still ignorieren
  }
}
function statAccuracyOf(rec) {
  return rec && rec.answered > 0 ? Math.round((rec.correct / rec.answered) * 100) : 0;
}

// ============================================================
//  Lesen-Checkliste (Selbst-Abhaken, localStorage)
//  Reihenfolge und Kategorien wie in der Notion-Liste des Nutzers.
//  Die App hakt NICHT automatisch ab; man setzt den Haken selbst.
// ============================================================
const CHECK_LS_KEY = "arabtrainer:checklist:v1";

const CHECK_CATS = {
  alphabet: { label: "Alphabet", fg: "#8fb4e0", bg: "rgba(107,155,209,0.16)" },
  harakat: { label: "Harakat", fg: "#d79a9a", bg: "rgba(201,138,138,0.16)" },
  lesehilfen: { label: "Lesehilfen", fg: "#bb9ce0", bg: "rgba(168,138,201,0.16)" },
  woerter: { label: "Wörter", fg: "#7fce9f", bg: "rgba(63,174,107,0.16)" },
  lesen: { label: "Lesen", fg: "#e0c37f", bg: "rgba(217,178,95,0.16)" },
};

const CHECKLIST = [
  { id: "c01", cat: "alphabet", text: "Ich erkenne alle 28 Buchstaben im Mushaf (Qurʾān-Schrift)" },
  { id: "c02", cat: "alphabet", text: "Ich unterscheide ähnlich aussehende Buchstaben (ب/ت/ث/ن/ي) im Mushaf" },
  { id: "c03", cat: "harakat", text: "Ich kenne die drei Kurzvokale: Fatha (a), Kasra (i), Damma (u)" },
  { id: "c04", cat: "harakat", text: "Ich lese Wörter mit Sukūn im Qurʾān (z. B. قَدْ, لَمْ, قُلْ)" },
  { id: "c05", cat: "harakat", text: "Ich lese Wörter mit Tanwīn (رَجُلٌ, كِتَابٍ, شُكْرًا)" },
  { id: "c06", cat: "harakat", text: "Ich lese Wörter mit Shadda im Qurʾān (z. B. إِنَّ, رَبّ, حَقّ)" },
  { id: "c07", cat: "harakat", text: "Ich lese Wörter mit Madd Aslī / natürlichem Madd (قَالَ, يَقُولُ, قِيلَ)" },
  { id: "c08", cat: "lesehilfen", text: "Ich unterscheide Lam Shamsiya und Lam Qamariya (السَّمَاء vs. الْقَمَر)" },
  { id: "c09", cat: "lesehilfen", text: "Ich erkenne die gängigen Waqf-Zeichen" },
  { id: "c10", cat: "woerter", text: "Ich lese 5 einzelne Wörter aus Sūrat al-Mulk" },
  { id: "c11", cat: "woerter", text: "Ich lese 10 Wörter aus Sūrat al-Qalam" },
  { id: "c12", cat: "lesen", text: "Ich lese Sūrat al-Mulk, Ayah 1–5" },
  { id: "c13", cat: "lesen", text: "Ich lese Sūrat al-Mulk, Ayah 6–11" },
  { id: "c14", cat: "lesen", text: "Ich lese Sūrat al-Qalam, Ayah 1–16" },
  { id: "c15", cat: "lesen", text: "Ich lese Sūrat al-Ḥāqqa, Ayah 1–10" },
  { id: "c16", cat: "lesen", text: "Ich lese eine kurze Sura komplett (z. B. al-Maʿārij)" },
  { id: "c17", cat: "lesen", text: "Ich lese 3 Suren hintereinander (al-Mulk, al-Qalam, al-Ḥāqqa)" },
];

function loadChecklist() {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(CHECK_LS_KEY)) || {};
  } catch {
    return {};
  }
}
function saveChecklist(obj) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHECK_LS_KEY, JSON.stringify(obj));
  } catch {
    // Speicher blockiert -> ignorieren
  }
}

// ============================================================
//  Deutsche Übersetzung: LIVE von quranenc.com (Abu Rida)
//  Kein aus dem Gedaechtnis geschriebener Text mehr. Pro Vers wird der
//  geprüfte Text abgerufen und lokal gecached, damit er beim naechsten
//  Mal offline verfuegbar ist. Kein Fallback-Text: laedt es nicht, steht
//  das ehrlich dran, statt moeglicherweise Falsches anzuzeigen.
//  Quelle/Key: german_aburida  (https://quranenc.com/en/home/api/)
// ============================================================
const TRANS_KEY = "german_aburida";
const TRANS_CREDIT = "Übersetzung: Abu Rida (quranenc.com)";
const TRANS_LS_PREFIX = "arabtrainer:trans:v1:";

function transCacheGet(surah, ayah) {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${TRANS_LS_PREFIX}${surah}:${ayah}`);
  } catch {
    return null;
  }
}
function transCacheSet(surah, ayah, text) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${TRANS_LS_PREFIX}${surah}:${ayah}`, text);
  } catch {
    // Speicher evtl. voll/blockiert -> ignorieren
  }
}
async function fetchAburida(surah, ayah) {
  const url = `https://quranenc.com/api/v1/translation/aya/${TRANS_KEY}/${surah}/${ayah}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  // Antwort ist { result: { translation, ... } } (defensiv beide Formen)
  const t = (data && data.result && data.result.translation) || (data && data.translation);
  if (!t) throw new Error("Kein Übersetzungstext in der Antwort");
  return String(t).replace(/\s+/g, " ").trim();
}

// Faengt Render-Fehler ab, statt die ganze Seite bei fremden Nutzern weiss
// werden zu lassen. Zeigt einen Neu-laden-Hinweis statt eines Absturzes.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error, info) {
    // Bewusst kein console.error im Produktivbetrieb-Rauschen, aber fuer
    // Debugging beim Entwickeln hilfreich:
    if (typeof window !== "undefined" && window.location.hostname === "localhost") {
      // eslint-disable-next-line no-console
      console.error(error, info);
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 14,
            padding: 24,
            textAlign: "center",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
            background: "#0f1b14",
            color: "#eaf3ec",
          }}
        >
          <div style={{ fontSize: 17, fontWeight: 700 }}>Etwas ist schiefgelaufen.</div>
          <div style={{ fontSize: 14, opacity: 0.75, maxWidth: 320 }}>
            Bitte die Seite neu laden. Dein gespeicherter Fortschritt (Checkliste, Statistik) bleibt erhalten.
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 20px",
              borderRadius: 10,
              border: "none",
              background: "#d9b25f",
              color: "#1a1a1a",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Seite neu laden
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <ArabTrainerApp />
    </ErrorBoundary>
  );
}

function ArabTrainerApp() {
  const [screen, setScreen] = useState("start"); // start | play | result

  // Modul-/Modus-Auswahl
  const [moduleId, setModuleId] = useState("letters");
  const [mode, setMode] = useState("form2letter"); // nur Auswahl-Module
  const [packId, setPackId] = useState(null); // nur Lese-Module

  // Auto-Modus (nur Auswahl-Module): Frage wird gezeigt, nach X Sekunden
  // deckt die App die richtige Antwort selbst auf und geht weiter. Passives
  // Anschauen, KEINE Statistik. Gilt fuer beide Varianten (Form→Buchstabe
  // und Laut→Form) sowie sinngemaess fuer die Kurzvokale.
  const [autoMode, setAutoMode] = useState(false);
  const [autoRevealSec, setAutoRevealSec] = useState(3); // 1..8
  const [autoPauseSec, setAutoPauseSec] = useState(1); // 0.5..3

  // Leseverfolgung (nur Lese-Module): Ayat laufen in Reihenfolge automatisch
  // durch, der aktuelle Vers wird hervorgehoben, danach schaltet es weiter.
  const [followMode, setFollowMode] = useState(false);
  const [followPaused, setFollowPaused] = useState(false);
  // Beim allerersten Vers eines Durchgangs (Isti'adha/Basmala-Karte) startet
  // der Rezitator in der Leseverfolgung nicht von selbst, sondern erst wenn
  // auf die Karte oder den Lautsprecher getippt wird.
  const [awaitingTapToStart, setAwaitingTapToStart] = useState(false);

  const curMod = getModule(moduleId);
  const isReading = curMod.kind === "reading";
  const isChoice = curMod.kind === "choice";
  const isPronun = curMod.kind === "pronunciation";
  const isGuide = curMod.kind === "guide";
  // curMode nur bei Auswahl-Modulen (nur die haben `modes`).
  const curMode = isChoice ? curMod.modes.find((m) => m.id === mode) : null;
  // "ayat" hat echte Rezitation -> eigener Rezitator-Picker statt TTS-Stimmenliste.
  const needsReciter = isReading && curMod.id === "ayat";
  const needsVoice = (curMode && curMode.audio) || (isReading && curMod.id === "words");

  // Auswahl-Modul-Zustand
  const [q, setQ] = useState(null);
  const [locked, setLocked] = useState(false);
  const [chosen, setChosen] = useState(null);

  // Lese-Modul-Zustand
  const [rQueue, setRQueue] = useState([]);
  const [rIdx, setRIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  // Statistik
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [answered, setAnswered] = useState(0);

  const [startTs, setStartTs] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [finalMs, setFinalMs] = useState(0);

  // Gespeicherte Statistik (localStorage), je Modus/Paket
  const [statsMap, setStatsMap] = useState(() => loadAllStats());
  const hasPacks = !!curMod.packs;
  const statKey = hasPacks ? `${moduleId}:${packId}` : `${moduleId}:${mode}`;
  const curStat = statsMap[statKey] || null;
  const statLabel = hasPacks
    ? (curMod.packs.find((p) => p.id === packId) || {}).label || curMod.title
    : (curMode && curMode.label) || curMod.title;
  // Aussprache-Check und Lesehilfen haben keine gespeicherte Statistik; Auto-Modus ebenfalls nicht.
  const showStats = !isPronun && !isGuide && !(autoMode && isChoice);

  // Lesen-Checkliste (Selbst-Abhaken)
  const [checklistDone, setChecklistDone] = useState(() => loadChecklist());
  function toggleCheck(id) {
    setChecklistDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      if (!next[id]) delete next[id];
      saveChecklist(next);
      return next;
    });
  }
  function resetChecklist() {
    setChecklistDone(() => {
      saveChecklist({});
      return {};
    });
  }

  // ---- Stimmen (Text-to-Speech, nur noch fuer Buchstaben/Harakat/Woerter) ----
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(null);
  const synthRef = useRef(typeof window !== "undefined" ? window.speechSynthesis : null);

  // ---- Echte Rezitation (Verse & Suren) ----
  const [reciterId, setReciterId] = useState(RECITERS[0].id);
  const reciterFolder = (RECITERS.find((r) => r.id === reciterId) || RECITERS[0]).folder;
  // Lazy statt als useRef-Argument: sonst wuerde bei JEDEM Render ein neues
  // Audio()-Objekt erzeugt (und sofort verworfen) — spuerbar waehrend des
  // 250ms-Timers im Uebungsbildschirm.
  const audioElRef = useRef(null);
  if (audioElRef.current === null && typeof window !== "undefined") {
    audioElRef.current = new Audio();
  }
  // Wiedergabetempo der Rezitation (1 = Originaltempo). Tonhoehe bleibt via
  // preservesPitch erhalten, damit Langsamer-Stellen nicht brummt.
  const [rate, setRate] = useState(1);

  // Ob gerade wirklich etwas hoerbar ist (Datei ODER TTS-Fallback) — damit
  // die Isti'adha/Basmala-Box verschwinden kann, sobald die Stimme einsetzt.
  const [audioPlaying, setAudioPlaying] = useState(false);
  useEffect(() => {
    const audio = audioElRef.current;
    if (!audio) return;
    const onPlay = () => setAudioPlaying(true);
    const onStop = () => setAudioPlaying(false);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onStop);
    audio.addEventListener("ended", onStop);
    return () => {
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onStop);
      audio.removeEventListener("ended", onStop);
    };
  }, []);

  // Timer fuer den Auto-Modus (Aufdecken + Pause bis zur naechsten Frage)
  const autoRevealTimerRef = useRef(null);
  const autoPauseTimerRef = useRef(null);
  function clearAutoTimers() {
    if (autoRevealTimerRef.current) clearTimeout(autoRevealTimerRef.current);
    if (autoPauseTimerRef.current) clearTimeout(autoPauseTimerRef.current);
    autoRevealTimerRef.current = null;
    autoPauseTimerRef.current = null;
  }

  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const load = () => {
      const all = synth.getVoices();
      const arabic = all.filter((v) => /ar(\b|[-_])/i.test(v.lang));
      // Beste vermutete Stimme zuerst (Enhanced/Premium/Neural + maennliche Namenshinweise)
      const ranked = [...arabic].sort((a, b) => voiceScore(b) - voiceScore(a));
      setVoices(ranked);
      if (ranked.length && !voiceURI) {
        setVoiceURI(ranked[0].voiceURI);
      }
    };
    load();
    synth.onvoiceschanged = load;
    return () => {
      if (synth) synth.onvoiceschanged = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedVoice = useMemo(
    () => voices.find((v) => v.voiceURI === voiceURI) || null,
    [voices, voiceURI]
  );

  function speak(text) {
    const synth = synthRef.current;
    if (!synth || !text) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    if (selectedVoice) u.voice = selectedVoice;
    u.lang = selectedVoice ? selectedVoice.lang : "ar-SA";
    u.rate = 0.85;
    u.onstart = () => setAudioPlaying(true);
    u.onend = () => setAudioPlaying(false);
    u.onerror = () => setAudioPlaying(false);
    synth.speak(u);
  }

  // Spielt eine bestimmte Stimme sofort probehalber ab (unabhaengig vom
  // aktuellen State), damit man beim Antippen in der Liste direkt vergleicht.
  function previewVoice(v) {
    const synth = synthRef.current;
    if (!synth) return;
    synth.cancel();
    const u = new SpeechSynthesisUtterance("بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ");
    u.voice = v;
    u.lang = v.lang || "ar-SA";
    u.rate = 0.85;
    synth.speak(u);
  }

  function stopAudio() {
    if (audioElRef.current) audioElRef.current.pause();
  }

  // Kern der Audio-Strategie: erst statische Datei (src), bei jedem Fehler
  // (nicht vorhanden, Netzwerk, Format) faellt es auf Browser-TTS zurueck.
  function playFileOrTTS(src, fallbackText) {
    const audio = audioElRef.current;
    if (src && audio) {
      audio.pause();
      audio.onerror = () => speak(fallbackText);
      audio.src = src;
      // Tempo/Tonhoehe ERST nach dem src-Wechsel setzen — ein Ladevorgang
      // setzt playbackRate sonst wieder auf 1 zurueck. Zur Sicherheit erneut,
      // sobald die Metadaten geladen sind.
      const applyRate = () => {
        audio.preservesPitch = true;
        audio.webkitPreservesPitch = true;
        audio.defaultPlaybackRate = rate;
        audio.playbackRate = rate;
      };
      applyRate();
      audio.addEventListener("loadedmetadata", applyRate, { once: true });
      const p = audio.play();
      if (p && p.catch) p.catch(() => speak(fallbackText));
    } else {
      speak(fallbackText);
    }
  }

  // Fuer Auswahl-Module (Buchstaben/Harakat): nutzt die statische Datei der
  // Frage, sonst TTS. q.audioSrc ist null, solange die Dateien nicht aktiv sind.
  function playPrompt(qq) {
    playFileOrTTS(qq.audioSrc, qq.speakText);
  }

  // Fuer Lese-Module. Reihenfolge:
  //   1) Vers -> echte Rezitation (everyayah)
  //   2) Wort -> statische Datei (falls WORD_AUDIO_ENABLED)
  //   3) TTS-Fallback
  function playReadingAudio(item) {
    if (item && item.surah && item.ayah) {
      playFileOrTTS(ayahAudioUrl(reciterFolder, item.surah, item.ayah), item.ar);
      return;
    }
    if (WORD_AUDIO_ENABLED) {
      playFileOrTTS(wordAudioSrc(item), item.ar);
      return;
    }
    speak(item.ar);
  }

  // Beispielhoerprobe fuer den gewaehlten Rezitator (Sure 1, Ayah 1 —
  // existiert bei jedem Rezitator zuverlaessig).
  function testReciter() {
    const audio = audioElRef.current;
    if (!audio) return;
    audio.pause();
    audio.onerror = () => {};
    audio.src = ayahAudioUrl(reciterFolder, 1, 1);
    const applyRate = () => {
      audio.preservesPitch = true;
      audio.webkitPreservesPitch = true;
      audio.defaultPlaybackRate = rate;
      audio.playbackRate = rate;
    };
    applyRate();
    audio.addEventListener("loadedmetadata", applyRate, { once: true });
    audio.play().catch(() => {});
  }

  // ---- Timer (versteckt, laeuft ab Start) ----
  useEffect(() => {
    if (screen !== "play" || startTs == null) return;
    const id = setInterval(() => setElapsed(Date.now() - startTs), 250);
    return () => clearInterval(id);
  }, [screen, startTs]);

  // ---- Auto-Modus: nach X Sekunden richtige Antwort selbst aufdecken ----
  // Bei Laut-Fragen startet die Zeit erst, nachdem der Ton kurz laufen konnte.
  useEffect(() => {
    if (screen !== "play" || isReading || !autoMode || !q || locked) return;
    const lead = q.audio ? 1000 : 0;
    autoRevealTimerRef.current = setTimeout(() => {
      setLocked(true);
      setChosen(null); // nur die richtige Antwort markieren, kein Falsch-Feedback
    }, lead + autoRevealSec * 1000);
    return () => {
      if (autoRevealTimerRef.current) clearTimeout(autoRevealTimerRef.current);
    };
  }, [screen, isReading, autoMode, q, locked, autoRevealSec]);

  // ---- Auto-Modus: nach dem Aufdecken kurze Pause, dann naechste Frage ----
  useEffect(() => {
    if (screen !== "play" || isReading || !autoMode || !q || !locked) return;
    autoPauseTimerRef.current = setTimeout(() => {
      nextQuestion();
    }, autoPauseSec * 1000);
    return () => {
      if (autoPauseTimerRef.current) clearTimeout(autoPauseTimerRef.current);
    };
    // nextQuestion bewusst nicht in den Deps (wird je Render neu erzeugt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, isReading, autoMode, q, locked, autoPauseSec]);

  // ---- Leseverfolgung: aktuellen Vers abspielen, danach zum naechsten ----
  // Ayah-Ebene: eine Datei je Vers -> das 'ended'-Ereignis ist das saubere
  // Signal zum Weiterschalten. Als Sicherheitsnetz (Offline/TTS-Fallback, wo
  // kein 'ended' kommt) ein an der Vers-Dauer orientierter Timer.
  useEffect(() => {
    if (screen !== "play" || !isReading || !followMode) return;
    if (followPaused) {
      stopAudio();
      return;
    }
    // Erster Vers (Isti'adha/Basmala-Karte): noch nicht von selbst starten,
    // sondern warten, bis auf Karte oder Lautsprecher getippt wurde.
    if (rIdx === 0 && awaitingTapToStart) {
      stopAudio();
      return;
    }
    const audio = audioElRef.current;
    const item = rQueue[rIdx];
    if (!audio || !item) return;

    let done = false;
    let safety = null;

    const advance = () => {
      if (done) return;
      done = true;
      const next = rIdx + 1;
      if (next >= rQueue.length) {
        stopAudio();
        setScreen("start"); // Durchlauf zu Ende -> zurueck zur Auswahl
      } else {
        setRIdx(next);
      }
    };

    const onEnded = () => advance();
    const onMeta = () => {
      if (safety) clearTimeout(safety);
      const ms = (audio.duration / (rate || 1)) * 1000 + 2500;
      safety = setTimeout(advance, isFinite(ms) && ms > 0 ? ms : 30000);
    };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("loadedmetadata", onMeta);
    safety = setTimeout(advance, 30000); // grober Deckel bis Metadaten da sind

    playReadingAudio(item);

    return () => {
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("loadedmetadata", onMeta);
      if (safety) clearTimeout(safety);
    };
    // playReadingAudio je Render neu erzeugt -> bewusst nicht in den Deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, isReading, followMode, followPaused, rIdx, rQueue, awaitingTapToStart]);

  // Tempo-Aenderung sofort auf ein evtl. laufendes Audio anwenden.
  useEffect(() => {
    const a = audioElRef.current;
    if (a) {
      a.preservesPitch = true;
      a.webkitPreservesPitch = true;
      a.defaultPlaybackRate = rate;
      a.playbackRate = rate;
    }
  }, [rate]);

  function selectModule(id) {
    const m = getModule(id);
    setModuleId(id);
    if (m.kind === "choice") setMode(m.modes[0].id);
    else setPackId(m.packs[0].id);
  }

  function resetStats() {
    setCorrect(0);
    setWrong(0);
    setStreak(0);
    setBestStreak(0);
    setAnswered(0);
  }

  function startGame() {
    resetStats();
    stopAudio();
    clearAutoTimers();
    const ts = Date.now();
    setStartTs(ts);
    setElapsed(0);

    if (isReading) {
      const pack = curMod.packs.find((p) => p.id === packId) || curMod.packs[0];
      // Verse immer in Reihenfolge (1,2,3,…) — beim Lesen einer Sure sinnvoll,
      // und Voraussetzung fuer die Leseverfolgung.
      setRQueue(pack.items.slice());
      setRIdx(0);
      setRevealed(false);
      setFollowPaused(false);
      setAwaitingTapToStart(true);
      setScreen("play");
    } else if (isPronun) {
      // Aussprache-Check verwaltet Index/Aufloesen im eigenen Screen.
      setScreen("play");
    } else if (isGuide) {
      // Lesehilfen verwalten Lern-/Quiz-Phase im eigenen Screen.
      setScreen("play");
    } else {
      setChosen(null);
      setLocked(false);
      const first = curMod.make(mode);
      setQ(first);
      setScreen("play");
      if (first.audio) setTimeout(() => playPrompt(first), 350);
    }
  }

  // ---- Auswahl-Modul ----
  function nextQuestion() {
    const nq = curMod.make(mode);
    setQ(nq);
    setChosen(null);
    setLocked(false);
    if (nq.audio) setTimeout(() => playPrompt(nq), 250);
  }

  function choose(opt, idx) {
    if (locked) return;
    // Auto-Modus: darf man antippen, aber es wird nichts gezaehlt.
    if (autoMode && !isReading) {
      if (autoRevealTimerRef.current) clearTimeout(autoRevealTimerRef.current);
      setLocked(true);
      setChosen(idx);
      return; // Pause-Effekt schaltet zur naechsten Frage weiter
    }
    setLocked(true);
    setChosen(idx);
    setAnswered((n) => n + 1);
    if (opt.correct) {
      setCorrect((c) => c + 1);
      setStreak((s) => {
        const ns = s + 1;
        setBestStreak((b) => Math.max(b, ns));
        return ns;
      });
    } else {
      setWrong((w) => w + 1);
      setStreak(0);
    }
    setTimeout(nextQuestion, 750);
  }

  // ---- Lese-Modul ----
  function readingRate(ok) {
    stopAudio();
    const item = rQueue[rIdx];
    setAnswered((n) => n + 1);
    if (ok) {
      setCorrect((c) => c + 1);
      setStreak((s) => {
        const ns = s + 1;
        setBestStreak((b) => Math.max(b, ns));
        return ns;
      });
    } else {
      setWrong((w) => w + 1);
      setStreak(0);
    }
    // Verpasste Karten ans Ende haengen, damit sie wiederkommen.
    const newQueue = ok ? rQueue : [...rQueue, item];
    const nextIdx = rIdx + 1;
    setRQueue(newQueue);
    setRevealed(false);
    if (nextIdx >= newQueue.length) {
      finish();
    } else {
      setRIdx(nextIdx);
    }
  }

  function finish() {
    clearAutoTimers();
    if (synthRef.current) synthRef.current.cancel();
    stopAudio();
    // Auto-Modus: nichts gezaehlt -> kein Ergebnis-Screen, zurueck zum Start.
    if (autoMode && !isReading) {
      setScreen("start");
      return;
    }
    // Leseverfolgung: reines Zuhoeren, keine Wertung -> zurueck zur Auswahl.
    if (followMode && isReading) {
      setScreen("start");
      return;
    }
    setFinalMs(startTs ? Date.now() - startTs : 0);
    // Statistik nur zusammenfuehren, wenn wirklich etwas beantwortet wurde
    if (answered > 0) {
      setStatsMap((prev) => {
        const old = prev[statKey] || { runs: 0, answered: 0, correct: 0, bestStreak: 0 };
        const merged = {
          ...prev,
          [statKey]: {
            runs: old.runs + 1,
            answered: old.answered + answered,
            correct: old.correct + correct,
            bestStreak: Math.max(old.bestStreak, bestStreak),
            lastTs: Date.now(),
          },
        };
        saveAllStats(merged);
        return merged;
      });
    }
    setScreen("result");
  }

  // Loescht die gespeicherte Statistik des aktuell gewaehlten Modus/Pakets.
  function resetCurrentStats() {
    setStatsMap((prev) => {
      const merged = { ...prev };
      delete merged[statKey];
      saveAllStats(merged);
      return merged;
    });
  }

  const accuracy = answered > 0 ? Math.round((correct / answered) * 100) : 0;

  // =====================================================
  //  Styles
  // =====================================================
  const C = {
    bg: "#0f1b14",
    panel: "#16261c",
    panel2: "#1d3226",
    line: "#2c4735",
    ink: "#eaf3ec",
    sub: "#9db8a6",
    gold: "#d9b25f",
    green: "#3fae6b",
    greenD: "#2e8c53",
    red: "#c9584f",
  };

  const fontStack =
    "'Amiri', 'Amiri Quran', 'Scheherazade New', 'Noto Naskh Arabic', serif";

  const rItem = isReading ? rQueue[rIdx] : null;
  const curPack = hasPacks
    ? curMod.packs.find((p) => p.id === packId) || curMod.packs[0]
    : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(120% 90% at 50% -10%, #17301f 0%, ${C.bg} 60%)`,
        color: C.ink,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        padding: "20px 16px 48px",
        boxSizing: "border-box",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Scheherazade+New:wght@400;700&family=Noto+Naskh+Arabic:wght@400;700&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
        @keyframes pop { 0%{transform:scale(.96);opacity:0} 100%{transform:scale(1);opacity:1} }
        @keyframes flashBox { 0%{background:rgba(217,178,95,.35)} 100%{background:transparent} }
        .opt:focus-visible { outline: 3px solid ${C.gold}; outline-offset: 2px; }
        button:focus-visible { outline: 3px solid ${C.gold}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce){ *{animation:none!important;transition:none!important} }
      `}</style>

      <div style={{ maxWidth: 620, margin: "0 auto" }}>
        {/* Kopf */}
        <header style={{ textAlign: "center", marginBottom: 18 }}>
          <div
            style={{
              fontFamily: fontStack,
              fontSize: 40,
              lineHeight: 1,
              color: C.gold,
              marginBottom: 6,
            }}
          >
            أ ب ت
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>
            Schrift-Trainer
          </h1>
          <p style={{ margin: "4px 0 0", color: C.sub, fontSize: 14 }}>
            {curMod.title} — {curMod.subtitle}
          </p>
        </header>

        {screen === "start" && (
          <StartScreen
            C={C}
            moduleId={moduleId}
            onSelectModule={selectModule}
            curMod={curMod}
            isReading={isReading}
            mode={mode}
            setMode={setMode}
            packId={packId}
            setPackId={setPackId}
            needsVoice={needsVoice}
            voices={voices}
            voiceURI={voiceURI}
            setVoiceURI={setVoiceURI}
            onPreviewVoice={previewVoice}
            needsReciter={needsReciter}
            reciterId={reciterId}
            setReciterId={setReciterId}
            onTestReciter={testReciter}
            rate={rate}
            setRate={setRate}
            followMode={followMode}
            setFollowMode={setFollowMode}
            onStart={startGame}
            curStat={curStat}
            statLabel={statLabel}
            onResetStats={resetCurrentStats}
            autoMode={autoMode}
            setAutoMode={setAutoMode}
            autoRevealSec={autoRevealSec}
            setAutoRevealSec={setAutoRevealSec}
            autoPauseSec={autoPauseSec}
            setAutoPauseSec={setAutoPauseSec}
            showStats={showStats}
          />
        )}

        {screen === "play" && isChoice && q && (
          <PlayScreen
            C={C}
            fontStack={fontStack}
            q={q}
            chosen={chosen}
            locked={locked}
            onChoose={choose}
            onFinish={finish}
            onReplay={() => playPrompt(q)}
            correct={correct}
            wrong={wrong}
            streak={streak}
            autoMode={autoMode}
            autoRevealSec={autoRevealSec}
            setAutoRevealSec={setAutoRevealSec}
          />
        )}

        {screen === "play" && isPronun && curPack && (
          <PronunciationScreen
            key={curPack.id}
            C={C}
            fontStack={fontStack}
            items={curPack.items}
            rule={curPack.rule}
            packLabel={curPack.label}
            onExit={() => setScreen("start")}
          />
        )}

        {screen === "play" && isGuide && curPack && (
          <GuideScreen
            key={curPack.id}
            C={C}
            fontStack={fontStack}
            pack={curPack}
            onExit={() => setScreen("start")}
          />
        )}

        {screen === "play" && isReading && rItem && (
          <ReadingScreen
            C={C}
            fontStack={fontStack}
            item={rItem}
            note={curPack ? curPack.note : null}
            pos={rIdx + 1}
            total={rQueue.length}
            revealed={revealed}
            onReveal={() => setRevealed(true)}
            onRate={readingRate}
            onSpeak={() => {
              if (followMode && rIdx === 0 && awaitingTapToStart) {
                setAwaitingTapToStart(false);
              } else {
                playReadingAudio(rItem);
              }
            }}
            onFinish={finish}
            correct={correct}
            wrong={wrong}
            streak={streak}
            follow={followMode}
            paused={followPaused}
            onTogglePause={() => setFollowPaused((v) => !v)}
            awaitingStart={followMode && rIdx === 0 && awaitingTapToStart}
            onStartTap={() => setAwaitingTapToStart(false)}
            playing={audioPlaying}
          />
        )}

        {screen === "result" && (
          <ResultScreen
            C={C}
            fontStack={fontStack}
            finalMs={finalMs}
            correct={correct}
            wrong={wrong}
            answered={answered}
            accuracy={accuracy}
            bestStreak={bestStreak}
            curStat={curStat}
            statLabel={statLabel}
            onRestart={() => setScreen("start")}
            onAgain={startGame}
          />
        )}

        {screen === "start" && (
          <ChecklistSection C={C} done={checklistDone} onToggle={toggleCheck} onReset={resetChecklist} />
        )}
      </div>
    </div>
  );
}

// =====================================================
//  Startbildschirm
// =====================================================
// Kleiner +/- Zahlenwaehler, im Stil der App.
function Stepper({ C, label, value, unit, min, max, step, onChange, compact }) {
  const btn = {
    width: compact ? 34 : 40,
    height: compact ? 34 : 40,
    borderRadius: 10,
    border: `1px solid ${C.line}`,
    background: C.panel2,
    color: C.ink,
    fontSize: 20,
    fontWeight: 700,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    lineHeight: 1,
  };
  const dec = () => onChange(Math.max(min, Math.round((value - step) * 10) / 10));
  const inc = () => onChange(Math.min(max, Math.round((value + step) * 10) / 10));
  const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(".", ","));
  return (
    <div style={{ flex: 1, minWidth: 150 }}>
      {label && (
        <div style={{ fontSize: 12, color: C.sub, marginBottom: 6 }}>{label}</div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={dec} disabled={value <= min} style={{ ...btn, opacity: value <= min ? 0.4 : 1 }} aria-label="weniger">
          −
        </button>
        <div
          style={{
            minWidth: 56,
            textAlign: "center",
            fontSize: 17,
            fontWeight: 700,
            color: C.gold,
          }}
        >
          {fmt(value)} {unit}
        </div>
        <button onClick={inc} disabled={value >= max} style={{ ...btn, opacity: value >= max ? 0.4 : 1 }} aria-label="mehr">
          +
        </button>
      </div>
    </div>
  );
}

function StartScreen({
  C, moduleId, onSelectModule, curMod, isReading,
  mode, setMode, packId, setPackId,
  needsVoice, voices, voiceURI, setVoiceURI, onPreviewVoice,
  needsReciter, reciterId, setReciterId, onTestReciter, rate, setRate,
  followMode, setFollowMode,
  onStart, curStat, statLabel, onResetStats,
  autoMode, setAutoMode, autoRevealSec, setAutoRevealSec, autoPauseSec, setAutoPauseSec,
  showStats,
}) {
  const isChoice = curMod.kind === "choice";
  const hasPacks = !!curMod.packs;
  const card = {
    background: C.panel,
    border: `1px solid ${C.line}`,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  };
  const pickBtn = (active) => ({
    flex: 1,
    minWidth: 150,
    padding: "14px 12px",
    borderRadius: 12,
    border: `1px solid ${active ? C.green : C.line}`,
    background: active ? "rgba(63,174,107,0.14)" : C.panel2,
    color: C.ink,
    cursor: "pointer",
    textAlign: "left",
    transition: "all .15s",
  });

  return (
    <div>
      {/* Hinweis: Was die App leistet — und was nicht (Tajwīd) */}
      <div
        style={{
          background: "rgba(217,178,95,0.10)",
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          padding: "12px 14px",
          marginBottom: 16,
          fontSize: 12.5,
          color: C.sub,
          lineHeight: 1.55,
        }}
      >
        <span style={{ color: C.gold, fontWeight: 700 }}>Worum es hier geht: </span>
        Diese App bringt dir das <b style={{ color: C.ink }}>Lesen</b> bei — Buchstaben und
        Vokalzeichen erkennen und Wörter und Verse richtig entziffern. Sie bringt dir noch{" "}
        <b style={{ color: C.ink }}>nicht</b> die feinen Regeln der Koran-Rezitation bei (das
        „Tajwīd“: wie man beim Vortragen bestimmte Laute zieht, betont oder verschmelzen lässt).
        Das ist ein eigener Schritt für später. Deshalb steht hier z. B. „Madd Aslī“ – nur die
        einfache Vokaldehnung, nicht schon alle Dehnungsarten.
      </div>

      {/* Modul waehlen */}
      <div style={card}>
        <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
          MODUL WÄHLEN
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {MODULE_ORDER.map((id) => {
            const m = getModule(id);
            return (
              <button key={id} style={pickBtn(moduleId === id)} onClick={() => onSelectModule(id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{m.title}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{m.subtitle}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Auswahl-Module: Modus */}
      {isChoice && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            MODUS WÄHLEN
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {curMod.modes.map((md) => (
              <button key={md.id} style={pickBtn(mode === md.id)} onClick={() => setMode(md.id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{md.label}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{md.sub}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Auswahl-Module: Auto-Modus */}
      {isChoice && (
        <div style={card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: autoMode ? 14 : 0,
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>AUTO-MODUS</div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
                Nur zuschauen: die richtige Antwort erscheint nach kurzer Zeit von selbst.
                Keine Statistik.
              </div>
            </div>
            <button
              onClick={() => setAutoMode((v) => !v)}
              aria-label="Auto-Modus umschalten"
              style={{
                flexShrink: 0,
                marginLeft: 12,
                width: 54,
                height: 30,
                borderRadius: 999,
                border: `1px solid ${autoMode ? C.green : C.line}`,
                background: autoMode ? "rgba(63,174,107,0.25)" : C.panel2,
                position: "relative",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: autoMode ? 27 : 3,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: autoMode ? C.green : C.sub,
                  transition: "left .15s",
                }}
              />
            </button>
          </div>

          {autoMode && (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Stepper
                C={C}
                label="Aufdecken nach"
                value={autoRevealSec}
                unit="s"
                min={1}
                max={8}
                step={1}
                onChange={setAutoRevealSec}
              />
              <Stepper
                C={C}
                label="Pause danach"
                value={autoPauseSec}
                unit="s"
                min={0.5}
                max={3}
                step={0.5}
                onChange={setAutoPauseSec}
              />
            </div>
          )}
        </div>
      )}

      {/* Lese-Module: Paket */}
      {hasPacks && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            {curMod.kind === "pronunciation" ? "KATEGORIE WÄHLEN" : curMod.kind === "guide" ? "THEMA WÄHLEN" : "INHALT WÄHLEN"}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {curMod.packs.map((p) => (
              <button key={p.id} style={pickBtn(packId === p.id)} onClick={() => setPackId(p.id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.label}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
                  {curMod.kind === "guide"
                    ? `${(p.data || []).length} Karten · lernen + Quiz`
                    : `${p.items.length} ${curMod.kind === "pronunciation" ? "Wörter" : "Karten"}`}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Rezitator (fuer Vers-Pakete: echte Rezitation statt TTS) */}
      {needsReciter && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            REZITATOR WÄHLEN
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
            {RECITERS.map((r) => (
              <button key={r.id} style={pickBtn(reciterId === r.id)} onClick={() => setReciterId(r.id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{r.label}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{r.note}</div>
              </button>
            ))}
          </div>

          <div style={{ fontSize: 13, color: C.sub, marginBottom: 8, fontWeight: 600 }}>
            TEMPO
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {[0.5, 0.75, 1, 1.25].map((r) => (
              <button
                key={r}
                onClick={() => setRate(r)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 10,
                  border: `1.5px solid ${rate === r ? C.gold : C.line}`,
                  background: rate === r ? "rgba(217,178,95,.15)" : C.panel2,
                  color: rate === r ? C.gold : C.ink,
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: 700,
                }}
              >
                {r === 1 ? "1×" : `${r}×`}
              </button>
            ))}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              padding: "10px 0 12px",
              borderTop: `1px solid ${C.line}`,
              marginBottom: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>LESEVERFOLGUNG</div>
              <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.4 }}>
                Die Ayat laufen der Reihe nach automatisch durch, der aktuelle Vers
                wird hervorgehoben. Zuhören statt abfragen — keine Statistik.
              </div>
            </div>
            <button
              onClick={() => setFollowMode((v) => !v)}
              aria-label="Leseverfolgung umschalten"
              style={{
                flexShrink: 0,
                width: 54,
                height: 30,
                borderRadius: 999,
                border: `1px solid ${followMode ? C.green : C.line}`,
                background: followMode ? "rgba(63,174,107,0.25)" : C.panel2,
                position: "relative",
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 3,
                  left: followMode ? 27 : 3,
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: followMode ? C.green : C.sub,
                  transition: "all .15s",
                }}
              />
            </button>
          </div>

          <button
            onClick={onTestReciter}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: `1px solid ${C.line}`,
              background: C.panel2,
              color: C.gold,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ▶ Beispiel hören
          </button>
          <p style={{ margin: "10px 0 0", fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
            Echte Qari-Rezitation, keine synthetische Stimme — die beste verfügbare
            Audioqualität für die Verse.
          </p>
        </div>
      )}

      {/* Stimme (TTS) — nur fuer Buchstaben, Harakat und einzelne Woerter,
          da es dafuer keine echte Rezitation gibt. */}
      {needsVoice && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            STIMME {isReading ? "(optional, zum Anhören)" : ""}
          </div>
          {voices.length === 0 ? (
            isReading ? (
              <p style={{ margin: 0, fontSize: 13.5, color: C.sub, lineHeight: 1.5 }}>
                Keine arabische Stimme gefunden. Lesen geht trotzdem — du liest selbst und
                bewertest dich. Zum Anhören ggf. eine arabische Stimme im System laden.
              </p>
            ) : (
              <p style={{ margin: 0, fontSize: 13.5, color: C.sub, lineHeight: 1.5 }}>
                Keine arabische Stimme auf diesem Gerät gefunden. Unter iOS:
                Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen →
                Arabisch → „Maged" laden (am besten die „Enhanced"-Variante, falls
                verfügbar — deutlich besser als die Standardstimme).
              </p>
            )
          ) : (
            <>
              <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
                {voices.map((v) => {
                  const active = voiceURI === v.voiceURI;
                  const badges = voiceBadges(v);
                  return (
                    <button
                      key={v.voiceURI}
                      onClick={() => {
                        setVoiceURI(v.voiceURI);
                        onPreviewVoice(v);
                      }}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        padding: "10px 12px",
                        borderRadius: 10,
                        border: `1px solid ${active ? C.green : C.line}`,
                        background: active ? "rgba(63,174,107,0.14)" : C.panel2,
                        color: C.ink,
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span>
                        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{v.name}</div>
                        <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>
                          {v.lang}
                          {badges.length ? " · " + badges.join(", ") : ""}
                        </div>
                      </span>
                      <span style={{ fontSize: 18, color: C.gold, flexShrink: 0 }}>▶</span>
                    </button>
                  );
                })}
              </div>
              <p style={{ margin: "10px 0 0", fontSize: 12, color: C.sub, lineHeight: 1.5 }}>
                Antippen wählt die Stimme und spielt sie direkt zum Vergleich ab. Die Liste
                ist auf die auf deinem Gerät installierten Stimmen begrenzt — bessere/mehr
                Stimmen installierst du im System (iOS: Einstellungen → Bedienungshilfen →
                Gesprochene Inhalte → Stimmen → Arabisch → „Enhanced"-Variante laden).
              </p>
            </>
          )}
        </div>
      )}

      {/* Gespeicherte Statistik (nicht im Auto-Modus, nicht im Aussprache-Check) */}
      {showStats && (
      <div style={{ ...card, marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: curStat ? 12 : 0,
          }}
        >
          <div style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>
            DEINE STATISTIK · {statLabel}
          </div>
          {curStat && (
            <button
              onClick={onResetStats}
              style={{
                fontSize: 12,
                color: C.sub,
                background: "transparent",
                border: `1px solid ${C.line}`,
                borderRadius: 8,
                padding: "4px 10px",
                cursor: "pointer",
              }}
            >
              zurücksetzen
            </button>
          )}
        </div>
        {curStat ? (
          <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Durchgänge</div>
              <div style={{ fontSize: 20, fontWeight: 700 }}>{curStat.runs}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Trefferquote</div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 700,
                  color: statAccuracyOf(curStat) >= 80 ? C.green : C.ink,
                }}
              >
                {statAccuracyOf(curStat)} %
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Beste Serie</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: C.gold }}>
                {curStat.bestStreak}
              </div>
            </div>
          </div>
        ) : (
          <p style={{ margin: "8px 0 0", fontSize: 13, color: C.sub, lineHeight: 1.5 }}>
            Noch keine Werte. Nach dem ersten Durchgang steht hier deine Bilanz — sie bleibt
            auf diesem Gerät gespeichert.
          </p>
        )}
      </div>
      )}

      <button
        onClick={onStart}
        style={{
          width: "100%",
          padding: "17px",
          borderRadius: 14,
          border: "none",
          background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
          color: "#fff",
          fontSize: 17,
          fontWeight: 700,
          cursor: "pointer",
          boxShadow: "0 6px 20px rgba(46,140,83,.35)",
        }}
      >
        Los geht's
      </button>

      <p style={{ color: C.sub, fontSize: 12.5, textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
        Kein Countdown. Die Zeit läuft ab jetzt im Hintergrund — du hörst auf,
        wann du willst, über „Fertig". Sprich alles laut mit.
      </p>
    </div>
  );
}

// =====================================================
//  Spielbildschirm (Auswahl-Module)
// =====================================================
function PlayScreen({
  C, fontStack, q, chosen, locked, onChoose, onFinish, onReplay,
  correct, wrong, streak,
  autoMode, autoRevealSec, setAutoRevealSec,
}) {
  const stat = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.ink }}>{val}</div>
    </div>
  );

  return (
    <div>
      {autoMode ? (
        /* Auto-Modus: keine Statistik, dafuer Sekunden live einstellbar */
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            padding: "10px 12px",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12.5, color: C.gold, fontWeight: 600 }}>Auto-Modus</div>
          <Stepper
            C={C}
            label={null}
            value={autoRevealSec}
            unit="s"
            min={1}
            max={8}
            step={1}
            onChange={setAutoRevealSec}
            compact
          />
        </div>
      ) : (
        /* Statuszeile — bewusst OHNE sichtbaren Countdown */
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            padding: "12px 8px",
            marginBottom: 16,
          }}
        >
          {stat("Richtig", correct, C.green)}
          {stat("Falsch", wrong, C.red)}
          {stat("Serie", streak, C.gold)}
        </div>
      )}

      {/* Frage-Karte */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 18,
          padding: "22px 18px 24px",
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        {q.badge && (
          <div
            style={{
              display: "inline-block",
              fontSize: 12.5,
              color: C.gold,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              padding: "4px 12px",
              marginBottom: 18,
            }}
          >
            {q.badge}
          </div>
        )}

        {!q.audio ? (
          <>
            <div
              key={q.prompt}
              style={{
                fontFamily: q.promptArabic ? fontStack : "inherit",
                fontSize: 92,
                lineHeight: 1.15,
                direction: q.promptArabic ? "rtl" : "ltr",
                color: C.ink,
                animation: "pop .18s ease",
                minHeight: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {q.prompt}
            </div>
            <div style={{ color: C.sub, fontSize: 15 }}>{q.questionText}</div>
          </>
        ) : (
          <>
            <button
              onClick={onReplay}
              style={{
                fontSize: 44,
                width: 96,
                height: 96,
                borderRadius: "50%",
                border: `1px solid ${C.line}`,
                background: C.panel2,
                color: C.gold,
                cursor: "pointer",
                margin: "6px 0 14px",
              }}
              aria-label="Laut erneut abspielen"
            >
              🔊
            </button>
            <div style={{ color: C.sub, fontSize: 15 }}>{q.questionText}</div>
          </>
        )}
      </div>

      {/* Antwortoptionen */}
      <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
        {q.options.map((opt, idx) => {
          let bg = C.panel2;
          let border = C.line;
          if (locked && chosen === idx) {
            bg = opt.correct ? "rgba(63,174,107,.2)" : "rgba(201,88,79,.2)";
            border = opt.correct ? C.green : C.red;
          }
          if (locked && opt.correct && chosen !== idx) {
            bg = "rgba(63,174,107,.12)";
            border = C.green;
          }
          return (
            <button
              key={idx}
              className="opt"
              onClick={() => onChoose(opt, idx)}
              disabled={locked}
              style={{
                fontFamily: opt.arabic ? fontStack : "inherit",
                fontSize: opt.arabic ? 40 : 26,
                direction: opt.arabic ? "rtl" : "ltr",
                letterSpacing: opt.arabic ? 0 : 0.5,
                padding: "14px 18px",
                borderRadius: 14,
                border: `1.5px solid ${border}`,
                background: bg,
                color: C.ink,
                cursor: locked ? "default" : "pointer",
                transition: "all .12s",
                minHeight: opt.arabic ? 68 : 58,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <button
        onClick={onFinish}
        style={{
          width: "100%",
          padding: "15px",
          borderRadius: 14,
          border: `1px solid ${C.gold}`,
          background: "transparent",
          color: C.gold,
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Fertig
      </button>
    </div>
  );
}

// =====================================================
//  Lesebildschirm (Lese-Module)
// =====================================================
function ReadingScreen({
  C, fontStack, item, note, pos, total, revealed,
  onReveal, onRate, onSpeak, onFinish, correct, wrong, streak,
  follow, paused, onTogglePause, awaitingStart, onStartTap, playing,
}) {
  const stat = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.ink }}>{val}</div>
    </div>
  );

  // Isti'adha/Basmala-Box: verschwindet, sobald die Rezitation fuer diese
  // Karte einmal losgelaufen ist (Datei oder TTS) — bleibt dann auch nach
  // Pause/Ende versteckt, kommt erst bei der naechsten Karte wieder infrage.
  const [voiceStarted, setVoiceStarted] = useState(false);
  useEffect(() => {
    setVoiceStarted(false);
  }, [item.ar]);
  useEffect(() => {
    if (playing) setVoiceStarted(true);
  }, [playing]);

  // Vers = hat surah+ayah -> deutsche Übersetzung live von quranenc laden.
  // Wort ohne surah/ayah -> weiterhin das kurze Glossar (item.de).
  const isAyah = !!(item.surah && item.ayah);
  const [deText, setDeText] = useState(null);
  const [deState, setDeState] = useState("idle"); // idle | loading | ok | error

  useEffect(() => {
    if (!isAyah) {
      setDeText(null);
      setDeState("idle");
      return;
    }
    let cancelled = false;
    const cached = transCacheGet(item.surah, item.ayah);
    if (cached) {
      setDeText(cached);
      setDeState("ok");
      return;
    }
    setDeText(null);
    setDeState("loading");
    fetchAburida(item.surah, item.ayah)
      .then((t) => {
        if (cancelled) return;
        transCacheSet(item.surah, item.ayah, t);
        setDeText(t);
        setDeState("ok");
      })
      .catch(() => {
        if (!cancelled) setDeState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [isAyah, item.surah, item.ayah]);

  const long = item.ar.length > 14;

  return (
    <div>
      {/* Statuszeile (nur im Abfrage-Modus, nicht bei der Leseverfolgung) */}
      {!follow && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 14,
            padding: "12px 8px",
            marginBottom: 16,
          }}
        >
          {stat("Richtig", correct, C.green)}
          {stat("Falsch", wrong, C.red)}
          {stat("Serie", streak, C.gold)}
        </div>
      )}

      {/* Karte */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${follow && !paused ? C.gold : C.line}`,
          boxShadow: follow && !paused ? `0 0 0 2px rgba(217,178,95,.25)` : "none",
          borderRadius: 18,
          padding: "20px 18px 24px",
          textAlign: "center",
          marginBottom: 16,
          transition: "box-shadow .2s, border-color .2s",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
          }}
        >
          <span
            style={{
              fontSize: 12.5,
              color: C.gold,
              border: `1px solid ${C.line}`,
              borderRadius: 999,
              padding: "4px 12px",
            }}
          >
            {pos} / {total}
          </span>
          <button
            onClick={onSpeak}
            style={{
              fontSize: 20,
              width: 44,
              height: 44,
              borderRadius: "50%",
              border: `1px solid ${C.line}`,
              background: C.panel2,
              color: C.gold,
              cursor: "pointer",
            }}
            aria-label="Vorlesen"
          >
            🔊
          </button>
        </div>

        {(pos === 1 || (isAyah && item.ayah === 1)) && !voiceStarted && (
          <div
            onClick={awaitingStart ? onStartTap : undefined}
            role={awaitingStart ? "button" : undefined}
            tabIndex={awaitingStart ? 0 : undefined}
            onKeyDown={
              awaitingStart
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onStartTap();
                    }
                  }
                : undefined
            }
            style={{
              border: `1.5px solid ${C.gold}`,
              borderRadius: 14,
              marginBottom: 14,
              padding: "12px 10px",
              textAlign: "center",
              animation: "flashBox 1.4s ease-out",
              cursor: awaitingStart ? "pointer" : "default",
            }}
          >
            {pos === 1 && (
              <>
                <div style={{ fontFamily: fontStack, direction: "rtl", fontSize: 22, color: C.sub, marginBottom: 2 }}>
                  {OPENING_FORMULA.isti.ar}
                </div>
                <div style={{ fontSize: 11.5, color: C.sub, marginBottom: isAyah && item.ayah === 1 ? 10 : 0 }}>
                  {OPENING_FORMULA.isti.tr}
                </div>
              </>
            )}
            {isAyah && item.ayah === 1 && (
              <>
                <div style={{ fontFamily: fontStack, direction: "rtl", fontSize: 22, color: C.sub, marginBottom: 2 }}>
                  {OPENING_FORMULA.basmala.ar}
                </div>
                <div style={{ fontSize: 11.5, color: C.sub }}>{OPENING_FORMULA.basmala.tr}</div>
              </>
            )}
            {awaitingStart && (
              <div style={{ fontSize: 11.5, color: C.gold, marginTop: 8, fontWeight: 600 }}>
                ▶ Zum Start antippen
              </div>
            )}
          </div>
        )}


        {note && (
          <div style={{ color: C.sub, fontSize: 11.5, marginBottom: 10, lineHeight: 1.4 }}>
            {note}
          </div>
        )}

        <div
          key={item.ar}
          style={{
            fontFamily: fontStack,
            fontSize: long ? 34 : 60,
            lineHeight: long ? 1.9 : 1.3,
            direction: "rtl",
            color: C.ink,
            animation: "pop .18s ease",
            minHeight: 90,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "6px 2px",
          }}
        >
          <span style={{ direction: "rtl" }}>
            {item.ar}
            {isAyah && (
              <span
                title={`Ayah ${item.ayah}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "1.7em",
                  height: "1.7em",
                  padding: "0 0.3em",
                  margin: "0 0.28em",
                  fontSize: "0.42em",
                  fontWeight: 700,
                  lineHeight: 1,
                  border: `1.5px solid ${C.gold}`,
                  borderRadius: 999,
                  color: C.gold,
                  verticalAlign: "middle",
                }}
              >
                {toArabicIndic(item.ayah)}
              </span>
            )}
          </span>
        </div>

        {!(follow || revealed) ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>
            Laut lesen, dann auflösen.
          </div>
        ) : (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: C.gold, fontSize: 19, fontWeight: 700 }}>{item.tr}</div>
            <div style={{ color: C.sub, fontSize: 14.5, marginTop: 4, lineHeight: 1.5 }}>
              {isAyah
                ? deState === "ok"
                  ? deText
                  : deState === "loading"
                  ? "Übersetzung wird geladen…"
                  : "Übersetzung nicht verfügbar (offline?)."
                : item.de}
            </div>
            {isAyah && deState === "ok" && (
              <div style={{ color: C.sub, fontSize: 10.5, marginTop: 6, opacity: 0.65 }}>
                {TRANS_CREDIT}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Aktionen */}
      {follow ? (
        <button
          onClick={onTogglePause}
          style={{
            width: "100%",
            padding: "15px",
            borderRadius: 14,
            border: `1.5px solid ${C.gold}`,
            background: paused ? `linear-gradient(180deg, ${C.green}, ${C.greenD})` : "transparent",
            color: paused ? "#fff" : C.gold,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          {paused ? "▶ Weiter" : "⏸ Pause"}
        </button>
      ) : !revealed ? (
        <button
          onClick={onReveal}
          style={{
            width: "100%",
            padding: "15px",
            borderRadius: 14,
            border: "none",
            background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
            marginBottom: 12,
          }}
        >
          Auflösen
        </button>
      ) : (
        <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
          <button
            onClick={() => onRate(false)}
            style={{
              flex: 1,
              padding: "15px",
              borderRadius: 14,
              border: `1.5px solid ${C.red}`,
              background: "rgba(201,88,79,.14)",
              color: C.ink,
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Nochmal
          </button>
          <button
            onClick={() => onRate(true)}
            style={{
              flex: 1,
              padding: "15px",
              borderRadius: 14,
              border: "none",
              background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Konnte ich
          </button>
        </div>
      )}

      <button
        onClick={onFinish}
        style={{
          width: "100%",
          padding: "15px",
          borderRadius: 14,
          border: `1px solid ${C.gold}`,
          background: "transparent",
          color: C.gold,
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Fertig
      </button>
    </div>
  );
}

// =====================================================
//  Aussprache-Check
//  Wort zeigen -> selbst laut lesen -> Lösung (Umschrift + Regel-Hinweis)
//  -> nächstes Wort. Enter/Leertaste als Tastatur-Shortcut. Keine Statistik.
// =====================================================
function PronunciationScreen({ C, fontStack, items, rule, packLabel, onExit }) {
  // Beim Start einmal mischen, damit man die Reihenfolge nicht auswendig lernt.
  const [deck] = useState(() => shuffle(items));
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const item = deck[idx];
  const isLast = idx >= deck.length - 1;
  const long = item.ar.length > 14;

  function reveal() {
    setRevealed(true);
  }
  function next() {
    if (isLast) {
      onExit();
      return;
    }
    setIdx((i) => i + 1);
    setRevealed(false);
  }
  // Enter als Shortcut: erst auflösen, dann weiter (nützlich mit iPad-Tastatur).
  useEffect(() => {
    function onKey(e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (!revealed) reveal();
      else next();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealed, idx, isLast]);

  const primaryBtn = {
    width: "100%",
    padding: "15px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
    marginBottom: 12,
  };

  return (
    <div>
      {/* Kopfzeile: Kategorie + Fortschritt (keine Statistik) */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 14,
          padding: "12px 14px",
          marginBottom: 16,
        }}
      >
        <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{packLabel}</span>
        <span
          style={{
            fontSize: 12.5,
            color: C.gold,
            border: `1px solid ${C.line}`,
            borderRadius: 999,
            padding: "4px 12px",
          }}
        >
          {idx + 1} / {deck.length}
        </span>
      </div>

      {/* Wort-Karte */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 18,
          padding: "24px 18px 26px",
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        <div
          key={item.ar}
          style={{
            fontFamily: fontStack,
            fontSize: long ? 40 : 72,
            lineHeight: 1.3,
            direction: "rtl",
            color: C.ink,
            animation: "pop .18s ease",
            minHeight: 110,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {item.ar}
        </div>

        {!revealed ? (
          <div style={{ color: C.sub, fontSize: 14, marginTop: 6 }}>
            Lies das Wort laut. Dann Lösung zeigen.
          </div>
        ) : (
          <div style={{ marginTop: 10 }}>
            <div style={{ color: C.gold, fontSize: 22, fontWeight: 700 }}>{item.tr}</div>
            <div
              style={{
                color: C.sub,
                fontSize: 14.5,
                marginTop: 8,
                lineHeight: 1.55,
                maxWidth: 440,
                marginLeft: "auto",
                marginRight: "auto",
              }}
            >
              {item.hint || rule}
            </div>
          </div>
        )}
      </div>

      {!revealed ? (
        <button onClick={reveal} style={primaryBtn}>
          Lösung zeigen
        </button>
      ) : (
        <button onClick={next} style={primaryBtn}>
          {isLast ? "Fertig ✓" : "Nächstes Wort"}
        </button>
      )}

      <button
        onClick={onExit}
        style={{
          width: "100%",
          padding: "15px",
          borderRadius: 14,
          border: `1px solid ${C.gold}`,
          background: "transparent",
          color: C.gold,
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Beenden
      </button>
    </div>
  );
}

// =====================================================
//  Lesehilfen-Simulator: Lern-Phase (Karten) + Quiz-Phase (mit Erklärung)
// =====================================================
function buildGuideQuiz(pack) {
  const data = pack.data;
  if (pack.topic === "lam") {
    return shuffle(
      data.map((it) => ({
        prompt: it.ar,
        question: "Lam Shamsiya oder Qamariya?",
        options: [
          { label: "Lam Shamsiya", correct: it.type === "shamsiya" },
          { label: "Lam Qamariya", correct: it.type === "qamariya" },
        ],
        explain: `${it.read} (${it.de}) — ${LAM_EXPLAIN[it.type]}`,
      }))
    );
  }
  // waqf: richtige Kurzhandlung + 3 andere als Distraktoren
  return shuffle(
    data.map((it) => {
      const others = shuffle(data.filter((x) => x.sign !== it.sign)).slice(0, 3);
      const options = shuffle([
        { label: it.short, correct: true },
        ...others.map((o) => ({ label: o.short, correct: false })),
      ]);
      return {
        prompt: it.sign,
        question: "Was bedeutet dieses Zeichen?",
        options,
        explain: `${it.name}: ${it.long}`,
      };
    })
  );
}

function GuideScreen({ C, fontStack, pack, onExit }) {
  const isLam = pack.topic === "lam";
  const data = pack.data;

  const [phase, setPhase] = useState("learn"); // learn | quiz | result
  const [learnIdx, setLearnIdx] = useState(0);
  const [quiz, setQuiz] = useState(() => buildGuideQuiz(pack));
  const [qIdx, setQIdx] = useState(0);
  const [chosen, setChosen] = useState(null);
  const [correctCount, setCorrectCount] = useState(0);

  const primaryBtn = {
    flex: 1,
    padding: "15px",
    borderRadius: 14,
    border: "none",
    background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
    color: "#fff",
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  };
  const ghostBtn = {
    flex: 1,
    padding: "15px",
    borderRadius: 14,
    border: `1px solid ${C.line}`,
    background: C.panel2,
    color: C.ink,
    fontSize: 16,
    fontWeight: 700,
    cursor: "pointer",
  };
  const exitBtn = {
    width: "100%",
    padding: "14px",
    borderRadius: 14,
    border: `1px solid ${C.gold}`,
    background: "transparent",
    color: C.gold,
    fontSize: 15,
    fontWeight: 700,
    cursor: "pointer",
    marginTop: 12,
  };
  const headBar = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: C.panel,
    border: `1px solid ${C.line}`,
    borderRadius: 14,
    padding: "12px 14px",
    marginBottom: 14,
  };
  const pill = {
    fontSize: 12.5,
    color: C.gold,
    border: `1px solid ${C.line}`,
    borderRadius: 999,
    padding: "4px 12px",
  };
  const bigPrompt = (text) => (
    <div
      key={text}
      style={{
        fontFamily: fontStack,
        fontSize: text.length > 6 ? 44 : 64,
        lineHeight: 1.3,
        direction: "rtl",
        color: C.ink,
        animation: "pop .18s ease",
        minHeight: 96,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {text}
    </div>
  );

  // ---------- LERN-PHASE ----------
  if (phase === "learn") {
    const c = data[learnIdx];
    const last = learnIdx >= data.length - 1;
    return (
      <div>
        <div style={headBar}>
          <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{pack.label} · Lernen</span>
          <span style={pill}>{learnIdx + 1} / {data.length}</span>
        </div>

        <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.5, marginBottom: 14 }}>
          {pack.intro}
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 18,
            padding: "22px 18px 24px",
            textAlign: "center",
            marginBottom: 14,
          }}
        >
          {isLam ? (
            <>
              {bigPrompt(c.ar)}
              <div
                style={{
                  display: "inline-block",
                  fontSize: 13,
                  fontWeight: 700,
                  color: c.type === "shamsiya" ? C.gold : C.green,
                  border: `1px solid ${C.line}`,
                  borderRadius: 999,
                  padding: "4px 14px",
                  margin: "4px 0 10px",
                }}
              >
                {c.type === "shamsiya" ? "Lam Shamsiya" : "Lam Qamariya"}
              </div>
              <div style={{ color: C.gold, fontSize: 18, fontWeight: 700 }}>{c.read}</div>
              <div style={{ color: C.sub, fontSize: 14, marginTop: 2 }}>{c.de}</div>
              <div style={{ color: C.sub, fontSize: 13.5, marginTop: 10, lineHeight: 1.55 }}>
                {LAM_EXPLAIN[c.type]}
              </div>
            </>
          ) : (
            <>
              {bigPrompt(c.sign)}
              <div style={{ color: C.gold, fontSize: 18, fontWeight: 700 }}>{c.name}</div>
              <div style={{ color: C.ink, fontSize: 15, fontWeight: 600, marginTop: 4 }}>{c.short}</div>
              <div style={{ color: C.sub, fontSize: 13.5, marginTop: 10, lineHeight: 1.55 }}>{c.long}</div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{ ...ghostBtn, opacity: learnIdx === 0 ? 0.4 : 1 }}
            disabled={learnIdx === 0}
            onClick={() => setLearnIdx((i) => Math.max(0, i - 1))}
          >
            Zurück
          </button>
          {last ? (
            <button style={primaryBtn} onClick={() => setPhase("quiz")}>
              Zum Quiz →
            </button>
          ) : (
            <button style={primaryBtn} onClick={() => setLearnIdx((i) => i + 1)}>
              Weiter
            </button>
          )}
        </div>
        <button style={exitBtn} onClick={onExit}>Beenden</button>
      </div>
    );
  }

  // ---------- QUIZ-PHASE ----------
  if (phase === "quiz") {
    const q = quiz[qIdx];
    const answered = chosen !== null;
    const last = qIdx >= quiz.length - 1;
    function choose(i) {
      if (answered) return;
      setChosen(i);
      if (q.options[i].correct) setCorrectCount((n) => n + 1);
    }
    function nextQ() {
      if (last) {
        setPhase("result");
      } else {
        setQIdx((i) => i + 1);
        setChosen(null);
      }
    }
    return (
      <div>
        <div style={headBar}>
          <span style={{ fontSize: 13, color: C.sub, fontWeight: 600 }}>{pack.label} · Quiz</span>
          <span style={pill}>{qIdx + 1} / {quiz.length} · {correctCount} richtig</span>
        </div>

        <div
          style={{
            background: C.panel,
            border: `1px solid ${C.line}`,
            borderRadius: 18,
            padding: "20px 18px 22px",
            textAlign: "center",
            marginBottom: 14,
          }}
        >
          {bigPrompt(q.prompt)}
          <div style={{ color: C.sub, fontSize: 15 }}>{q.question}</div>
        </div>

        <div style={{ display: "grid", gap: 10, marginBottom: 12 }}>
          {q.options.map((opt, i) => {
            let bg = C.panel2, border = C.line;
            if (answered && i === chosen) {
              bg = opt.correct ? "rgba(63,174,107,.2)" : "rgba(201,88,79,.2)";
              border = opt.correct ? C.green : C.red;
            }
            if (answered && opt.correct && i !== chosen) {
              bg = "rgba(63,174,107,.12)";
              border = C.green;
            }
            return (
              <button
                key={i}
                onClick={() => choose(i)}
                disabled={answered}
                style={{
                  padding: "14px 16px",
                  borderRadius: 14,
                  border: `1.5px solid ${border}`,
                  background: bg,
                  color: C.ink,
                  fontSize: 16,
                  fontWeight: 600,
                  cursor: answered ? "default" : "pointer",
                  textAlign: "center",
                }}
              >
                {opt.label}
              </button>
            );
          })}
        </div>

        {answered && (
          <div
            style={{
              background: C.panel2,
              border: `1px solid ${C.line}`,
              borderRadius: 12,
              padding: "12px 14px",
              marginBottom: 12,
              color: C.sub,
              fontSize: 13.5,
              lineHeight: 1.55,
            }}
          >
            {q.explain}
          </div>
        )}

        <div style={{ display: "flex", gap: 10 }}>
          <button
            style={{ ...primaryBtn, opacity: answered ? 1 : 0.4 }}
            disabled={!answered}
            onClick={nextQ}
          >
            {last ? "Ergebnis" : "Weiter"}
          </button>
        </div>
        <button style={exitBtn} onClick={onExit}>Beenden</button>
      </div>
    );
  }

  // ---------- ERGEBNIS ----------
  const pct = quiz.length ? Math.round((correctCount / quiz.length) * 100) : 0;
  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: 22,
        textAlign: "center",
      }}
    >
      <div style={{ fontFamily: fontStack, fontSize: 38, color: C.gold }}>تم</div>
      <h2 style={{ margin: "6px 0 2px", fontSize: 21 }}>Quiz beendet</h2>
      <p style={{ margin: "0 0 16px", color: C.sub, fontSize: 14 }}>{pack.label}</p>
      <div style={{ fontSize: 34, fontWeight: 800, color: pct >= 80 ? C.green : C.ink }}>
        {correctCount} / {quiz.length}
      </div>
      <div style={{ color: C.sub, fontSize: 14, marginBottom: 18 }}>{pct} % richtig</div>
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <button
          style={primaryBtn}
          onClick={() => {
            setQuiz(buildGuideQuiz(pack));
            setQIdx(0);
            setChosen(null);
            setCorrectCount(0);
            setPhase("quiz");
          }}
        >
          Quiz nochmal
        </button>
        <button
          style={ghostBtn}
          onClick={() => {
            setLearnIdx(0);
            setPhase("learn");
          }}
        >
          Nochmal lernen
        </button>
      </div>
      <button style={exitBtn} onClick={onExit}>Beenden</button>
    </div>
  );
}

// =====================================================
//  Ergebnisbildschirm
// =====================================================
function ResultScreen({
  C, fontStack, finalMs, correct, wrong, answered, accuracy, bestStreak,
  curStat, statLabel, onRestart, onAgain,
}) {
  const row = (label, val, color) => (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "13px 4px",
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <span style={{ color: C.sub, fontSize: 15 }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color || C.ink }}>{val}</span>
    </div>
  );

  return (
    <div
      style={{
        background: C.panel,
        border: `1px solid ${C.line}`,
        borderRadius: 18,
        padding: 22,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontFamily: fontStack, fontSize: 40, color: C.gold }}>تم</div>
        <h2 style={{ margin: "6px 0 2px", fontSize: 22 }}>Durchgang beendet</h2>
        <p style={{ margin: 0, color: C.sub, fontSize: 14 }}>Das war dein Ergebnis.</p>
      </div>

      <div style={{ marginTop: 16 }}>
        {row("Verstrichene Zeit", fmtTime(finalMs), C.gold)}
        {row("Beantwortet", answered)}
        {row("Richtig", correct, C.green)}
        {row("Falsch", wrong, C.red)}
        {row("Trefferquote", `${accuracy} %`, accuracy >= 80 ? C.green : C.ink)}
        {row("Beste Serie", bestStreak, C.gold)}
      </div>

      {answered > 0 && (
        <p style={{ color: C.sub, fontSize: 13, marginTop: 14, lineHeight: 1.55 }}>
          {accuracy >= 90
            ? "Sehr sauber. Das sitzt fast automatisch."
            : accuracy >= 70
            ? "Solide. Die Verwechsler wiederholen, dann wird's automatisch."
            : "Noch Verwechslungen — genau dafür ist das Modul da. Dranbleiben."}
        </p>
      )}

      {curStat && (
        <div
          style={{
            marginTop: 16,
            padding: "12px 14px",
            borderRadius: 12,
            border: `1px solid ${C.line}`,
            background: C.panel2,
          }}
        >
          <div style={{ fontSize: 12, color: C.sub, fontWeight: 600, marginBottom: 8 }}>
            GESAMT · {statLabel}
          </div>
          <div style={{ display: "flex", justifyContent: "space-around", textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Durchgänge</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{curStat.runs}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Ø Trefferquote</div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: statAccuracyOf(curStat) >= 80 ? C.green : C.ink,
                }}
              >
                {statAccuracyOf(curStat)} %
              </div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: C.sub }}>Beste Serie</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.gold }}>
                {curStat.bestStreak}
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button
          onClick={onAgain}
          style={{
            flex: 1,
            padding: "15px",
            borderRadius: 14,
            border: "none",
            background: `linear-gradient(180deg, ${C.green}, ${C.greenD})`,
            color: "#fff",
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Nochmal
        </button>
        <button
          onClick={onRestart}
          style={{
            flex: 1,
            padding: "15px",
            borderRadius: 14,
            border: `1px solid ${C.line}`,
            background: C.panel2,
            color: C.ink,
            fontSize: 16,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Einstellungen
        </button>
      </div>
    </div>
  );
}

// =====================================================
//  Lesen-Checkliste (Selbst-Abhaken, ganz unten auf dem Startbildschirm)
// =====================================================
function ChecklistSection({ C, done, onToggle, onReset }) {
  const total = CHECKLIST.length;
  const doneCount = CHECKLIST.filter((i) => done[i.id]).length;
  const pct = total ? Math.round((doneCount / total) * 100) : 0;

  return (
    <div style={{ marginTop: 34 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 10,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Lesen-Checkliste</h2>
        <span style={{ fontSize: 13, color: C.sub }}>
          {doneCount} / {total} erledigt
        </span>
      </div>

      {/* Fortschrittsbalken */}
      <div
        style={{
          height: 8,
          borderRadius: 999,
          background: C.panel2,
          border: `1px solid ${C.line}`,
          overflow: "hidden",
          marginBottom: 14,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: `linear-gradient(90deg, ${C.green}, ${C.gold})`,
            transition: "width .25s",
          }}
        />
      </div>

      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 16,
          overflow: "hidden",
        }}
      >
        {CHECKLIST.map((item, idx) => {
          const isDone = !!done[item.id];
          const cat = CHECK_CATS[item.cat];
          return (
            <button
              key={item.id}
              type="button"
              role="checkbox"
              aria-checked={isDone}
              onClick={() => onToggle(item.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "13px 14px",
                border: "none",
                borderTop: idx === 0 ? "none" : `1px solid ${C.line}`,
                borderRadius: 0,
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
                background: isDone ? "rgba(63,174,107,0.06)" : "transparent",
              }}
            >
              {/* Checkbox */}
              <div
                style={{
                  flexShrink: 0,
                  width: 22,
                  height: 22,
                  borderRadius: 6,
                  border: `1.5px solid ${isDone ? C.green : C.line}`,
                  background: isDone ? C.green : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#fff",
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                {isDone ? "✓" : ""}
              </div>

              <span
                style={{
                  flex: 1,
                  fontSize: 13.5,
                  lineHeight: 1.5,
                  color: isDone ? C.sub : C.ink,
                  textDecoration: isDone ? "line-through" : "none",
                }}
              >
                {item.text}
              </span>

              <span
                style={{
                  flexShrink: 0,
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: cat.fg,
                  background: cat.bg,
                  borderRadius: 6,
                  padding: "3px 9px",
                }}
              >
                {cat.label}
              </span>
            </button>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
        <span style={{ fontSize: 12, color: C.sub }}>
          Zum Abhaken antippen. Wird auf diesem Gerät gespeichert.
        </span>
        {doneCount > 0 && (
          <button
            onClick={onReset}
            style={{
              fontSize: 12,
              color: C.sub,
              background: "transparent",
              border: `1px solid ${C.line}`,
              borderRadius: 8,
              padding: "5px 11px",
              cursor: "pointer",
            }}
          >
            zurücksetzen
          </button>
        )}
      </div>
    </div>
  );
}
