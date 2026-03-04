// src/Scanner.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const CONFIDENCE_THRESHOLD = 0.45;
const ALLOWED_CLASSES = ["mask", "gloves", "syringe", "bandage", "catheter", "gown"];

const DEFAULT_YOLO_URL = "https://sos-vision-backend-production.up.railway.app/detect";

function normalizeBackendUrl(rawUrl) {
  if (!rawUrl) return "";
  let url = String(rawUrl).trim();

  // add scheme if missing
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url.replace(/^\/+/, "");
  }

  // force https
  url = url.replace(/^http:\/\//i, "https://");
  return url;
}

const ObjectIdentifier = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const intervalRef = useRef(null);
  const inflightRef = useRef(false);

  const [status, setStatus] = useState("Starting camera...");
  const [detections, setDetections] = useState([]);
  const [ocrText, setOcrText] = useState([]);
  const [confirmedItem, setConfirmedItem] = useState(null);
  const [debug, setDebug] = useState(null);

  const YOLO_URL = useMemo(() => {
    return normalizeBackendUrl(process.env.REACT_APP_YOLO_URL || DEFAULT_YOLO_URL);
  }, []);

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
      // IMPORTANT: don't wipe OCR status here. OCR may still be useful.
      setStatus("No confident object — OCR may still help");
      setDetections([]);
    } else {
      setStatus("Review prediction and confirm");
      setDetections(filtered);
    }
  }, []);

  const sendFrameToYOLO = useCallback(async () => {
    if (inflightRef.current) return;
    inflightRef.current = true;

    const videoEl = videoRef.current;
    const canvas = canvasRef.current;

    try {
      if (!videoEl || videoEl.readyState < 2 || !canvas) return;

      if (!YOLO_URL || YOLO_URL.trim() === "" || YOLO_URL.startsWith("/")) {
        console.error("YOLO_URL invalid:", YOLO_URL);
        setStatus("Invalid backend URL. Set REACT_APP_YOLO_URL to full https://.../detect");
        return;
      }

      const ctx = canvas.getContext("2d");
      const w = videoEl.videoWidth || 1280;
      const h = videoEl.videoHeight || 720;
      canvas.width = w;
      canvas.height = h;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(videoEl, 0, 0, w, h);

      // higher quality to help OCR
      const imageBase64 = canvas.toDataURL("image/jpeg", 0.92).split(",")[1];

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);

      const res = await fetch(YOLO_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        if (res.status === 405) setStatus("Backend 405: wrong URL — must end with /detect");
        else if (res.status === 404) setStatus("Backend 404: check REACT_APP_YOLO_URL");
        else setStatus(`Backend HTTP ${res.status}`);

        setDetections([]);
        setOcrText([]);
        setDebug(null);
        return;
      }

      const data = await res.json();

      // show backend debug if present
      setDebug(data._debug || null);

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

      // If OCR returns something, update status so you KNOW OCR worked
      if (ocr.length > 0) {
        setStatus("Text detected — OCR running");
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
      setDebug(null);
    } finally {
      inflightRef.current = false;
    }
  }, [YOLO_URL, applyGuardrails]);

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
            <strong>
              {d.label} ({Math.round(Number(d.confidence) * 100)}%)
            </strong>
            <div style={{ marginTop: 8 }}>
              <button onClick={() => setConfirmedItem(d.label)}>Confirm</button>
            </div>
          </div>
        ))
      )}

      {confirmedItem && (
        <div style={{ marginTop: 20 }}>
          <h3>Confirmed Item:</h3>
          <strong>{confirmedItem}</strong>
        </div>
      )}

      {ocrText.length > 0 ? (
        <div style={{ marginTop: 25 }}>
          <h3>Detected Text (OCR):</h3>
          {ocrText.map((t, idx) => (
            <div key={idx}>{t}</div>
          ))}
        </div>
      ) : (
        <div style={{ marginTop: 25 }}>
          <h3>Detected Text (OCR):</h3>
          <div style={{ color: "#666" }}>No text detected</div>
        </div>
      )}

      <div style={{ marginTop: 18, fontSize: 12, color: "#666" }}>
        Backend: {YOLO_URL}
      </div>

      {debug && (
        <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
          OCR debug: raw={debug.raw_lines}, proc={debug.proc_lines}, merged={debug.merged_lines}, min_conf={debug.min_conf}
        </div>
      )}
    </div>
  );
};

export default ObjectIdentifier;