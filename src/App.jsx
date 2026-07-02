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
const HARAKAT_LETTERS = [
  { base: "ب", tr: "b" }, { base: "ت", tr: "t" }, { base: "ث", tr: "th" },
  { base: "ج", tr: "j" }, { base: "ح", tr: "ḥ" }, { base: "خ", tr: "kh" },
  { base: "د", tr: "d" }, { base: "ر", tr: "r" }, { base: "س", tr: "s" },
  { base: "ش", tr: "sh" }, { base: "ص", tr: "ṣ" }, { base: "ط", tr: "ṭ" },
  { base: "ع", tr: "ʿ" }, { base: "ف", tr: "f" }, { base: "ق", tr: "q" },
  { base: "ك", tr: "k" }, { base: "ل", tr: "l" }, { base: "م", tr: "m" },
  { base: "ن", tr: "n" }, { base: "ه", tr: "h" }, { base: "و", tr: "w" },
  { base: "ي", tr: "y" },
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
const MULK_1_5 = [
  { ar: "تَبَارَكَ الَّذِي بِيَدِهِ الْمُلْكُ وَهُوَ عَلَىٰ كُلِّ شَيْءٍ قَدِيرٌ", tr: "tabāraka lladhī bi-yadihi l-mulku wa-huwa ʿalā kulli shayʾin qadīr", de: "Gesegnet ist Der, in dessen Hand die Herrschaft liegt; und Er hat Macht über alle Dinge." },
  { ar: "الَّذِي خَلَقَ الْمَوْتَ وَالْحَيَاةَ لِيَبْلُوَكُمْ أَيُّكُمْ أَحْسَنُ عَمَلًا ۚ وَهُوَ الْعَزِيزُ الْغَفُورُ", tr: "alladhī khalaqa l-mawta wa-l-ḥayāta li-yabluwakum ayyukum aḥsanu ʿamalā, wa-huwa l-ʿazīzu l-ghafūr", de: "Der Tod und Leben erschuf, um euch zu prüfen, wer von euch am besten handelt. Und Er ist der Allmächtige, der Allvergebende." },
  { ar: "الَّذِي خَلَقَ سَبْعَ سَمَاوَاتٍ طِبَاقًا ۖ مَا تَرَىٰ فِي خَلْقِ الرَّحْمَٰنِ مِن تَفَاوُتٍ ۖ فَارْجِعِ الْبَصَرَ هَلْ تَرَىٰ مِن فُطُورٍ", tr: "alladhī khalaqa sabʿa samāwātin ṭibāqā …", de: "Der sieben Himmel in Schichten erschuf. Du siehst in der Schöpfung des Allerbarmers keinen Fehler. Wende den Blick zurück: Siehst du irgendeinen Riss?" },
  { ar: "ثُمَّ ارْجِعِ الْبَصَرَ كَرَّتَيْنِ يَنقَلِبْ إِلَيْكَ الْبَصَرُ خَاسِئًا وَهُوَ حَسِيرٌ", tr: "thumma rjiʿi l-baṣara karratayni …", de: "Dann wende den Blick ein zweites Mal zurück: Der Blick kehrt zu dir zurück, ermattet und erschöpft." },
  { ar: "وَلَقَدْ زَيَّنَّا السَّمَاءَ الدُّنْيَا بِمَصَابِيحَ وَجَعَلْنَاهَا رُجُومًا لِّلشَّيَاطِينِ ۖ وَأَعْتَدْنَا لَهُمْ عَذَابَ السَّعِيرِ", tr: "wa-laqad zayyannā s-samāʾa d-dunyā bi-maṣābīḥ …", de: "Wir haben den untersten Himmel mit Leuchten geschmückt und sie zu Wurfgeschossen gegen die Satane gemacht; und für sie haben Wir die Strafe des Feuers bereitet." },
];

// --- Surat al-Mulk (67), Ayat 6-11 ---
const MULK_6_11 = [
  { ar: "وَلِلَّذِينَ كَفَرُوا بِرَبِّهِمْ عَذَابُ جَهَنَّمَ ۖ وَبِئْسَ الْمَصِيرُ", tr: "wa-li-lladhīna kafarū bi-rabbihim ʿadhābu jahannam …", de: "Und für die, die ihren Herrn verleugnen, ist die Strafe der Hölle — und ein schlimmes Ende ist das." },
  { ar: "إِذَا أُلْقُوا فِيهَا سَمِعُوا لَهَا شَهِيقًا وَهِيَ تَفُورُ", tr: "idhā ulqū fīhā samiʿū lahā shahīqan wa-hiya tafūr", de: "Wenn sie hineingeworfen werden, hören sie ihr Aufheulen, während sie brodelt." },
  { ar: "تَكَادُ تَمَيَّزُ مِنَ الْغَيْظِ ۖ كُلَّمَا أُلْقِيَ فِيهَا فَوْجٌ سَأَلَهُمْ خَزَنَتُهَا أَلَمْ يَأْتِكُمْ نَذِيرٌ", tr: "takādu tamayyazu mina l-ghayẓ …", de: "Fast birst sie vor Wut. Jedes Mal, wenn eine Schar hineingeworfen wird, fragen ihre Wächter sie: Ist zu euch kein Warner gekommen?" },
  { ar: "قَالُوا بَلَىٰ قَدْ جَاءَنَا نَذِيرٌ فَكَذَّبْنَا وَقُلْنَا مَا نَزَّلَ اللَّهُ مِن شَيْءٍ إِنْ أَنتُمْ إِلَّا فِي ضَلَالٍ كَبِيرٍ", tr: "qālū balā qad jāʾanā nadhīr …", de: "Sie sagen: Doch, es kam ein Warner zu uns, aber wir leugneten und sagten: Gott hat nichts herabgesandt; ihr seid nur in großem Irrtum." },
  { ar: "وَقَالُوا لَوْ كُنَّا نَسْمَعُ أَوْ نَعْقِلُ مَا كُنَّا فِي أَصْحَابِ السَّعِيرِ", tr: "wa-qālū law kunnā nasmaʿu aw naʿqilu …", de: "Und sie sagen: Hätten wir nur gehört oder verstanden, wären wir nicht unter den Bewohnern des Feuers." },
  { ar: "فَاعْتَرَفُوا بِذَنبِهِمْ فَسُحْقًا لِّأَصْحَابِ السَّعِيرِ", tr: "fa-ʿtarafū bi-dhanbihim fa-suḥqan li-aṣḥābi s-saʿīr", de: "So gestehen sie ihre Sünde ein. Fort denn mit den Bewohnern des Feuers!" },
];

// --- Surat al-Qalam (68), Ayat 1-16 ---
const QALAM_1_16 = [
  { ar: "نٓ ۚ وَالْقَلَمِ وَمَا يَسْطُرُونَ", tr: "nūn, wa-l-qalami wa-mā yasṭurūn", de: "Nūn. Beim Stift und bei dem, was sie niederschreiben." },
  { ar: "مَا أَنتَ بِنِعْمَةِ رَبِّكَ بِمَجْنُونٍ", tr: "mā anta bi-niʿmati rabbika bi-majnūn", de: "Du bist, dank der Gnade deines Herrn, kein Besessener." },
  { ar: "وَإِنَّ لَكَ لَأَجْرًا غَيْرَ مَمْنُونٍ", tr: "wa-inna laka la-ajran ghayra mamnūn", de: "Und dir wird gewiss ein nie endender Lohn zuteil." },
  { ar: "وَإِنَّكَ لَعَلَىٰ خُلُقٍ عَظِيمٍ", tr: "wa-innaka la-ʿalā khuluqin ʿaẓīm", de: "Und du bist wahrlich von großartigem Charakter." },
  { ar: "فَسَتُبْصِرُ وَيُبْصِرُونَ", tr: "fa-satubṣiru wa-yubṣirūn", de: "Du wirst sehen, und auch sie werden sehen," },
  { ar: "بِأَيِّكُمُ الْمَفْتُونُ", tr: "bi-ayyikumu l-maftūn", de: "wer von euch der Verwirrte ist." },
  { ar: "إِنَّ رَبَّكَ هُوَ أَعْلَمُ بِمَن ضَلَّ عَن سَبِيلِهِ وَهُوَ أَعْلَمُ بِالْمُهْتَدِينَ", tr: "inna rabbaka huwa aʿlamu bi-man ḍalla ʿan sabīlih …", de: "Dein Herr weiß am besten, wer von Seinem Weg abgeirrt ist, und Er kennt die Rechtgeleiteten am besten." },
  { ar: "فَلَا تُطِعِ الْمُكَذِّبِينَ", tr: "fa-lā tuṭiʿi l-mukadhdhibīn", de: "So gehorche nicht den Leugnern." },
  { ar: "وَدُّوا لَوْ تُدْهِنُ فَيُدْهِنُونَ", tr: "waddū law tudhinu fa-yudhinūn", de: "Sie möchten, dass du nachgibst, damit auch sie nachgeben." },
  { ar: "وَلَا تُطِعْ كُلَّ حَلَّافٍ مَّهِينٍ", tr: "wa-lā tuṭiʿ kulla ḥallāfin mahīn", de: "Und gehorche keinem verächtlichen Schwörer," },
  { ar: "هَمَّازٍ مَّشَّاءٍ بِنَمِيمٍ", tr: "hammāzin mashshāʾin bi-namīm", de: "Verleumder, der mit übler Nachrede umhergeht," },
  { ar: "مَّنَّاعٍ لِّلْخَيْرِ مُعْتَدٍ أَثِيمٍ", tr: "mannāʿin li-l-khayri muʿtadin athīm", de: "der das Gute verwehrt, Übertreter und Sünder ist," },
  { ar: "عُتُلٍّ بَعْدَ ذَٰلِكَ زَنِيمٍ", tr: "ʿutullin baʿda dhālika zanīm", de: "grob und dazu von zweifelhafter Herkunft," },
  { ar: "أَن كَانَ ذَا مَالٍ وَبَنِينَ", tr: "an kāna dhā mālin wa-banīn", de: "nur weil er Vermögen und Söhne besitzt." },
  { ar: "إِذَا تُتْلَىٰ عَلَيْهِ آيَاتُنَا قَالَ أَسَاطِيرُ الْأَوَّلِينَ", tr: "idhā tutlā ʿalayhi āyātunā qāla asāṭīru l-awwalīn", de: "Wenn ihm Unsere Zeichen verlesen werden, sagt er: Fabeln der Früheren!" },
  { ar: "سَنَسِمُهُ عَلَى الْخُرْطُومِ", tr: "sanasimuhu ʿalā l-khurṭūm", de: "Wir werden ihn auf der Nase brandmarken." },
];

// --- Surat al-Haqqa (69), Ayat 1-10 ---
const HAQQA_1_10 = [
  { ar: "الْحَاقَّةُ", tr: "al-ḥāqqa", de: "Die Unausweichliche." },
  { ar: "مَا الْحَاقَّةُ", tr: "mā l-ḥāqqa", de: "Was ist die Unausweichliche?" },
  { ar: "وَمَا أَدْرَاكَ مَا الْحَاقَّةُ", tr: "wa-mā adrāka mā l-ḥāqqa", de: "Und was lässt dich wissen, was die Unausweichliche ist?" },
  { ar: "كَذَّبَتْ ثَمُودُ وَعَادٌ بِالْقَارِعَةِ", tr: "kadhdhabat thamūdu wa-ʿādun bi-l-qāriʿa", de: "Thamud und ʿAd erklärten das Verhängnis für Lüge." },
  { ar: "فَأَمَّا ثَمُودُ فَأُهْلِكُوا بِالطَّاغِيَةِ", tr: "fa-ammā thamūdu fa-uhlikū bi-ṭ-ṭāghiya", de: "Was Thamud angeht, so wurden sie durch den gewaltigen Schall vernichtet." },
  { ar: "وَأَمَّا عَادٌ فَأُهْلِكُوا بِرِيحٍ صَرْصَرٍ عَاتِيَةٍ", tr: "wa-ammā ʿādun fa-uhlikū bi-rīḥin ṣarṣarin ʿātiya", de: "Und was ʿAd angeht, so wurden sie durch einen eiskalten, heftigen Sturm vernichtet," },
  { ar: "سَخَّرَهَا عَلَيْهِمْ سَبْعَ لَيَالٍ وَثَمَانِيَةَ أَيَّامٍ حُسُومًا فَتَرَى الْقَوْمَ فِيهَا صَرْعَىٰ كَأَنَّهُمْ أَعْجَازُ نَخْلٍ خَاوِيَةٍ", tr: "sakhkharahā ʿalayhim sabʿa layālin wa-thamāniyata ayyāmin ḥusūmā …", de: "den Er sieben Nächte und acht Tage lang ununterbrochen über sie schickte, sodass du das Volk darin niedergestreckt sahst wie hohle Palmstümpfe." },
  { ar: "فَهَلْ تَرَىٰ لَهُم مِّن بَاقِيَةٍ", tr: "fa-hal tarā lahum min bāqiya", de: "Siehst du von ihnen noch irgendetwas übrig?" },
  { ar: "وَجَاءَ فِرْعَوْنُ وَمَن قَبْلَهُ وَالْمُؤْتَفِكَاتُ بِالْخَاطِئَةِ", tr: "wa-jāʾa firʿawnu wa-man qablahu wa-l-muʾtafikātu bi-l-khāṭiʾa", de: "Und Pharao kam, und die vor ihm, und die umgestürzten Städte, mit dem Vergehen." },
  { ar: "فَعَصَوْا رَسُولَ رَبِّهِمْ فَأَخَذَهُمْ أَخْذَةً رَّابِيَةً", tr: "fa-ʿaṣaw rasūla rabbihim fa-akhadhahum akhdhatan rābiya", de: "Sie widersetzten sich dem Gesandten ihres Herrn, da ergriff Er sie mit übermäßigem Griff." },
];

// --- Surat al-Maʿārij (70): AUSZUG (Ayat 1-10) — noch zu vervollstaendigen ---
// Die Sure hat 44 Verse. Ich trage hier bewusst nur die ersten als
// gepruefte Grundlage ein und lasse den Rest offen, statt 44 Verse aus
// dem Gedaechtnis zu erfinden. Rest aus tanzil.net / api.quran.com ergaenzen.
const MAARIJ_EXCERPT = [
  { ar: "سَأَلَ سَائِلٌ بِعَذَابٍ وَاقِعٍ", tr: "saʾala sāʾilun bi-ʿadhābin wāqiʿ", de: "Ein Fragender fragte nach einer eintreffenden Strafe," },
  { ar: "لِّلْكَافِرِينَ لَيْسَ لَهُ دَافِعٌ", tr: "li-l-kāfirīna laysa lahu dāfiʿ", de: "für die Ungläubigen — niemand kann sie abwehren —" },
  { ar: "مِّنَ اللَّهِ ذِي الْمَعَارِجِ", tr: "mina llāhi dhī l-maʿārij", de: "von Gott, dem Herrn der Aufstiegswege." },
  { ar: "تَعْرُجُ الْمَلَائِكَةُ وَالرُّوحُ إِلَيْهِ فِي يَوْمٍ كَانَ مِقْدَارُهُ خَمْسِينَ أَلْفَ سَنَةٍ", tr: "taʿruju l-malāʾikatu wa-r-rūḥu ilayhi …", de: "Die Engel und der Geist steigen zu Ihm auf an einem Tag, dessen Maß fünfzigtausend Jahre ist." },
  { ar: "فَاصْبِرْ صَبْرًا جَمِيلًا", tr: "fa-ṣbir ṣabran jamīlā", de: "So harre in schöner Geduld aus." },
  { ar: "إِنَّهُمْ يَرَوْنَهُ بَعِيدًا", tr: "innahum yarawnahu baʿīdā", de: "Sie sehen sie (die Strafe) als fern," },
  { ar: "وَنَرَاهُ قَرِيبًا", tr: "wa-narāhu qarībā", de: "Wir aber sehen sie als nah." },
  { ar: "يَوْمَ تَكُونُ السَّمَاءُ كَالْمُهْلِ", tr: "yawma takūnu s-samāʾu ka-l-muhl", de: "Am Tag, da der Himmel wie geschmolzenes Erz wird," },
  { ar: "وَتَكُونُ الْجِبَالُ كَالْعِهْنِ", tr: "wa-takūnu l-jibālu ka-l-ʿihn", de: "und die Berge wie gefärbte Wolle werden," },
  { ar: "وَلَا يَسْأَلُ حَمِيمٌ حَمِيمًا", tr: "wa-lā yasʾalu ḥamīmun ḥamīmā", de: "und kein Vertrauter einen Vertrauten fragt." },
];

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
  words: {
    id: "words",
    kind: "reading",
    title: "Wörter lesen",
    subtitle: "Kurze Wörter flüssig lesen",
    packs: [
      { id: "sukun", label: "Sukun-Wörter", items: WORDS_SUKUN },
      { id: "shadda", label: "Shadda-Wörter", items: WORDS_SHADDA },
      { id: "mulkW", label: "al-Mulk — 5 Wörter", items: WORDS_MULK, note: QURAN_NOTE },
      { id: "qalamW", label: "al-Qalam — 10 Wörter", items: WORDS_QALAM, note: QURAN_NOTE },
    ],
  },
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

function getModule(id) {
  return CHOICE_MODULES[id] || READING_MODULES[id];
}

export default function App() {
  const [screen, setScreen] = useState("start"); // start | play | result

  // Modul-/Modus-Auswahl
  const [moduleId, setModuleId] = useState("letters");
  const [mode, setMode] = useState("form2letter"); // nur Auswahl-Module
  const [packId, setPackId] = useState(null); // nur Lese-Module

  const curMod = getModule(moduleId);
  const isReading = curMod.kind === "reading";
  const curMode = !isReading ? curMod.modes.find((m) => m.id === mode) : null;
  const needsVoice = (curMode && curMode.audio) || isReading;

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

  // ---- Stimmen (Text-to-Speech) ----
  const [voices, setVoices] = useState([]);
  const [voiceURI, setVoiceURI] = useState(null);
  const synthRef = useRef(typeof window !== "undefined" ? window.speechSynthesis : null);

  useEffect(() => {
    const synth = synthRef.current;
    if (!synth) return;
    const load = () => {
      const all = synth.getVoices();
      const arabic = all.filter((v) => /ar(\b|[-_])/i.test(v.lang));
      setVoices(arabic);
      if (arabic.length && !voiceURI) {
        const maleHints = /maged|male|tarik|hamza|mann|rasheed|ahmad|omar/i;
        const male = arabic.find((v) => maleHints.test(v.name));
        setVoiceURI((male || arabic[0]).voiceURI);
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

  // ---- Timer (versteckt, laeuft ab Start) ----
  useEffect(() => {
    if (screen !== "play" || startTs == null) return;
    const id = setInterval(() => setElapsed(Date.now() - startTs), 250);
    return () => clearInterval(id);
  }, [screen, startTs]);

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
    const ts = Date.now();
    setStartTs(ts);
    setElapsed(0);

    if (isReading) {
      const pack = curMod.packs.find((p) => p.id === packId) || curMod.packs[0];
      setRQueue(shuffle(pack.items));
      setRIdx(0);
      setRevealed(false);
      setScreen("play");
    } else {
      setChosen(null);
      setLocked(false);
      const first = curMod.make(mode);
      setQ(first);
      setScreen("play");
      if (first.audio) setTimeout(() => speak(first.speakText), 350);
    }
  }

  // ---- Auswahl-Modul ----
  function nextQuestion() {
    const nq = curMod.make(mode);
    setQ(nq);
    setChosen(null);
    setLocked(false);
    if (nq.audio) setTimeout(() => speak(nq.speakText), 250);
  }

  function choose(opt, idx) {
    if (locked) return;
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
    setFinalMs(startTs ? Date.now() - startTs : 0);
    if (synthRef.current) synthRef.current.cancel();
    setScreen("result");
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
  const curPack = isReading
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
            onStart={startGame}
            onTestVoice={() => speak("ع")}
          />
        )}

        {screen === "play" && !isReading && q && (
          <PlayScreen
            C={C}
            fontStack={fontStack}
            q={q}
            chosen={chosen}
            locked={locked}
            onChoose={choose}
            onFinish={finish}
            onReplay={() => speak(q.speakText)}
            correct={correct}
            wrong={wrong}
            streak={streak}
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
            onSpeak={() => speak(rItem.ar)}
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
function StartScreen({
  C, moduleId, onSelectModule, curMod, isReading,
  mode, setMode, packId, setPackId,
  needsVoice, voices, voiceURI, setVoiceURI, onStart, onTestVoice,
}) {
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
      {!isReading && (
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

      {/* Lese-Module: Paket */}
      {isReading && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            INHALT WÄHLEN
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {curMod.packs.map((p) => (
              <button key={p.id} style={pickBtn(packId === p.id)} onClick={() => setPackId(p.id)}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{p.label}</div>
                <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>{p.items.length} Karten</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Stimme (fuer Laut-Modi + optional zum Anhoeren beim Lesen) */}
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
                Arabisch → „Maged" (männlich) laden. Der Laut-Modus funktioniert
                erst dann.
              </p>
            )
          ) : (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={voiceURI || ""}
                onChange={(e) => setVoiceURI(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 200,
                  padding: "11px 12px",
                  borderRadius: 10,
                  background: C.panel2,
                  color: C.ink,
                  border: `1px solid ${C.line}`,
                  fontSize: 14,
                }}
              >
                {voices.map((v) => (
                  <option key={v.voiceURI} value={v.voiceURI}>
                    {v.name} ({v.lang})
                  </option>
                ))}
              </select>
              <button
                onClick={onTestVoice}
                style={{
                  padding: "11px 16px",
                  borderRadius: 10,
                  border: `1px solid ${C.line}`,
                  background: C.panel2,
                  color: C.ink,
                  cursor: "pointer",
                  fontSize: 14,
                }}
              >
                ▶ Test
              </button>
            </div>
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
}) {
  const stat = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.ink }}>{val}</div>
    </div>
  );

  return (
    <div>
      {/* Statuszeile — bewusst OHNE sichtbaren Countdown */}
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
              {item.de}
            </div>
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
//  Ergebnisbildschirm
// =====================================================
function ResultScreen({
  C, fontStack, finalMs, correct, wrong, answered, accuracy, bestStreak,
  onRestart, onAgain,
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
