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
];

function pad3(n) {
  return String(n).padStart(3, "0");
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

// --- Surat al-Maʿārij (70): AUSZUG (Ayat 1-10) — noch zu vervollstaendigen ---
// Die Sure hat 44 Verse. Ich trage hier bewusst nur die ersten als
// gepruefte Grundlage ein und lasse den Rest offen, statt 44 Verse aus
// dem Gedaechtnis zu erfinden. Rest aus tanzil.net / api.quran.com ergaenzen.
const MAARIJ_EXCERPT = tagAyat([
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
], 70, 1);

// 3 Suren am Stueck: aus den oben abgedeckten Ayat zusammengesetzt
// (al-Mulk 1-11, al-Qalam 1-16, al-Haqqa 1-10 — nicht die vollen Suren).
const DREI_SUREN = [...MULK_1_5, ...MULK_6_11, ...QALAM_1_16, ...HAQQA_1_10];

const QURAN_NOTE = "Text vor dem Lernen mit einem zuverlässigen Mushaf abgleichen.";

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
      { id: "maarij", label: "al-Maʿārij — Auszug (1–10)", items: MAARIJ_EXCERPT, note: QURAN_NOTE + " Sure noch unvollständig (44 Verse)." },
      { id: "drei", label: "3 Suren am Stück (abgedeckte Ayat)", items: DREI_SUREN, note: QURAN_NOTE },
    ],
  },
};

const MODULE_ORDER = ["letters", "harakat", "words", "ayat"];

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
  { ar: "شَمْس", tr: "šams", hint: "Sukun auf م (مْ) — šam, dann s: šams." },
  { ar: "عَبْد", tr: "ʿabd", hint: "Sukun auf ب — ʿab, dann d: ʿabd." },
  { ar: "خَيْر", tr: "khayr", hint: "Sukun auf ي — khay, dann r: khayr." },
  { ar: "بَعْد", tr: "baʿd", hint: "Sukun auf ع — baʿ, dann d: baʿd." },
  { ar: "قَبْل", tr: "qabl", hint: "Sukun auf ب — qab, dann l: qabl." },
];

// Tanwin (Nunation): doppeltes Vokalzeichen am Wortende, klingt wie ein
// zusätzliches „n“. ٌ = -un, ٍ = -in, ً = -an. Bei ً steht meist ein stummes
// Alif (ـًا), das NICHT als langes „a“ mitgesprochen wird.
const PRONUN_TANWIN = [
  { ar: "رَجُلٌ", tr: "raǧulun", hint: "Endung ٌ (Tanwin Damma) = „-un“: raǧul + un." },
  { ar: "كِتَابٌ", tr: "kitābun", hint: "ٌ am Ende = „-un“: kitāb + un." },
  { ar: "عَلِيمٌ", tr: "ʿalīmun", hint: "ٌ = „-un“: ʿalīm + un." },
  { ar: "وَلَدٌ", tr: "waladun", hint: "ٌ = „-un“: walad + un." },
  { ar: "بَيْتٌ", tr: "baytun", hint: "ٌ = „-un“: bayt + un." },
  { ar: "رِزْقٌ", tr: "rizqun", hint: "ٌ = „-un“: rizq + un." },
  { ar: "كِتَابٍ", tr: "kitābin", hint: "Endung ٍ (Tanwin Kasra) = „-in“: kitāb + in." },
  { ar: "يَوْمٍ", tr: "yawmin", hint: "ٍ = „-in“: yawm + in." },
  { ar: "قَوْمٍ", tr: "qawmin", hint: "ٍ = „-in“: qawm + in." },
  { ar: "بَيْتٍ", tr: "baytin", hint: "ٍ = „-in“: bayt + in." },
  { ar: "رَجُلٍ", tr: "raǧulin", hint: "ٍ = „-in“: raǧul + in." },
  { ar: "شَيْءٍ", tr: "shayʾin", hint: "ٍ = „-in“: shayʾ + in." },
  { ar: "كِتَابًا", tr: "kitāban", hint: "Endung ـًا (Tanwin Fatha) = „-an“: kitāb + an. Das Alif ist stumm." },
  { ar: "كَثِيرًا", tr: "kaṯīran", hint: "ـًا = „-an“: kaṯīr + an. Alif nicht mitsprechen." },
  { ar: "شُكْرًا", tr: "šukran", hint: "ـًا = „-an“: šukr + an. Alif nicht mitsprechen." },
  { ar: "بَابًا", tr: "bāban", hint: "ـًا = „-an“: bāb + an. Alif stumm." },
  { ar: "عِلْمًا", tr: "ʿilman", hint: "ـًا = „-an“: ʿilm + an. Alif stumm." },
  { ar: "خَيْرًا", tr: "khayran", hint: "ـًا = „-an“: khayr + an. Alif stumm." },
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
  { ar: "رَبَّنَا", tr: "rabbanā", hint: "Shadda auf ب → b verdoppelt: „rab-ba-nā“." },
  { ar: "مُحَمَّد", tr: "muḥammad", hint: "Shadda auf م → m verdoppelt: „muḥam-mad“." },
  { ar: "الَّذِي", tr: "alladhī", hint: "Shadda auf ل → l verdoppelt: „al-ladhī“." },
  { ar: "عَلَّمَ", tr: "ʿallama", hint: "Shadda auf ل → l verdoppelt: „ʿal-lama“." },
  { ar: "حُبّ", tr: "ḥubb", hint: "Shadda auf ب → b verdoppelt: „ḥub-b“." },
  { ar: "سِرّ", tr: "sirr", hint: "Shadda auf ر → r verdoppelt: „sir-r“." },
  { ar: "مَرَّة", tr: "marra", hint: "Shadda auf ر → r verdoppelt: „mar-ra“." },
  { ar: "ظَنَّ", tr: "ẓanna", hint: "Shadda auf ن → n verdoppelt: „ẓan-na“." },
  { ar: "شِدَّة", tr: "shidda", hint: "Shadda auf د → d verdoppelt: „shid-da“." },
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
  { ar: "يَقُولُ", tr: "yaqūlu", hint: "Waw nach Damma (قُو) → langes „u“: yaqūlu." },
  { ar: "نُور", tr: "nūr", hint: "Waw nach Damma → langes „u“: nūr, nicht kurz „nur“." },
  { ar: "رُوح", tr: "rūḥ", hint: "Waw nach Damma → langes „u“: rūḥ." },
  { ar: "يَكُونُ", tr: "yakūnu", hint: "Waw nach Damma → langes „u“: yakūnu." },
  { ar: "صُور", tr: "ṣūr", hint: "Waw nach Damma → langes „u“: ṣūr." },
  { ar: "دُون", tr: "dūn", hint: "Waw nach Damma → langes „u“: dūn." },
  { ar: "قِيلَ", tr: "qīla", hint: "Ya nach Kasra (قِي) → langes „i“: qīla." },
  { ar: "كَبِير", tr: "kabīr", hint: "Ya nach Kasra → langes „i“: kabīr." },
  { ar: "رَحِيم", tr: "raḥīm", hint: "Ya nach Kasra → langes „i“: raḥīm." },
  { ar: "دِين", tr: "dīn", hint: "Ya nach Kasra → langes „i“: dīn." },
  { ar: "عِيد", tr: "ʿīd", hint: "Ya nach Kasra → langes „i“: ʿīd." },
  { ar: "سَعِيد", tr: "saʿīd", hint: "Ya nach Kasra → langes „i“: saʿīd." },
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
        label: "Madd",
        rule: "Madd = Vokal dehnen (etwa doppelt so lang). Alif nach Fatha = langes „ā“, Waw nach Damma = langes „ū“, Ya nach Kasra = langes „ī“.",
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
  return CHOICE_MODULES[id] || READING_MODULES[id] || PRONUN_MODULES[id];
}

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

export default function App() {
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

  const curMod = getModule(moduleId);
  const isReading = curMod.kind === "reading";
  const isChoice = curMod.kind === "choice";
  const isPronun = curMod.kind === "pronunciation";
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
  // Aussprache-Check hat keine Statistik; Auto-Modus ebenfalls nicht.
  const showStats = !isPronun && !(autoMode && isChoice);

  // ---- Stimmen (Text-to-Speech, nur noch fuer Buchstaben/Harakat/Woerter) ----
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(null);
  const synthRef = useRef(typeof window !== "undefined" ? window.speechSynthesis : null);

  // ---- Echte Rezitation (Verse & Suren) ----
  const [reciterId, setReciterId] = useState(RECITERS[0].id);
  const reciterFolder = (RECITERS.find((r) => r.id === reciterId) || RECITERS[0]).folder;
  const audioElRef = useRef(typeof window !== "undefined" ? new Audio() : null);

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
      setRQueue(shuffle(pack.items));
      setRIdx(0);
      setRevealed(false);
      setScreen("play");
    } else if (isPronun) {
      // Aussprache-Check verwaltet Index/Aufloesen im eigenen Screen.
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
            onSpeak={() => playReadingAudio(rItem)}
            onFinish={finish}
            correct={correct}
            wrong={wrong}
            streak={streak}
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
  needsReciter, reciterId, setReciterId, onTestReciter,
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
            {curMod.kind === "pronunciation" ? "KATEGORIE WÄHLEN" : "INHALT WÄHLEN"}
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {curMod.packs.map((p) => (
              <button key={p.id} style={pickBtn(packId === p.id)} onClick={() => setPackId(p.id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.label}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
                  {p.items.length} {curMod.kind === "pronunciation" ? "Wörter" : "Karten"}
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
}) {
  const stat = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.ink }}>{val}</div>
    </div>
  );

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
      {/* Statuszeile */}
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

      {/* Karte */}
      <div
        style={{
          background: C.panel,
          border: `1px solid ${C.line}`,
          borderRadius: 18,
          padding: "20px 18px 24px",
          textAlign: "center",
          marginBottom: 16,
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
          {item.ar}
        </div>

        {!revealed ? (
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
      {!revealed ? (
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
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);

  const item = items[idx];
  const isLast = idx >= items.length - 1;
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
          {idx + 1} / {items.length}
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
