import React, { useEffect, useRef, useState, useCallback } from "react";

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

  const YOLO_URL =
    "https://YOUR-RAILWAY-URL.up.railway.app/detect";

  // ✅ Wrapped in useCallback to satisfy ESLint
  const sendFrameToYOLO = useCallback(async () => {
    if (!videoRef.current || videoRef.current.readyState !== 4) return;

    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    context.drawImage(videoRef.current, 0, 0);

    const imageBase64 = canvas
      .toDataURL("image/jpeg", 0.7)
      .split(",")[1];

    try {
      const res = await fetch(YOLO_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ imageBase64 })
      });

      const data = await res.json();

      if (data.ocr_text) {
        setOcrText(data.ocr_text);
      } else {
        setOcrText([]);
      }

      if (data && Array.isArray(data.detections)) {
        applyGuardrails(data.detections);
      } else {
        setDetections([]);
      }

    } catch (err) {
      console.error("YOLO error:", err);
      setStatus("YOLO connection error");
    }
  }, []);

  // ✅ Wrapped in useCallback
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      setStatus("Camera running");

      intervalRef.current = setInterval(sendFrameToYOLO, 1500);

    } catch (err) {
      console.error(err);
      setStatus("Camera error: " + err.message);
    }
  }, [sendFrameToYOLO]);

  // ✅ ESLint-safe useEffect
  useEffect(() => {
    startCamera();

    const videoElement = videoRef.current;

    return () => {
      if (videoElement && videoElement.srcObject) {
        videoElement.srcObject
          .getTracks()
          .forEach((track) => track.stop());
      }

      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [startCamera]);

  // 🔐 APPLY ALL GUARDRAILS
  const applyGuardrails = (rawDetections) => {
    setConfirmedItem(null);

    let filtered = rawDetections.filter(
      d => d.confidence >= CONFIDENCE_THRESHOLD
    );

    filtered = filtered.filter(d =>
      ALLOWED_CLASSES.includes(d.label.toLowerCase())
    );

    filtered = filtered
      .sort((a, b) => b.confidence - a.confidence)
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

      {confirmedItem && (
        <div style={{ marginTop: 20 }}>
          <h3>Confirmed Item:</h3>
          <strong>{confirmedItem}</strong>
        </div>
      )}

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