import React, { useCallback, useEffect, useRef, useState } from "react";

const ObjectIdentifier = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);

  const [status, setStatus] = useState("Starting camera...");
  const [detections, setDetections] = useState([]);
  const [ocrText, setOcrText] = useState([]);
  const [confirmedItem, setConfirmedItem] = useState(null);

  // 🔐 GUARDRAILS CONFIG
  const CONFIDENCE_THRESHOLD = 0.7;

  const ALLOWED_CLASSES = [
    "mask",
    "gloves",
    "syringe",
    "bandage",
    "catheter",
    "gown"
  ];

  // Replace with your deployed backend URL (Railway / Render)
  const YOLO_URL = "https://YOUR-RAILWAY-URL.up.railway.app/detect";

  // sendFrameToYOLO doesn't need to be a dependency of startCamera, so it's defined with useCallback
  const sendFrameToYOLO = useCallback(async () => {
    const videoEl = videoRef.current;
    const canvas = canvasRef.current;
    if (!videoEl || videoEl.readyState !== 4 || !canvas) return;

    const context = canvas.getContext("2d");
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    context.drawImage(videoEl, 0, 0);

    const imageBase64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    try {
      const res = await fetch(YOLO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 })
      });

      if (!res.ok) {
        throw new Error(`Backend responded ${res.status}`);
      }

      const data = await res.json();

      // Store OCR text if provided by backend
      if (data.ocr_text) setOcrText(Array.isArray(data.ocr_text) ? data.ocr_text : [data.ocr_text]);
      else setOcrText([]);

      if (data && Array.isArray(data.detections)) {
        applyGuardrails(data.detections);
      } else {
        setDetections([]);
      }
    } catch (err) {
      console.error("YOLO error:", err);
      setStatus("YOLO connection error");
      setDetections([]);
    }
  }, [YOLO_URL]);

  // startCamera is memoized so it can be safely used in useEffect deps
  const startCamera = useCallback(async () => {
    try {
      // Request environment camera
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStatus("Camera running");

      // start the capture loop (1.5s)
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = setInterval(() => {
        sendFrameToYOLO();
      }, 1500);
    } catch (err) {
      console.error(err);
      // navigator.mediaDevices may be undefined in some browsers/environments
      setStatus("Camera error: " + (err?.message || String(err)));
    }
  }, [sendFrameToYOLO]);

  useEffect(() => {
    // start camera on mount
    startCamera();

    // capture current video element snapshot for cleanup (prevents ref-change warning)
    const videoElAtMount = videoRef.current;

    return () => {
      // stop tracks on the element that was mounted
      if (videoElAtMount?.srcObject) {
        try {
          videoElAtMount.srcObject.getTracks().forEach((t) => t.stop());
        } catch (e) {
          console.warn("Error stopping tracks", e);
        }
      }
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
    // startCamera is stable via useCallback so safe to include
  }, [startCamera]);

  // 🔐 APPLY ALL GUARDRAILS
  const applyGuardrails = (rawDetections) => {
    setConfirmedItem(null);

    // 1️⃣ Confidence filter
    let filtered = rawDetections.filter((d) => Number(d.confidence) >= CONFIDENCE_THRESHOLD);

    // 2️⃣ Medical whitelist filter
    filtered = filtered.filter((d) =>
      ALLOWED_CLASSES.includes(String(d.label).toLowerCase())
    );

    // 3️⃣ Sort + keep top 3
    filtered = filtered
      .sort((a, b) => Number(b.confidence) - Number(a.confidence))
      .slice(0, 3);

    if (filtered.length === 0) {
      setStatus("Low confidence or non-medical item detected");
      setDetections([]);
    } else {
      setStatus("Review prediction and confirm");
      setDetections(filtered);
    }
  };

  return (
    <div style={{ textAlign: "center", padding: 15 }}>
      <h2>{status}</h2>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: "100%",
          borderRadius: 12,
          marginBottom: 15
        }}
      />

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <h3>Detected Objects:</h3>

      {detections.length === 0 ? (
        <p>No valid objects detected</p>
      ) : (
        detections.map((d, index) => (
          <div
            key={index}
            style={{
              marginBottom: 15,
              padding: 10,
              border: "1px solid #ddd",
              borderRadius: 8
            }}
          >
            <strong>
              {d.label} ({Math.round(d.confidence * 100)}%)
            </strong>

            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setConfirmedItem(d.label)}
                style={{
                  padding: "6px 12px",
                  borderRadius: 6,
                  cursor: "pointer"
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        ))
      )}

      {/* Unknown Option */}
      {detections.length === 0 && (
        <button
          onClick={() => setConfirmedItem("Unknown")}
          style={{
            marginTop: 10,
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer"
          }}
        >
          Mark as Unknown
        </button>
      )}

      {/* Confirmed Item Display */}
      {confirmedItem && (
        <div style={{ marginTop: 20 }}>
          <h3>Confirmed Item:</h3>
          <strong>{confirmedItem}</strong>
        </div>
      )}

      {/* OCR Text Display */}
      {ocrText.length > 0 && (
        <div style={{ marginTop: 25 }}>
          <h3>Detected Text (OCR):</h3>
          {ocrText.map((text, index) => (
            <div key={index}>{text}</div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ObjectIdentifier;