import "./App.css";
import ZoomMtgEmbedded from "@zoom/meetingsdk/embedded";
import { useEffect, useRef, useState } from "react";

type PromptType = "poll" | "break" | "recap";

interface Prompt {
  id: number;
  type: PromptType;
  title: string;
  message: string;
}


function App() {
  const clientRef = useRef(ZoomMtgEmbedded.createClient());
  const client = clientRef.current;

  // MORPHCAST TRACKING
  const [emotion, setEmotion] = useState<string | null>(null);
  const [attention, setAttention] = useState<number | null>(null);

  // MEETING INPUTS
  const [meetingIdInput, setMeetingIdInput] = useState("");
  const [passcodeInput, setPasscodeInput] = useState("");

  // ENGAGEMENT HISTORY
  const [engagementLog, setEngagementLog] = useState<
    { time: string; attention: number | null; emotion: string | null; level: string }[]
  >([]);

  // DEBUG STATUS
  const [mcStatus, setMcStatus] = useState("loading");

  const authEndpoint = "http://localhost:4000";
  const role = 0;
  const userName = "React";

  //Engagement prompts
  const [activePrompt, setActivePrompt] = useState<Prompt | null>(null);
  const [pollValue, setPollValue] = useState(3);//going with 1 to 5 range

  //automatic trigerring
  const lowSinceRef = useRef<number | null>(null);
  const lastPromptAtRef = useRef<number | null>(null);
  const promptIdRef = useRef(1);
  const lastPromptTypeRef = useRef<PromptType>("poll");

  // ENGAGEMENT LEVEL
  const engagementLevel =
    attention == null ? "Unknown" : attention > 0.7 ? "High" : attention > 0.4 ? "Medium" : "Low";

  // LOG ON CHANGE
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
  }, [attention, emotion]);

  //Prompt trigger
  // Automatically trigger prompts when engagement is low
  useEffect(() => {
    const now = Date.now();

    if (engagementLevel === "Low") {
      if (lowSinceRef.current == null) {
        lowSinceRef.current = now;
      }

      const lowDuration = now - lowSinceRef.current;
      const lastPromptAt = lastPromptAtRef.current ?? 0;

      // Only fire if low for at least 15 seconds
      // and last prompt was at least 30 seconds ago
      if (
        lowDuration > 15000 &&
        now - lastPromptAt > 30000 &&
        !activePrompt
      ) {
        // Decide which prompt to show next (rotate types)
        let nextType: PromptType;
        if (lastPromptTypeRef.current === "poll") nextType = "break";
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
            message: "How well are you following the lecture right now?",
          });
        } else if (nextType === "break") {
          setActivePrompt({
            id,
            type: "break",
            title: "Micro break",
            message:
              "Your attention dropped. Take 10 seconds to stretch, blink, and refocus, then hit “I'm back”.",
          });
        } else {
          setActivePrompt({
            id,
            type: "recap",
            title: "Recap this part",
            message:
              "Looks like this section might be tough. Want to mark this moment for a recap later?",
          });
        }
      }
    } else {
      // Reset low attention timer when not low
      lowSinceRef.current = null;
    }
  }, [engagementLevel, activePrompt]);


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
    console.log("Recap requested at", new Date().toISOString());
    setActivePrompt(null);
  };

  // -----------------------------
  // ZOOM JOIN
  // -----------------------------
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
      startMeeting(res.signature, res.sdkKey, normalizedMeeting);
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
    } catch (error) {
      console.log(error);
    }
  }

  // -----------------------------
  // MORPHCAST SETUP
  // -----------------------------
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://ai-sdk.morphcast.com/v1.16/ai-sdk.js";
    script.async = true;

    let sdkRef: any = null;
    let CY: any = null;

    let emotionEvent: string | null = null;
    let attentionEvent: string | null = null;

    // SAFELY EXTRACT DOMINANT EMOTION
    const handleEmotion = (evt: any) => {
      const output = evt.detail.output || evt.detail;

      console.log("FACE_EMOTION event:", output);

      let dominant: string | null = null;

      // CASE 1 - already a string
      if (typeof output.dominantEmotion === "string") dominant = output.dominantEmotion;

      // CASE 2 - nested object
      else if (
        output.dominantEmotion &&
        typeof output.dominantEmotion.emotion === "string"
      ) {
        dominant = output.dominantEmotion.emotion;
      }

      // CASE 3 - probabilities object under "emotions"
      else if (output.emotions && typeof output.emotions === "object") {
        const entries = Object.entries(output.emotions as Record<string, number>);
        if (entries.length) dominant = entries.sort((a, b) => b[1] - a[1])[0][0];
      }

      // CASE 4 - probabilities object under "emotion"
      else if (output.emotion && typeof output.emotion === "object") {
        const entries = Object.entries(output.emotion as Record<string, number>);
        if (entries.length) dominant = entries.sort((a, b) => b[1] - a[1])[0][0];
      }

      setEmotion(dominant);
    };

    // SAFELY EXTRACT ATTENTION
    const handleAttention = (evt: any) => {
      const output = evt.detail.output || evt.detail;

      console.log("FACE_ATTENTION event:", output);

      const att =
        output.attention ??
        output.att ??
        output.score ??
        null;

      setAttention(typeof att === "number" ? att : null);
    };

    script.onload = () => {
      CY = (window as any).CY;

      if (!CY) {
        console.error("MorphCast CY missing!");
        setMcStatus("error");
        return;
      }

      emotionEvent = CY.modules().FACE_EMOTION.eventName;
      attentionEvent = CY.modules().FACE_ATTENTION.eventName;

      CY.loader()
        .licenseKey("sk56ce1347751d72db1181f44113d8b004439934b849b3")
        .addModule(CY.modules().FACE_AROUSAL_VALENCE.name)
        .addModule(CY.modules().FACE_EMOTION.name)
        .addModule(CY.modules().FACE_ATTENTION.name)
        .addModule(CY.modules().FACE_DETECTOR.name)
        .load()
        .then((sdk: any) => {
          sdkRef = sdk;
          sdkRef.start();
          setMcStatus("running");

          window.addEventListener(emotionEvent!, handleEmotion);
          window.addEventListener(attentionEvent!, handleAttention);
        })
        .catch((err: any) => {
          console.error("MorphCast load error:", err);
          setMcStatus("error");
        });
    };

    script.onerror = () => {
      setMcStatus("error");
    };

    document.body.appendChild(script);

    return () => {
      if (emotionEvent) window.removeEventListener(emotionEvent, handleEmotion);
      if (attentionEvent) window.removeEventListener(attentionEvent, handleAttention);

      if (sdkRef && typeof sdkRef.stop === "function") sdkRef.stop();

      document.body.removeChild(script);
    };
  }, []);

  // -----------------------------
  // RENDER
  // -----------------------------
  return (
    <div className="App">
      <main
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "1.5rem",
        }}
      >
        <h1>AttentionBanana</h1>

        {/* Top: summary only */}
        <div style={{ marginBottom: "1rem" }}>
          <strong>Live engagement (you):</strong>
          <div>Emotion: {emotion ?? "N/A"}</div>
          <div>Attention: {attention !== null ? attention.toFixed(2) : "N/A"}</div>
          <div>Engagement level: {engagementLevel}</div>
          <div style={{ fontSize: "0.85rem", color: "#555" }}>
            MorphCast status: {mcStatus}
          </div>
        </div>

        {/* Middle: two columns — Zoom + history on the left, assistant on the right */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "1.5rem",
          }}
        >
          {/* LEFT: Zoom + engagement history + join form */}
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

            {/* Engagement history */}
            <div
              style={{
                marginBottom: "1rem",
                maxHeight: "200px",
                overflowY: "auto",
              }}
            >
              <h3>Recent engagement samples</h3>
              <table style={{ width: "100%", fontSize: "0.85rem" }}>
                <thead>
                  <tr>
                    <th align="left">Time</th>
                    <th align="left">Attention</th>
                    <th align="left">Emotion</th>
                    <th align="left">Level</th>
                  </tr>
                </thead>
                <tbody>
                  {engagementLog.map((entry, idx) => (
                    <tr key={idx}>
                      <td>{entry.time}</td>
                      <td>
                        {entry.attention !== null
                          ? entry.attention.toFixed(2)
                          : "N/A"}
                      </td>
                      <td>{entry.emotion ?? "N/A"}</td>
                      <td>{entry.level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
          </div>

          {/* RIGHT: Engagement Assistant sidebar */}
          <aside
            style={{
              flex: 1.3,
              minWidth: "260px",
              maxWidth: "340px",
              borderRadius: "12px",
              padding: "1rem",
              boxShadow: "0 0 10px rgba(0,0,0,0.12)",
              background: "#fafafa",
            }}
          >
            <h3>Engagement Assistant</h3>
            <p style={{ fontSize: "0.85rem", color: "#555" }}>
              This panel adapts in real time to your focus and suggests quick
              check-ins, micro-breaks, and recap prompts.
            </p>

            {/* Active prompt section */}
            {activePrompt ? (
              <div
                style={{
                  marginTop: "1rem",
                  padding: "0.75rem",
                  borderRadius: "10px",
                  background: "#fff",
                  boxShadow: "0 0 6px rgba(0,0,0,0.08)",
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

                {activePrompt.type === "break" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <button onClick={handleConfirmBreak}>I took a break</button>{" "}
                    <button onClick={handleDismissPrompt}>Dismiss</button>
                  </div>
                )}

                {activePrompt.type === "recap" && (
                  <div style={{ marginTop: "0.75rem" }}>
                    <button onClick={handleConfirmRecap}>Mark for recap</button>{" "}
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
                No prompt right now. Stay focused and this assistant will step in
                if your attention drops.
              </div>
            )}

            {/* Optional manual controls */}
            <div
              style={{
                marginTop: "1.5rem",
                fontSize: "0.85rem",
              }}
            >
              <strong>Need help?</strong>
              <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
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
                  Ask me a poll
                </button>
                <button
                  onClick={() =>
                    setActivePrompt({
                      id: Date.now(),
                      type: "recap",
                      title: "Recap request",
                      message:
                        "We'll mark this moment as something to revisit.",
                    })
                  }
                >
                  Mark this moment
                </button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
