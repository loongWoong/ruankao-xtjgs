import React from 'react';
import './LoadingSpinner.css';

function LoadingSpinner({ size = 40 }) {
  return (
    <div className="loading-spinner-container">
      <div
        className="loading-spinner"
        style={{
          width: size,
          height: size,
          borderWidth: size / 10
        }}
      />
    </div>
  );
}

export default LoadingSpinner;
