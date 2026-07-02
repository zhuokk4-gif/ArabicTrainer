import React, { useState, useEffect, useRef, useMemo } from "react";

// ============================================================
//  Arabisch-Schrift-Trainer — Modul 1: Buchstabenerkennung
//  - Naskh-Schrift (Amiri), nah am Mushaf-Schriftbild
//  - Positionsformen per Zero-Width-Joiner erzwungen
//  - Kein Countdown: Timer laeuft versteckt ab Start, Ende per "Fertig"
//  - Modus 1: Form zeigen -> richtigen Grundbuchstaben waehlen
//  - Modus 2: Laut abspielen -> richtige Form waehlen (maennliche Stimme bevorzugt)
// ============================================================

const ZWJ = "\u200D";

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

// Baut eine Frage. mode: "form2letter" | "sound2form"
function makeQuestion(mode) {
  const target = randOf(LETTERS);
  const posKeys = Object.keys(target.forms);
  const pos = randOf(posKeys);

  if (mode === "form2letter") {
    // Zeige eine Positionsform, waehle Grundbuchstaben (isolierte Form) aus 4
    const distractors = shuffle(LETTERS.filter((l) => l.key !== target.key)).slice(0, 3);
    const options = shuffle([target, ...distractors]).map((l) => ({
      key: l.key,
      label: l.forms.isolated,
      correct: l.key === target.key,
    }));
    return {
      mode,
      promptForm: target.forms[pos],
      pos,
      targetKey: target.key,
      targetName: target.name,
      targetSound: target.sound,
      options,
    };
  } else {
    // sound2form: spiele Laut/Name, waehle die gezeigte Positionsform des Zielbuchstabens
    // Distraktoren: gleiche Position anderer Buchstaben (wenn moeglich), sonst isoliert
    const others = shuffle(LETTERS.filter((l) => l.key !== target.key)).slice(0, 3);
    const options = shuffle([
      { key: target.key, label: target.forms[pos], correct: true },
      ...others.map((l) => ({
        key: l.key,
        label: l.forms[pos] || l.forms.isolated,
        correct: false,
      })),
    ]);
    return {
      mode,
      promptForm: null,
      pos,
      targetKey: target.key,
      targetName: target.name,
      targetSound: target.sound,
      targetBase: target.base,
      options,
    };
  }
}

export default function App() {
  const [screen, setScreen] = useState("start"); // start | play | result
  const [mode, setMode] = useState("form2letter");
  const [q, setQ] = useState(null);
  const [locked, setLocked] = useState(false);
  const [chosen, setChosen] = useState(null);

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
        // maennliche arabische Stimme bevorzugen (Heuristik ueber bekannte Namen)
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
    if (!synth) return;
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

  function startGame() {
    setCorrect(0);
    setWrong(0);
    setStreak(0);
    setBestStreak(0);
    setAnswered(0);
    setChosen(null);
    setLocked(false);
    const first = makeQuestion(mode);
    setQ(first);
    setScreen("play");
    const ts = Date.now();
    setStartTs(ts);
    setElapsed(0);
    if (mode === "sound2form") {
      setTimeout(() => speak(first.targetBase), 350);
    }
  }

  function nextQuestion() {
    const nq = makeQuestion(mode);
    setQ(nq);
    setChosen(null);
    setLocked(false);
    if (mode === "sound2form") {
      setTimeout(() => speak(nq.targetBase), 250);
    }
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
            Modul 1 — Buchstaben in allen Positionen erkennen
          </p>
        </header>

        {screen === "start" && (
          <StartScreen
            C={C}
            mode={mode}
            setMode={setMode}
            voices={voices}
            voiceURI={voiceURI}
            setVoiceURI={setVoiceURI}
            onStart={startGame}
            onTestVoice={() => speak("ع")}
          />
        )}

        {screen === "play" && q && (
          <PlayScreen
            C={C}
            fontStack={fontStack}
            q={q}
            chosen={chosen}
            locked={locked}
            onChoose={choose}
            onFinish={finish}
            onReplay={() => speak(q.targetBase)}
            correct={correct}
            wrong={wrong}
            streak={streak}
            elapsed={elapsed}
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
function StartScreen({ C, mode, setMode, voices, voiceURI, setVoiceURI, onStart, onTestVoice }) {
  const card = {
    background: C.panel,
    border: `1px solid ${C.line}`,
    borderRadius: 18,
    padding: 20,
    marginBottom: 16,
  };
  const modeBtn = (active) => ({
    flex: 1,
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
      <div style={card}>
        <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
          MODUS WÄHLEN
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button style={modeBtn(mode === "form2letter")} onClick={() => setMode("form2letter")}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Form → Buchstabe</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
              Eine Positionsform wird gezeigt, du wählst den Grundbuchstaben.
            </div>
          </button>
          <button style={modeBtn(mode === "sound2form")} onClick={() => setMode("sound2form")}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Laut → Form</div>
            <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3 }}>
              Der Buchstabe wird vorgelesen, du wählst die richtige Form.
            </div>
          </button>
        </div>
      </div>

      {mode === "sound2form" && (
        <div style={card}>
          <div style={{ fontSize: 13, color: C.sub, marginBottom: 10, fontWeight: 600 }}>
            STIMME
          </div>
          {voices.length === 0 ? (
            <p style={{ margin: 0, fontSize: 13.5, color: C.sub, lineHeight: 1.5 }}>
              Keine arabische Stimme auf diesem Gerät gefunden. Unter iOS:
              Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen →
              Arabisch → „Maged“ (männlich) laden. Der Laut-Modus funktioniert
              erst dann.
            </p>
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
        Los geht’s
      </button>

      <p style={{ color: C.sub, fontSize: 12.5, textAlign: "center", marginTop: 14, lineHeight: 1.6 }}>
        Kein Countdown. Die Zeit läuft ab jetzt im Hintergrund — du hörst auf,
        wann du willst, über „Fertig“. Sprich jeden Buchstaben laut mit.
      </p>
    </div>
  );
}

// =====================================================
//  Spielbildschirm
// =====================================================
function PlayScreen({
  C, fontStack, q, chosen, locked, onChoose, onFinish, onReplay,
  correct, wrong, streak, elapsed,
}) {
  const stat = (label, val, color) => (
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 11, color: C.sub, letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.ink }}>{val}</div>
    </div>
  );

  return (
    <div>
      {/* Statuszeile — bewusst OHNE sichtbaren Countdown; nur Fortschritt/Treffer */}
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
          Position: {POS_LABEL[q.pos]}
        </div>

        {q.mode === "form2letter" ? (
          <>
            <div
              key={q.promptForm + q.targetKey}
              style={{
                fontFamily: fontStack,
                fontSize: 92,
                lineHeight: 1.15,
                direction: "rtl",
                color: C.ink,
                animation: "pop .18s ease",
                minHeight: 120,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {q.promptForm}
            </div>
            <div style={{ color: C.sub, fontSize: 15 }}>
              Welcher Grundbuchstabe ist das?
            </div>
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
            <div style={{ color: C.sub, fontSize: 15 }}>
              Welche Form gehört zu diesem Laut? (Tippe 🔊 zum Wiederholen)
            </div>
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
          if (locked && !opt.correct && chosen === idx) {
            // falsch gewaehlt: zusaetzlich die richtige zeigen
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
                fontFamily: fontStack,
                fontSize: 40,
                direction: "rtl",
                padding: "14px 18px",
                borderRadius: 14,
                border: `1.5px solid ${border}`,
                background: bg,
                color: C.ink,
                cursor: locked ? "default" : "pointer",
                transition: "all .12s",
                minHeight: 68,
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
            ? "Sehr sauber. Die Formen sitzen fast automatisch."
            : accuracy >= 70
            ? "Solide. Die Verwechsler wiederholen, dann wird’s automatisch."
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
