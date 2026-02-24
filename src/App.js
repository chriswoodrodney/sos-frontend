import React, { useState } from 'react';
import './App.css';
import ObjectIdentifier from './Scanner';

function App() {
  const [result, setResult] = useState(null);
  const [showScanner, setShowScanner] = useState(false);

  const handleAISuccess = (data) => {
    console.log("Backend response:", data);
    setResult(data);
    setShowScanner(false);
  };

  return (
    <div className="App">
      <header className="header">
        <h1>SOS AI Sorting System</h1>
      </header>

      <main className="main">
        {!result ? (
          <>
            <button
              onClick={() => setShowScanner(!showScanner)}
              className="search-btn AI-toggle"
              style={{ padding: '20px', fontSize: '18px' }}
            >
              {showScanner ? '✖ Close Camera' : '📷 Scan Medical Item'}
            </button>

            {showScanner && (
              <ObjectIdentifier onIdentificationSuccess={handleAISuccess} />
            )}
          </>
        ) : (
          <div className="result-card success">
            <h2>✅ Item Identified</h2>

            <p><strong>Item:</strong> {result.identifiedAs}</p>
            <p><strong>Category:</strong> {result.category}</p>

            <div className="location-card">
              <h3>📦 Place Item Here</h3>

              <p><strong>Aisle:</strong> {result.placement.aisle}</p>
              <p><strong>Row:</strong> {result.placement.row}</p>
              <p><strong>Box:</strong> {result.placement.box}</p>
            </div>

            <button
              onClick={() => {
                setResult(null);
                setShowScanner(false);
              }}
              style={{
                marginTop: '20px',
                padding: '15px',
                fontWeight: 'bold'
              }}
            >
              Scan Next Item
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
