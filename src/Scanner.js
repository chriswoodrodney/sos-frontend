// src/Scanner.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ---------------- Stable config constants (top-level) ---------------- */
const CONFIDENCE_THRESHOLD = 0.45; // lowered so YOLO results show up more often
const ALLOWED_CLASSES = ["mask", "gloves", "syringe", "bandage", "catheter", "gown"];

// Default production backend
const DEFAULT_YOLO_URL = "https://sos-vision-backend-production.up.railway.app/detect";

/**
 * Force HTTPS + avoid accidental relative URLs (which become same-origin to Vercel)
 */
function normalizeBackendUrl(rawUrl) {
  if (!rawUrl) return "";
  let url = String(rawUrl).trim();

  // If someone pasted "sos-vision-backend..." without scheme
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url.replace(/^\/+/, "");
  }

  // Force https
  url = url.replace(/^http:\/\//i, "https://");

  return url;
}

/* ---------------- Component ---------------- */
const ObjectIdentifier = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const inflightRef = useRef(false);

  const [status, setStatus] = useState("Starting camera...");
  const [detections, setDetections] = useState([]);
  const [ocrText, setOcrText] = useState([]);
  const [confirmedItem, setConfirmedItem] = useState(null);

  const YOLO_URL = useMemo(() => {
    return normalizeBackendUrl(process.env.REACT_APP_YOLO_URL || DEFAULT_YOLO_URL);
  }, []);

  /* ---------------- GUARDRAILS ---------------- */
  const applyGuardrails = useCallback((rawDetections) => {
    setConfirmedItem(null);

    let filtered = Array.isArray(rawDetections) ? rawDetections.slice() : [];

    filtered = filtered.filter((d) => Number(d.confidence) >= CONFIDENCE_THRESHOLD);

    filtered = filtered.filter((d) =>
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
  }, []);

  /* ---------------- YOLO REQUEST ---------------- */
  const sendFrameToYOLO = useCallback(async () => {
    // prevent piling up requests (important on slow networks)
    if (inflightRef.current) return;
    inflightRef.current = true;

    const videoEl = videoRef.current;
    const canvas = canvasRef.current;

    try {
      if (!videoEl || videoEl.readyState < 2 || !canvas) return;

      // guard URL
      if (!YOLO_URL || YOLO_URL.trim() === "" || YOLO_URL.startsWith("/")) {
        console.error("YOLO_URL invalid:", YOLO_URL);
        setStatus("Invalid backend URL. Set REACT_APP_YOLO_URL to full https://.../detect");
        return;
      }

      const ctx = canvas.getContext("2d");
      canvas.width = videoEl.videoWidth || 640;
      canvas.height = videoEl.videoHeight || 480;
      ctx.drawImage(videoEl, 0, 0);

      const imageBase64 = canvas.toDataURL("image/jpeg", 0.75).split(",")[1];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const res = await fetch(YOLO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 405) {
          setStatus("Backend 405: wrong URL — must end with /detect");
        } else if (res.status === 404) {
          setStatus("Backend 404: check REACT_APP_YOLO_URL");
        } else {
          setStatus(`Backend HTTP ${res.status}`);
        }
        setDetections([]);
        setOcrText([]);
        return;
      }

      const data = await res.json();

      const ocr = data.ocr_text
        ? Array.isArray(data.ocr_text)
          ? data.ocr_text
          : [data.ocr_text]
        : [];

      setOcrText(ocr);

      if (Array.isArray(data.detections)) {
        applyGuardrails(data.detections);
      } else {
        setDetections([]);
      }

      // If OCR has text but YOLO filtered everything, update status so user sees OCR is working
      if (ocr.length > 0 && (!Array.isArray(data.detections) || data.detections.length === 0)) {
        setStatus("Text detected — using OCR assistance");
      }
    } catch (err) {
      if (err?.name === "AbortError") {
        setStatus("Backend request timed out");
      } else {
        console.error("YOLO error:", err);
        setStatus("YOLO connection error");
      }
      setDetections([]);
      setOcrText([]);
    } finally {
      inflightRef.current = false;
    }
  }, [YOLO_URL, applyGuardrails]);

  /* ---------------- CAMERA ---------------- */
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });

      if (videoRef.current) videoRef.current.srcObject = stream;
      setStatus("Camera running");

      if (intervalRef.current) clearInterval(intervalRef.current);

      sendFrameToYOLO();
      intervalRef.current = setInterval(sendFrameToYOLO, 1500);
    } catch (err) {
      console.error(err);
      setStatus("Camera error: " + (err?.message || String(err)));
    }
  }, [sendFrameToYOLO]);

  /* ---------------- LIFECYCLE ---------------- */
  useEffect(() => {
    startCamera();

    const mountedVideo = videoRef.current;
    return () => {
      try {
        if (mountedVideo?.srcObject) {
          mountedVideo.srcObject.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {}
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
          <div
            key={i}
            style={{
              marginBottom: 12,
              padding: 10,
              border: "1px solid #ddd",
              borderRadius: 8,
            }}
          >
            <strong>
              {d.label} ({Math.round(Number(d.confidence) * 100)}%)
            </strong>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setConfirmedItem(d.label)}>Confirm</button>
            </div>
          </div>
        ))
      )}

      {detections.length === 0 && (
        <button onClick={() => setConfirmedItem("Unknown")}>Mark as Unknown</button>
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
          {ocrText.map((t, idx) => (
            <div key={idx}>{t}</div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: "#666" }}>
        Backend: {YOLO_URL}
      </div>
    </div>
  );
};

export default ObjectIdentifier;