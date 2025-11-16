import "./App.css";
import ZoomMtgEmbedded from "@zoom/meetingsdk/embedded";
import { useEffect, useRef, useState } from "react";

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
      <main>
        <h1>AttentionBanana</h1>

        {/* LIVE SUMMARY */}
        <div style={{ marginBottom: "1rem" }}>
          <strong>Live engagement (you):</strong>
          <div>Emotion: {emotion ?? "N/A"}</div>
          <div>Attention: {attention !== null ? attention.toFixed(2) : "N/A"}</div>
          <div>Engagement level: {engagementLevel}</div>
        </div>

        {/* ENGAGEMENT LOG */}
        <div style={{ marginBottom: "1rem", maxHeight: "200px", overflowY: "auto" }}>
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
                  <td>{entry.attention !== null ? entry.attention.toFixed(2) : "N/A"}</td>
                  <td>{entry.emotion ?? "N/A"}</td>
                  <td>{entry.level}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ZOOM MEETING */}
        <div id="meetingSDKElement" style={{ marginBottom: "1.5rem" }}></div>

        {/* JOIN FORM */}
        <div style={{ marginBottom: "1rem" }}>
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

          <br /><br />

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
        </div>

        <button onClick={getSignature}>Join Meeting</button>

        <div style={{ marginTop: "0.5rem", fontSize: "0.85rem", color: "#555" }}>
          MorphCast status: {mcStatus}
        </div>
      </main>
    </div>
  );
}

export default App;
