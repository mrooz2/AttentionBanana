import "./App.css";
import ZoomMtgEmbedded from "@zoom/meetingsdk/embedded";
import { useEffect, useRef, useState } from "react";

function App() {
  const clientRef = useRef(ZoomMtgEmbedded.createClient());
  const client = clientRef.current; 

  // Variables to hold MorphCast data
  const [emotion, setEmotion] = useState<string | null>(null);
  const [attention, setAttention] = useState<number | null>(null);

  // Variables for meeting inputs
  const [meetingIdInput, setMeetingIdInput] = useState("");
  const [passcodeInput, setPasscodeInput] = useState("");

  const [engagementLog, setEngagementLog] = useState< 
  { time: String; attention: number | null; emotion: string | null; level: string} []
  >([]);
  

  const authEndpoint = "http://localhost:4000"; // http://localhost:4000
  const meetingNumber = meetingIdInput;
  const passWord = passcodeInput;
  const role = 0;
  const userName = "React";
  const userEmail = "";
  const registrantToken = "";
  const zakToken = "";

  const engagementLevel = 
    attention == null
    ? "Unknown"
    : attention > 0.7
    ? "High"
    : attention > 0.4
    ? "Medium"
    : "Low";

  useEffect(() => {
    if (attention === null && emotion === null) return;

    const now = new Date();
    const level =
      attention == null
      ? "Unknown"
      : attention > 0.7
      ? "High"
      : attention > 0.4
      ? "Medium"
      : "Low";
    const entry = {
      time: now.toLocaleTimeString(),
      attention,
      emotion,
      level,
    };

    setEngagementLog((prev) => {
      const next = [...passWord, entry];
      if (next.length > 30) next.shift();
      return next;
    });
  }, [attention, emotion]);


  const getSignature = async () => {
    console.log("Join clicked");
  
    if (!meetingIdInput) {
      alert("Please enter a meeting ID");
      return;
    }
  
    try {
      const req = await fetch(authEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingNumber: meetingIdInput,
          role: role,
          videoWebRtcMode: 1,
        }),
      });
  
      const res = await req.json();
      const signature = res.signature as string;
      const sdkKey = res.sdkKey as string;
      startMeeting(signature, sdkKey);
    } catch (e) {
      console.log("Error getting signature:", e);
    }
  };
  
  async function startMeeting(signature: string, sdkKey: string) {
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
        meetingNumber: meetingIdInput,
        password: passcodeInput,
        userName,
        userEmail,
        tk: registrantToken,
        zak: zakToken,
      });
      console.log("joined successfully");
    } catch (error) {
      console.log(error);
    }
  }
  
  // Integrating MorphCast into the React App
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://ai-sdk.morphcast.com/latest/ai-sdk.js";
    script.async = true;
  
    let sdkRef: any = null;
    let CY: any = null;
    let emotionEventName: string | null = null;
    let attentionEventName: string | null = null;
  
    const handleEmotion = (evt: any) => {
      console.log("FACE_EMOTION", evt.detail);
      const output = evt.detail.output || evt.detail;
      setEmotion(output.dominantEmotion ?? null);
    };
  
    const handleAttention = (evt: any) => {
      console.log("FACE_ATTENTION", evt.detail);
      const output = evt.detail.output || evt.detail;
      setAttention(output.attention ?? output.att ?? null);
    };
  
    script.onload = () => {
      CY = (window as any).CY;
      if (!CY) return;
  
      emotionEventName = CY.modules().FACE_EMOTION.eventName;
      attentionEventName = CY.modules().FACE_ATTENTION.eventName;
  
      CY.loader()
        .licenseKey("sk56ce1347751d72db1181f44113d8b004439934b849b3")
        .addModule(CY.modules().FACE_EMOTION.name)
        .addModule(CY.modules().FACE_ATTENTION.name)
        .load()
        .then((sdk: any) => {
          sdkRef = sdk;
          sdkRef.start();
  
          window.addEventListener(emotionEventName!, handleEmotion);
          window.addEventListener(attentionEventName!, handleAttention);
        });
    };
  
    document.body.appendChild(script);
  
    return () => {
      if (emotionEventName) {
        window.removeEventListener(emotionEventName, handleEmotion);
      }
      if (attentionEventName) {
        window.removeEventListener(attentionEventName, handleAttention);
      }
      if (sdkRef && typeof sdkRef.stop === "function") {
        sdkRef.stop();
      }
      document.body.removeChild(script);
    };
  }, []);
  

return (
    <div className="App">
      <main>
        <h1>AttentionBanana</h1>

        {/* Live engagement summary */}
        <div style={{ marginBottom: "1rem" }}>
          <strong>Live engagement (you):</strong>
          <div>Emotion: {emotion ?? "N/A"}</div>
          <div>Attention: {attention !== null ? attention.toFixed(2) : "N/A"}</div>
          <div>Engagement level: {engagementLevel}</div>
        </div>

        {/* Engagement history */}
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

        {/* Zoom component view container */}
        <div id="meetingSDKElement">
          {/* Zoom Meeting SDK Component View Rendered Here */}
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
        </div>

        <button onClick={getSignature}>Join Meeting</button>
      </main>
    </div>
  );
}

export default App;