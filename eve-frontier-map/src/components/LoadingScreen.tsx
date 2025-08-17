import React from 'react';
import './LoadingScreen.css';
import logo from '../assets/logo/logo.png';

interface LoadingScreenProps {
  progress: number;
  status: string;
}

const LoadingScreen: React.FC<LoadingScreenProps> = ({ progress, status }) => {
  return (
    <div className="loading-container">
      <img src={logo} alt="Logo" className="loading-logo" />
      <div className="loading-status">{status}</div>
      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${progress}%` }}></div>
      </div>
    </div>
  );
};

export default LoadingScreen;
