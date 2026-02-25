// src/Scanner.js
import React, { useCallback, useEffect, useRef, useState } from "react";

/* ---------------- Stable config constants (top-level) ---------------- */
const CONFIDENCE_THRESHOLD = 0.7;
const ALLOWED_CLASSES = [
  "mask",
  "gloves",
  "syringe",
  "bandage",
  "catheter",
  "gown"
];

const YOLO_URL = process.env.REACT_APP_YOLO_URL || "https://YOUR-RAILWAY-URL.up.railway.app/detect";

/* ---------------- Component ---------------- */
const ObjectIdentifier = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);

  const [status, setStatus] = useState("Starting camera...");
  const [detections, setDetections] = useState([]);
  const [ocrText, setOcrText] = useState([]);
  const [confirmedItem, setConfirmedItem] = useState(null);

  /* ---------------- GUARDRAILS ---------------- */
  const applyGuardrails = useCallback((rawDetections) => {
    setConfirmedItem(null);

    let filtered = Array.isArray(rawDetections) ? rawDetections.slice() : [];

    filtered = filtered.filter(d => Number(d.confidence) >= CONFIDENCE_THRESHOLD);

    filtered = filtered.filter(d =>
      ALLOWED_CLASSES.includes(String(d.label).toLowerCase())
    );

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
  }, []); // config is stable at top-level

  /* ---------------- YOLO REQUEST ---------------- */
  const sendFrameToYOLO = useCallback(async () => {
    const videoEl = videoRef.current;
    const canvas = canvasRef.current;
    if (!videoEl || videoEl.readyState < 2 || !canvas) return;

    const ctx = canvas.getContext("2d");
    canvas.width = videoEl.videoWidth || 640;
    canvas.height = videoEl.videoHeight || 480;
    ctx.drawImage(videoEl, 0, 0);

    const imageBase64 = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

    try {
      const res = await fetch(YOLO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 })
      });

      if (!res.ok) throw new Error(`Backend HTTP ${res.status}`);

      const data = await res.json();

      setOcrText(data.ocr_text ? (Array.isArray(data.ocr_text) ? data.ocr_text : [data.ocr_text]) : []);

      if (Array.isArray(data.detections)) {
        applyGuardrails(data.detections);
      } else {
        setDetections([]);
      }

    } catch (err) {
      console.error("YOLO error:", err);
      setStatus("YOLO connection error");
      setDetections([]);
    }
  }, [applyGuardrails]);

  /* ---------------- CAMERA ---------------- */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });

      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("Camera running");

      if (intervalRef.current) clearInterval(intervalRef.current);

      intervalRef.current = setInterval(sendFrameToYOLO, 1500);

    } catch (err) {
      console.error(err);
      setStatus("Camera error: " + (err?.message || String(err)));
    }
  }, [sendFrameToYOLO]);

  /* ---------------- LIFECYCLE ---------------- */
  useEffect(() => {
    // start camera using stable callback
    startCamera();

    // copy ref to a local variable for cleanup to silence the linter
    const mountedVideo = videoRef.current;

    return () => {
      try {
        if (mountedVideo?.srcObject) {
          mountedVideo.srcObject.getTracks().forEach(t => t.stop());
        }
      } catch (e) {
        // swallow
      }

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [startCamera]);

  /* ---------------- UI ---------------- */
  return (
    <div style={{ textAlign: "center", padding: 15 }}>
      <h2>{status}</h2>

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", borderRadius: 12, marginBottom: 15 }}
      />

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <h3>Detected Objects:</h3>

      {detections.length === 0 ? (
        <p>No valid objects detected</p>
      ) : (
        detections.map((d, i) => (
          <div key={i} style={{ marginBottom: 12, padding: 10, border: "1px solid #ddd", borderRadius: 8 }}>
            <strong>{d.label} ({Math.round(d.confidence * 100)}%)</strong>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setConfirmedItem(d.label)}>
                Confirm
              </button>
            </div>
          </div>
        ))
      )}

      {detections.length === 0 && (
        <button onClick={() => setConfirmedItem("Unknown")}>
          Mark as Unknown
        </button>
      )}

      {confirmedItem && (
        <div style={{ marginTop: 20 }}>
          <h3>Confirmed Item:</h3>
          <strong>{confirmedItem}</strong>
        </div>
      )}

      {ocrText.length > 0 && (
        <div style={{ marginTop: 25 }}>
          <h3>Detected Text (OCR):</h3>
          {ocrText.map((t, idx) => (<div key={idx}>{t}</div>))}
        </div>
      )}
    </div>
  );
};

export default ObjectIdentifier;