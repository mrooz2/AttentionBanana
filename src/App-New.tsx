import "./App.css";
import ZoomMtgEmbedded from "@zoom/meetingsdk/embedded";
import { useEffect, useRef, useState } from "react";

type PromptType = "poll" | "break" | "recap" | "summary";

interface Prompt {
  id: number;
  type: PromptType;
  title: string;
  message: string;
}

function App() {
  const clientRef = useRef(ZoomMtgEmbedded.createClient());
  const client = clientRef.current;

  // MorphCast tracking
  const [emotion, setEmotion] = useState<string | null>(null);
  const [attention, setAttention] = useState<number | null>(null);

  // Meeting inputs
  const [meetingIdInput, setMeetingIdInput] = useState("");
  const [passcodeInput, setPasscodeInput] = useState("");

  // Engagement history (used for analytics & summary)
  const [engagementLog, setEngagementLog] = useState<
    { time: string; attention: number | null; emotion: string | null; level: string }[]
  >([]);

  // MorphCast status
  const [mcStatus, setMcStatus] = useState("loading"); // "loading" | "ready" | "running" | "error"

  // Interactive prompts
  const [activePrompt, setActivePrompt] = useState<Prompt | null>(null);
  const [pollValue, setPollValue] = useState(3); // 1–5 slider
  const [summaryInput, setSummaryInput] = useState("");

  // Auto-trigger tracking
  const lowSinceRef = useRef<number | null>(null);
  const lastPromptAtRef = useRef<number | null>(null);
  const promptIdRef = useRef(1);
  const lastPromptTypeRef = useRef<PromptType>("poll");

  // Session timing + markers
  const sessionStartRef = useRef<number | null>(null);
  const [sessionEnded, setSessionEnded] = useState(false);
  const [sessionDurationSec, setSessionDurationSec] = useState<number | null>(null);

  const [recapMarkers, setRecapMarkers] = useState<
    { time: string; tRelativeSec: number | null }[]
  >([]);

  const [summaries, setSummaries] = useState<
    { time: string; tRelativeSec: number | null; text: string }[]
  >([]);

  const authEndpoint = "http://localhost:4000";
  const role = 0;
  const userName = "React";

  // Derived engagement level (internal)
  const engagementLevel =
    attention == null
      ? "Unknown"
      : attention > 0.7
      ? "High"
      : attention > 0.4
      ? "Medium"
      : "Low";

  // Log engagement samples whenever attention/emotion change
  useEffect(() => {
    if (attention === null && emotion === null) return;

    const now = new Date();
    const entry = {
      time: now.toLocaleTimeString(),
      attention,
      emotion,
      level: engagementLevel,
    };

    setEngagementLog((prev) => {
      const next = [...prev, entry];
      if (next.length > 30) next.shift();
      return next;
    });
  }, [attention, emotion, engagementLevel]);

  // --- Zoom join ---

  const getSignature = async () => {
    if (!meetingIdInput) {
      alert("Please enter a meeting ID");
      return;
    }

    const normalizedMeeting = meetingIdInput.replace(/\s/g, "");

    try {
      const req = await fetch(authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingNumber: normalizedMeeting,
          role,
          videoWebRtcMode: 1,
        }),
      });

      const res = await req.json();
      const signature = res.signature as string;
      const sdkKey = res.sdkKey as string;
      await startMeeting(signature, sdkKey, normalizedMeeting);
    } catch (e) {
      console.log("Error getting signature:", e);
    }
  };

  async function startMeeting(signature: string, sdkKey: string, meetingNumber: string) {
    const meetingSDKElement = document.getElementById("meetingSDKElement")!;
    try {
      await client.init({
        zoomAppRoot: meetingSDKElement,
        language: "en-US",
        patchJsMedia: true,
        leaveOnPageUnload: true,
      });

      await client.join({
        sdkKey,
        signature,
        meetingNumber,
        password: passcodeInput,
        userName,
      });

      console.log("joined successfully");
      sessionStartRef.current = Date.now();
      setSessionEnded(false);
      setSessionDurationSec(null);
    } catch (error) {
      console.log(error);
    }
  }

  // --- MorphCast setup (ai-sdk) ---

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://ai-sdk.morphcast.com/v1.16/ai-sdk.js";
    script.async = true;

    let sdkRef: any = null;
    let CY: any = null;

    let emotionEvent: string | null = null;
    let attentionEvent: string | null = null;

    const handleEmotion = (evt: any) => {
      const detail = evt.detail || {};
      const output = detail.output || detail;

      console.log("FACE_EMOTION event:", output);

      let dominant: string | null = null;

      if (typeof output.dominantEmotion === "string") {
        dominant = output.dominantEmotion;
      } else if (
        output.dominantEmotion &&
        typeof output.dominantEmotion.emotion === "string"
      ) {
        dominant = output.dominantEmotion.emotion;
      } else if (output.emotions && typeof output.emotions === "object") {
        const entries = Object.entries(output.emotions as Record<string, number>);
        if (entries.length) {
          entries.sort((a, b) => b[1] - a[1]);
          dominant = entries[0][0];
        }
      } else if (output.emotion && typeof output.emotion === "object") {
        const entries = Object.entries(output.emotion as Record<string, number>);
        if (entries.length) {
          entries.sort((a, b) => b[1] - a[1]);
          dominant = entries[0][0];
        }
      }

      setEmotion(dominant);
    };

    const handleAttention = (evt: any) => {
      const detail = evt.detail || {};
      const output = detail.output || detail;

      console.log("FACE_ATTENTION event:", output);

      const att =
        output.attention ??
        output.att ??
        output.score ??
        null;

      setAttention(typeof att === "number" ? att : null);
    };

    script.onload = () => {
      console.log("MorphCast ai-sdk loaded");
      setMcStatus("ready");

      CY = (window as any).CY;
      if (!CY) {
        console.error("CY not found on window");
        setMcStatus("error");
        return;
      }

      const arousalModule = CY.modules().FACE_AROUSAL_VALENCE;
      const emotionModule = CY.modules().FACE_EMOTION;
      const attentionModule = CY.modules().FACE_ATTENTION;
      const detectorModule = CY.modules().FACE_DETECTOR;

      emotionEvent = emotionModule.eventName;
      attentionEvent = attentionModule.eventName;

      CY.loader()
        .licenseKey("sk56ce1347751d72db1181f44113d8b004439934b849b3")
        .addModule(arousalModule.name, { smoothness: 0.7 })
        .addModule(emotionModule.name, { smoothness: 0.4 })
        .addModule(attentionModule.name, { smoothness: 0.83 })
        .addModule(detectorModule.name, { maxInputFrameSize: 320, smoothness: 0.83 })
        .load()
        .then((sdk: any) => {
          console.log("MorphCast SDK loaded, starting...");
          sdkRef = sdk;
          if (sdk.start) sdk.start();
          setMcStatus("running");

          window.addEventListener(emotionEvent!, handleEmotion);
          window.addEventListener(attentionEvent!, handleAttention);
        })
        .catch((err: any) => {
          console.error("MorphCast load() error:", err);
          setMcStatus("error");
        });
    };

    script.onerror = (e) => {
      console.error("Failed to load MorphCast ai-sdk script", e);
      setMcStatus("error");
    };

    document.body.appendChild(script);

    return () => {
      if (emotionEvent) {
        window.removeEventListener(emotionEvent, handleEmotion);
      }
      if (attentionEvent) {
        window.removeEventListener(attentionEvent, handleAttention);
      }
      if (sdkRef && typeof sdkRef.stop === "function") {
        sdkRef.stop();
      }
      document.body.removeChild(script);
    };
  }, []);

  // --- End of session helpers ---

  const formatRelTime = (tRelativeSec: number | null) => {
    if (tRelativeSec == null) return "N/A";
    const total = Math.max(0, Math.round(tRelativeSec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleEndSession = () => {
    const now = Date.now();
    const dur =
      sessionStartRef.current != null ? (now - sessionStartRef.current) / 1000 : null;

    setSessionDurationSec(dur);
    setSessionEnded(true);
    lowSinceRef.current = null;
  };

  const avgAttention =
    engagementLog.length === 0
      ? null
      : engagementLog.reduce((sum, e) => sum + (e.attention ?? 0), 0) /
        engagementLog.length;

  const lowOrMediumSamples = engagementLog.filter(
    (e) => e.level === "Low" || e.level === "Medium"
  ).length;

  const lowOrMediumRatio =
    engagementLog.length === 0
      ? null
      : lowOrMediumSamples / engagementLog.length;

  // --- Prompt handlers ---

  const handleDismissPrompt = () => {
    setActivePrompt(null);
  };

  const handleSubmitPoll = () => {
    console.log("Poll submitted. Value:", pollValue);
    setActivePrompt(null);
  };

  const handleConfirmBreak = () => {
    console.log("Break confirmed at", new Date().toISOString());
    setActivePrompt(null);
  };

  const handleConfirmRecap = () => {
    const now = Date.now();
    const tRelativeSec =
      sessionStartRef.current != null
        ? (now - sessionStartRef.current) / 1000
        : null;

    const marker = {
      time: new Date(now).toLocaleTimeString(),
      tRelativeSec,
    };

    setRecapMarkers((prev) => [...prev, marker]);
    console.log("Recap marker added:", marker);

    setActivePrompt(null);
  };

  const handleSubmitSummary = () => {
    const text = summaryInput.trim();
    if (!text) {
      setActivePrompt(null);
      return;
    }

    const now = Date.now();
    const tRelativeSec =
      sessionStartRef.current != null
        ? (now - sessionStartRef.current) / 1000
        : null;

    const entry = {
      time: new Date(now).toLocaleTimeString(),
      tRelativeSec,
      text,
    };

    setSummaries((prev) => [...prev, entry]);
    console.log("Summary added:", entry);

    setActivePrompt(null);
    setSummaryInput("");
  };

  // --- Auto prompts: more frequent, Medium/Low ---

  useEffect(() => {
    if (sessionEnded) {
      lowSinceRef.current = null;
      return;
    }

    const now = Date.now();

    if (attention == null) {
      lowSinceRef.current = null;
      return;
    }

    const needsHelp = engagementLevel === "Medium" || engagementLevel === "Low";

    if (needsHelp) {
      if (lowSinceRef.current == null) {
        lowSinceRef.current = now;
      }

      const lowDuration = now - lowSinceRef.current;
      const lastPromptAt = lastPromptAtRef.current ?? 0;

      // Snappier: fire after 6s of Medium/Low, at least 15s between prompts
      if (
        lowDuration > 6000 &&
        now - lastPromptAt > 15000 &&
        !activePrompt
      ) {
        let nextType: PromptType;
        if (lastPromptTypeRef.current === "poll") nextType = "summary";
        else if (lastPromptTypeRef.current === "summary") nextType = "break";
        else if (lastPromptTypeRef.current === "break") nextType = "recap";
        else nextType = "poll";

        lastPromptTypeRef.current = nextType;
        lastPromptAtRef.current = now;

        const id = promptIdRef.current++;

        if (nextType === "poll") {
          setActivePrompt({
            id,
            type: "poll",
            title: "Quick check-in",
            message: "How well are you following right now?",
          });
        } else if (nextType === "summary") {
          setSummaryInput("");
          setActivePrompt({
            id,
            type: "summary",
            title: "One-sentence summary",
            message: "In one sentence, what did the instructor just cover?",
          });
        } else if (nextType === "break") {
          setActivePrompt({
            id,
            type: "break",
            title: "Micro break",
            message: "Take a 10-second reset, then hit “I’m back”.",
          });
        } else {
          setActivePrompt({
            id,
            type: "recap",
            title: "Recap this part",
            message: "Mark this moment so it can be reviewed later.",
          });
        }
      }
    } else {
      lowSinceRef.current = null;
    }
  }, [attention, activePrompt, engagementLevel, sessionEnded]);

  // --- Dynamic styles for the assistant (go red when prompt active) ---

  const assistantBackground = activePrompt
    ? "linear-gradient(145deg, #fff5f5, #ffe6e6)"
    : "linear-gradient(145deg, #fdfbff, #f2f4ff)";

  const assistantBorderColor = activePrompt ? "#ff7961" : "#d7dcff";
  const assistantShadow = activePrompt
    ? "0 8px 20px rgba(244, 67, 54, 0.35)"
    : "0 8px 20px rgba(0,0,0,0.12)";

  // --- Render ---

  return (
    <div className="App">
      <main
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "2.2rem" }}>
          AttentionBanana 🍌
        </h1>

        <div style={{ fontSize: "0.85rem", color: "#555", marginBottom: "0.75rem" }}>
          MorphCast status: {mcStatus}
        </div>

        {/* Main layout: Zoom + controls on left, Assistant on right */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "1.5rem",
          }}
        >
          {/* LEFT COLUMN */}
          <div style={{ flex: 3, minWidth: 0 }}>
            {/* Zoom container */}
            <div
              style={{
                width: "100%",
                height: "500px",
                marginBottom: "1rem",
                borderRadius: "12px",
                overflow: "hidden",
                boxShadow: "0 0 10px rgba(0,0,0,0.15)",
              }}
            >
              <div
                id="meetingSDKElement"
                style={{ width: "100%", height: "100%" }}
              />
            </div>

            {/* Join form */}
            <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
              <h3>Join a Zoom Meeting</h3>

              <label>
                Meeting ID:
                <input
                  type="text"
                  value={meetingIdInput}
                  onChange={(e) => setMeetingIdInput(e.target.value)}
                  placeholder="Enter meeting ID"
                  style={{ marginLeft: "10px" }}
                />
              </label>

              <br />
              <br />

              <label>
                Passcode:
                <input
                  type="text"
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  placeholder="Enter passcode"
                  style={{ marginLeft: "10px" }}
                />
              </label>

              <br />
              <br />

              <button onClick={getSignature}>Join Meeting</button>
            </div>

            {/* End session + summary */}
            <div style={{ marginTop: "1rem", marginBottom: "1rem" }}>
              <button
                onClick={handleEndSession}
                disabled={sessionEnded || !sessionStartRef.current}
              >
                End Session
              </button>

              {sessionEnded && (
                <div
                  style={{
                    marginTop: "1rem",
                    padding: "0.75rem 1rem",
                    borderRadius: "10px",
                    background: "#f5f5ff",
                    border: "1px solid #ccc",
                    fontSize: "0.9rem",
                  }}
                >
                  <h3 style={{ marginTop: 0 }}>Session summary</h3>
                  <p>
                    Duration:{" "}
                    {sessionDurationSec != null
                      ? formatRelTime(sessionDurationSec)
                      : "N/A"}
                  </p>
                  <p>
                    Average attention:{" "}
                    {avgAttention != null ? avgAttention.toFixed(2) : "N/A"}
                  </p>
                  <p>
                    Time in Medium/Low:{" "}
                    {lowOrMediumRatio != null
                      ? `${Math.round(lowOrMediumRatio * 100)}% of samples`
                      : "N/A"}
                  </p>

                  <h4>Marked moments</h4>
                  {recapMarkers.length === 0 ? (
                    <div style={{ color: "#666" }}>No recap markers.</div>
                  ) : (
                    <ul style={{ paddingLeft: "1.2rem" }}>
                      {recapMarkers.map((m, i) => (
                        <li key={i}>
                          {m.time} · t={formatRelTime(m.tRelativeSec)}
                        </li>
                      ))}
                    </ul>
                  )}

                  <h4>One-sentence summaries</h4>
                  {summaries.length === 0 ? (
                    <div style={{ color: "#666" }}>No summaries captured.</div>
                  ) : (
                    <ul style={{ paddingLeft: "1.2rem" }}>
                      {summaries.map((s, i) => (
                        <li key={i}>
                          <div>
                            {s.time} · t={formatRelTime(s.tRelativeSec)}
                          </div>
                          <div style={{ color: "#444" }}>{s.text}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Engagement Assistant */}
          <aside
            style={{
              flex: 1.3,
              minWidth: "260px",
              maxWidth: "340px",
              borderRadius: "16px",
              padding: "1rem 1.2rem",
              boxShadow: assistantShadow,
              background: assistantBackground,
              border: `1px solid ${assistantBorderColor}`,
              position: "sticky",
              top: "1.5rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: "0.5rem",
              }}
            >
              <h3 style={{ margin: 0 }}>🍌 Engagement Assistant</h3>
              <span
                style={{
                  fontSize: "0.75rem",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "999px",
                  background: activePrompt ? "#ffebee" : "#e3f2fd",
                  color: activePrompt ? "#b71c1c" : "#0d47a1",
                }}
              >
                {activePrompt ? "Action needed" : "Monitoring"}
              </span>
            </div>

            {/* Live attention/level display */}
            <p
              style={{
                fontSize: "0.8rem",
                color: "#555",
                marginBottom: "0.5rem",
              }}
            >
              Live — Attention:{" "}
              {attention !== null ? attention.toFixed(2) : "N/A"} · Level:{" "}
              {engagementLevel}
            </p>

            <p style={{ fontSize: "0.85rem", color: "#555" }}>
              This assistant reacts to how you’re engaging and will occasionally
              ask for quick check-ins, summaries, or suggest short breaks.
            </p>

            {/* Active prompt */}
            {activePrompt ? (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  background: "#fff",
                  boxShadow: "0 0 8px rgba(0,0,0,0.12)",
                  border: "1px solid #ffcdd2",
                }}
              >
                <h4 style={{ margin: "0 0 0.5rem" }}>{activePrompt.title}</h4>
                <p style={{ fontSize: "0.9rem" }}>{activePrompt.message}</p>

                {activePrompt.type === "poll" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <label
                      style={{
                        fontSize: "0.85rem",
                        display: "block",
                        marginBottom: "0.25rem",
                      }}
                    >
                      Understanding level: {pollValue}
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={5}
                      value={pollValue}
                      onChange={(e) => setPollValue(Number(e.target.value))}
                      style={{ width: "100%" }}
                    />
                    <div style={{ marginTop: "0.5rem" }}>
                      <button onClick={handleSubmitPoll}>Submit</button>{" "}
                      <button onClick={handleDismissPrompt}>Dismiss</button>
                    </div>
                  </div>
                )}

                {activePrompt.type === "summary" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <textarea
                      rows={2}
                      value={summaryInput}
                      onChange={(e) => setSummaryInput(e.target.value)}
                      placeholder="In one sentence, what was just covered?"
                      style={{ width: "100%", resize: "vertical" }}
                    />
                    <div style={{ marginTop: "0.5rem" }}>
                      <button onClick={handleSubmitSummary}>Submit</button>{" "}
                      <button onClick={handleDismissPrompt}>Dismiss</button>
                    </div>
                  </div>
                )}

                {activePrompt.type === "break" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <button onClick={handleConfirmBreak}>I took a break</button>{" "}
                    <button onClick={handleDismissPrompt}>Dismiss</button>
                  </div>
                )}

                {activePrompt.type === "recap" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <button onClick={handleConfirmRecap}>Mark this moment</button>{" "}
                    <button onClick={handleDismissPrompt}>Dismiss</button>
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  marginTop: "1rem",
                  fontSize: "0.9rem",
                  color: "#666",
                }}
              >
                No prompt right now. If we notice you might need help, we’ll
                step in with a quick question or suggestion.
              </div>
            )}

            {/* Manual controls */}
            <div
              style={{
                marginTop: "1.5rem",
                fontSize: "0.85rem",
              }}
            >
              <strong>Need help?</strong>
              <div
                style={{
                  marginTop: "0.5rem",
                  display: "flex",
                  flexDirection: "column",
                  gap: "0.4rem",
                }}
              >
                <button
                  onClick={() =>
                    setActivePrompt({
                      id: Date.now(),
                      type: "poll",
                      title: "Manual check-in",
                      message: "How well are you following right now?",
                    })
                  }
                >
                  I'd Like a Quick Check-In
                </button>
                <button
                  onClick={() =>
                    setActivePrompt({
                      id: Date.now(),
                      type: "recap",
                      title: "Recap request",
                      message:
                        "We’ll mark this moment as something to review later.",
                    })
                  }
                >
                  Mark this Moment
                </button>
              </div>
            </div>

            {/* Compact markers & summaries (live list) */}
            <div
              style={{
                marginTop: "1.5rem",
                fontSize: "0.8rem",
              }}
            >
              <strong>Marked moments</strong>
              {recapMarkers.length === 0 ? (
                <div style={{ color: "#777" }}>No recap markers yet.</div>
              ) : (
                <ul style={{ paddingLeft: "1rem", marginTop: "0.3rem" }}>
                  {recapMarkers.slice(-5).map((m, i) => (
                    <li key={i}>
                      {m.time}
                      {m.tRelativeSec != null &&
                        ` · t=${formatRelTime(m.tRelativeSec)}`}
                    </li>
                  ))}
                </ul>
              )}

              <strong style={{ display: "block", marginTop: "0.75rem" }}>
                One-sentence summaries
              </strong>
              {summaries.length === 0 ? (
                <div style={{ color: "#777" }}>No summaries yet.</div>
              ) : (
                <ul style={{ paddingLeft: "1rem", marginTop: "0.3rem" }}>
                  {summaries.slice(-3).map((s, i) => (
                    <li key={i}>
                      <div>
                        {s.time}
                        {s.tRelativeSec != null &&
                          ` · t=${formatRelTime(s.tRelativeSec)}`}
                      </div>
                      <div style={{ color: "#555" }}>{s.text}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
